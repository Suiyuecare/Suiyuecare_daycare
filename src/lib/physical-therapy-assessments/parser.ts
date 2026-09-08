import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  CLIENT_SERVICE_STATUSES,
  PHYSICAL_THERAPY_MEASUREMENT_STATES,
  PHYSICAL_THERAPY_RECORD_STATES,
  type CreatePhysicalTherapyDraftInput,
  type PhysicalTherapyAssessmentMutationInput,
  type PhysicalTherapyAssessmentOperationResult,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) &&
    Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
});
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) =>
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const positiveInteger = z.number().int().positive().safe();
const exactNumericText = z.string().trim()
  .regex(/^-?(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/u);

export const physicalTherapyMeasurementSchema = z.object({
  name: narrative(120),
  state: z.enum(PHYSICAL_THERAPY_MEASUREMENT_STATES),
  value: z.string().trim().max(2000).nullable(),
  unit: narrative(40).nullable(),
  reason: z.string().trim().max(500).nullable(),
}).strict().superRefine((item, context) => {
  if (item.state === "numeric") {
    if (item.value === null || !exactNumericText.safeParse(item.value).success) {
      context.addIssue({ code: "custom", path: ["value"], message: "數值型項目須保存精確數值文字。" });
    }
    if (!item.unit) {
      context.addIssue({ code: "custom", path: ["unit"], message: "數值型項目須明確填寫單位。" });
    }
    if (item.reason !== null) {
      context.addIssue({ code: "custom", path: ["reason"], message: "已有數值時不得夾帶缺值理由。" });
    }
  } else if (item.state === "text") {
    if (!item.value || !narrative(2000).safeParse(item.value).success) {
      context.addIssue({ code: "custom", path: ["value"], message: "文字型項目須填寫觀察文字。" });
    }
    if (item.unit !== null || item.reason !== null) {
      context.addIssue({ code: "custom", message: "文字型項目不得夾帶單位或缺值理由。" });
    }
  } else {
    if (item.value !== null || item.unit !== null) {
      context.addIssue({ code: "custom", message: "缺值或不適用項目不得夾帶數值或單位。" });
    }
    if (!item.reason || !narrative(500).safeParse(item.reason).success) {
      context.addIssue({ code: "custom", path: ["reason"], message: "缺值或不適用須填寫理由。" });
    }
  }
});

export const physicalTherapyMeasurementsSchema = z.array(
  physicalTherapyMeasurementSchema,
).min(1).max(50).superRefine((items, context) => {
  const names = new Set<string>();
  for (const [index, item] of items.entries()) {
    const key = item.name.toLowerCase();
    if (names.has(key)) {
      context.addIssue({
        code: "custom",
        path: [index, "name"],
        message: "同一份評估不可重複使用相同測量名稱。",
      });
    }
    names.add(key);
  }
});

const assessmentFields = {
  clientId: uuid,
  assessedOn: date,
  reassessmentDueOn: date,
  dueBasis: narrative(1000),
  measurements: physicalTherapyMeasurementsSchema,
  functionalObservation: narrative(5000),
  goals: narrative(5000),
  recommendations: narrative(5000),
  followUpPlan: narrative(5000),
  formVersionReference: z.literal("manual-physical-therapy-v1"),
};

const createSchema = z.object({ action: z.literal("create_draft") })
  .extend(assessmentFields).strict();
const reviseSchema = z.object({
  action: z.literal("revise_draft"),
  assessmentKey: uuid,
  previousVersionId: uuid,
  expectedVersion: positiveInteger,
}).extend(assessmentFields).strict();
const signSchema = z.object({
  action: z.literal("sign"),
  clientId: uuid,
  assessmentKey: uuid,
  previousVersionId: uuid,
  expectedVersion: positiveInteger,
}).strict();
const correctSchema = z.object({
  action: z.literal("correct"),
  assessmentKey: uuid,
  previousVersionId: uuid,
  expectedVersion: positiveInteger,
  correctionReason: narrative(1000),
}).extend(assessmentFields).strict();

const operationRowSchema = z.object({
  operation_id: uuid,
  client_id: uuid,
  assessment_key: uuid,
  version_id: uuid,
  assessment_version: z.union([
    positiveInteger,
    z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(positiveInteger),
  ]),
  record_state: z.enum(PHYSICAL_THERAPY_RECORD_STATES),
  assessed_on: date,
  therapist_user_id: uuid,
  service_status_at_assessment: z.enum(CLIENT_SERVICE_STATUSES),
  reassessment_due_on: date,
  form_version_reference: z.literal("manual-physical-therapy-v1"),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();

const errorDetailSchema = z.object({
  code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,119}$/u),
  message: z.string().trim().min(1).max(500).refine((value) =>
    !/[\u0000-\u001f\u007f]/u.test(value)),
  field: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/u)
    .optional(),
}).strict();
const apiErrorSchema = z.object({
  requestId: uuid,
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(errorDetailSchema).min(1).max(10),
}).strict();
const successSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.object({
    action: z.enum(["create_draft", "revise_draft", "sign", "correct"]),
    operationId: uuid,
    clientId: uuid,
    assessmentKey: uuid,
    versionId: uuid,
    assessmentVersion: positiveInteger,
    recordState: z.enum(PHYSICAL_THERAPY_RECORD_STATES),
    assessedOn: date,
    therapistUserId: uuid,
    serviceStatusAtAssessment: z.enum(CLIENT_SERVICE_STATUSES),
    reassessmentDueOn: date,
    formVersionReference: z.literal("manual-physical-therapy-v1"),
    committedAt: timestamp,
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
  errors: z.tuple([]),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError(
    "INVALID_PHYSICAL_THERAPY_ASSESSMENT",
    message,
    400,
    field,
  );
}

function parseIdempotencyKey(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return parsed.data;
}

function ensureDateOrder<
  T extends { assessedOn: string; reassessmentDueOn: string },
>(value: T) {
  if (value.reassessmentDueOn < value.assessedOn) {
    invalid("人工輸入的複評期限不得早於評估日期。", "reassessmentDueOn");
  }
  return value;
}

export function parseCreatePhysicalTherapyDraft(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): CreatePhysicalTherapyDraftInput {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    invalid("個案、日期、人工測量、功能觀察、目標、建議或追蹤未通過驗證。");
  }
  return {
    ...ensureDateOrder(parsed.data),
    idempotencyKey: parseIdempotencyKey(idempotencyKey),
  };
}

