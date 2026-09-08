import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  CLIENT_SERVICE_STATUSES,
  PSYCHOSOCIAL_DOMAIN_KEYS,
  PSYCHOSOCIAL_DOMAIN_STATES,
  PSYCHOSOCIAL_RECORD_STATES,
  type CreatePsychosocialDraftInput,
  type PsychosocialAssessmentMutationInput,
  type PsychosocialAssessmentOperationResult,
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

const domainValueSchema = z.object({
  state: z.enum(PSYCHOSOCIAL_DOMAIN_STATES),
  detail: z.string().trim().min(1).max(2000).nullable(),
}).strict().superRefine((value, context) => {
  if ((value.state === "provided") !== (value.detail !== null)) {
    context.addIssue({
      code: "custom",
      message: "已記錄面向必須有內容；未知或不適用不得夾帶內容。",
    });
  }
});

export const psychosocialDimensionsSchema = z.object(
  Object.fromEntries(
    PSYCHOSOCIAL_DOMAIN_KEYS.map((key) => [key, domainValueSchema]),
  ) as Record<(typeof PSYCHOSOCIAL_DOMAIN_KEYS)[number], typeof domainValueSchema>,
).strict();

const assessmentFields = {
  clientId: uuid,
  assessedOn: date,
  reassessmentDueOn: date,
  dueBasis: narrative(1000),
  dimensions: psychosocialDimensionsSchema,
  assessmentSummary: narrative(5000),
  formVersionReference: z.literal("manual-psychosocial-v1"),
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
  record_state: z.enum(PSYCHOSOCIAL_RECORD_STATES),
  assessed_on: date,
  responsible_user_id: uuid,
  service_status_at_assessment: z.enum(CLIENT_SERVICE_STATUSES),
  reassessment_due_on: date,
  form_version_reference: z.literal("manual-psychosocial-v1"),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();

const errorDetailSchema = z.object({
  code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,119}$/u),
  message: z.string().trim().min(1).max(500),
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
    recordState: z.enum(PSYCHOSOCIAL_RECORD_STATES),
    assessedOn: date,
    responsibleUserId: uuid,
    serviceStatusAtAssessment: z.enum(CLIENT_SERVICE_STATUSES),
    reassessmentDueOn: date,
    formVersionReference: z.literal("manual-psychosocial-v1"),
    committedAt: timestamp,
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
  errors: z.tuple([]),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError(
    "INVALID_PSYCHOSOCIAL_ASSESSMENT",
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

export function parseCreatePsychosocialDraft(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): CreatePsychosocialDraftInput {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    invalid("個案、日期、期限依據、結構化面向或摘要未通過驗證。");
  }
  return {
    ...ensureDateOrder(parsed.data),
    idempotencyKey: parseIdempotencyKey(idempotencyKey),
  };
}

export function parsePsychosocialAssessmentMutation(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): PsychosocialAssessmentMutationInput {
  const schema = body.action === "revise_draft" ? reviseSchema
    : body.action === "sign" ? signSchema
      : body.action === "correct" ? correctSchema : null;
  if (!schema) invalid("不支援的心理社會評估操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("評估內容、版本、簽署或更正理由未通過驗證。");
  const data = parsed.data;
  if (data.action !== "sign") ensureDateOrder(data);
  return {
    ...data,
    idempotencyKey: parseIdempotencyKey(idempotencyKey),
  } as PsychosocialAssessmentMutationInput;
}

export function parsePsychosocialOperationResult(
  value: unknown,
  action: PsychosocialAssessmentOperationResult["action"],
): Omit<PsychosocialAssessmentOperationResult, "persisted" | "demo"> {
  const parsed = operationRowSchema.safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "PSYCHOSOCIAL_RECEIPT_INVALID",
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
    responsibleUserId: parsed.data.responsible_user_id,
    serviceStatusAtAssessment: parsed.data.service_status_at_assessment,
    reassessmentDueOn: parsed.data.reassessment_due_on,
    formVersionReference: parsed.data.form_version_reference,
    committedAt: parsed.data.committed_at,
    replayed: parsed.data.replayed,
  };
}

export type PsychosocialActionExpectation = {
  action: PsychosocialAssessmentOperationResult["action"];
  clientId: string;
  assessmentKey?: string;
  expectedVersion?: number;
};

export function parsePsychosocialActionSuccess(
  value: unknown,
  expectation: PsychosocialActionExpectation,
  httpStatus: number,
) {
  const parsed = successSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_PSYCHOSOCIAL_SUCCESS");
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
  ) throw new Error("MISMATCHED_PSYCHOSOCIAL_SUCCESS");
  return parsed.data;
}

export function parsePsychosocialActionError(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