export function parsePhysicalTherapyAssessmentMutation(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): PhysicalTherapyAssessmentMutationInput {
  const schema = body.action === "revise_draft" ? reviseSchema
    : body.action === "sign" ? signSchema
      : body.action === "correct" ? correctSchema : null;
  if (!schema) invalid("不支援的物理治療評估操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("評估內容、版本、簽署或更正理由未通過驗證。");
  const data = parsed.data;
  if (data.action !== "sign") ensureDateOrder(data);
  return {
    ...data,
    idempotencyKey: parseIdempotencyKey(idempotencyKey),
  } as PhysicalTherapyAssessmentMutationInput;
}

export function parsePhysicalTherapyOperationResult(
  value: unknown,
  action: PhysicalTherapyAssessmentOperationResult["action"],
): Omit<PhysicalTherapyAssessmentOperationResult, "persisted" | "demo"> {
  const parsed = operationRowSchema.safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "PHYSICAL_THERAPY_RECEIPT_INVALID",
      "資料庫完成憑證格式不完整；畫面不會把操作當作成功。",
      502,
    );
  }
  return {
    action,
    operationId: parsed.data.operation_id,
    clientId: parsed.data.client_id,
    assessmentKey: parsed.data.assessment_key,
    versionId: parsed.data.version_id,
    assessmentVersion: parsed.data.assessment_version,
    recordState: parsed.data.record_state,
    assessedOn: parsed.data.assessed_on,
    therapistUserId: parsed.data.therapist_user_id,
    serviceStatusAtAssessment: parsed.data.service_status_at_assessment,
    reassessmentDueOn: parsed.data.reassessment_due_on,
    formVersionReference: parsed.data.form_version_reference,
    committedAt: parsed.data.committed_at,
    replayed: parsed.data.replayed,
  };
}

export type PhysicalTherapyActionExpectation = {
  action: PhysicalTherapyAssessmentOperationResult["action"];
  clientId: string;
  assessmentKey?: string;
  expectedVersion?: number;
};

export function parsePhysicalTherapyActionSuccess(
  value: unknown,
  expectation: PhysicalTherapyActionExpectation,
  httpStatus: number,
) {
  const parsed = successSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_PHYSICAL_THERAPY_SUCCESS");
  const data = parsed.data.data;
  const expectedState = expectation.action === "create_draft" ||
    expectation.action === "revise_draft" ? "draft"
    : expectation.action === "sign" ? "signed" : "corrected";
  if (
    data.action !== expectation.action || data.clientId !== expectation.clientId ||
    data.recordState !== expectedState ||
    (expectation.assessmentKey !== undefined &&
      data.assessmentKey !== expectation.assessmentKey) ||
    (expectation.expectedVersion !== undefined &&
      data.assessmentVersion !== expectation.expectedVersion + 1) ||
    (expectation.action === "create_draft" && data.assessmentVersion !== 1) ||
    httpStatus !== (data.replayed ? 200 : 201)
  ) throw new Error("MISMATCHED_PHYSICAL_THERAPY_SUCCESS");
  return parsed.data;
}

export function parsePhysicalTherapyActionError(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
