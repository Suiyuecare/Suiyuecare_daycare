import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  CLIENT_SERVICE_STATUSES,
  PHYSICAL_THERAPY_SERVICE_RECORD_STATES,
  PHYSICAL_THERAPY_SERVICE_VALUE_STATES,
  type CreatePhysicalTherapyServiceDraftInput,
  type PhysicalTherapyServiceMutationInput,
  type PhysicalTherapyServiceOperationResult,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) &&
    Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) =>
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const safeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const positiveInteger = z.number().int().positive().safe();

export const physicalTherapyServiceValueSchema = z.object({
  state: z.enum(PHYSICAL_THERAPY_SERVICE_VALUE_STATES),
  text: z.string().trim().max(5000).nullable(),
  reason: z.string().trim().max(1000).nullable(),
}).strict().superRefine((value, context) => {
  if (value.state === "recorded") {
    if (value.text === null || !narrative(5000).safeParse(value.text).success) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "已記錄狀態必須填寫內容。",
      });
    }
    if (value.reason !== null) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "已記錄狀態不得夾帶缺值理由。",
      });
    }
  } else {
    if (value.text !== null) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "缺值或不適用不得夾帶內容。",
      });
    }
    if (value.reason === null ||
        !narrative(1000).safeParse(value.reason).success) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "缺值與不適用必須各自填寫理由。",
      });
    }
  }
});

const serviceFields = {
  clientId: uuid,
  occurredAt: timestamp,
  serviceContent: physicalTherapyServiceValueSchema,
  clientReaction: physicalTherapyServiceValueSchema,
  recommendation: physicalTherapyServiceValueSchema,
};

const createSchema = z.object({ action: z.literal("create_draft") })
  .extend(serviceFields).strict();
const reviseSchema = z.object({
  action: z.literal("revise_draft"),
  recordKey: uuid,
  previousVersionId: uuid,
  expectedVersion: positiveInteger,
}).extend(serviceFields).strict();
const signSchema = z.object({
  action: z.literal("sign"),
  clientId: uuid,
  recordKey: uuid,
  previousVersionId: uuid,
  expectedVersion: positiveInteger,
}).strict();
const correctSchema = z.object({
  action: z.literal("correct"),
  recordKey: uuid,
  previousVersionId: uuid,
  expectedVersion: positiveInteger,
  correctionReason: narrative(1000),
}).extend(serviceFields).strict();

const operationRowSchema = z.object({
  operation_id: uuid,
  organization_id: uuid,
  branch_id: uuid,
  client_id: uuid,
  record_key: uuid,
  version_id: uuid,
  record_version: z.union([
    positiveInteger,
    z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(positiveInteger),
  ]),
  record_state: z.enum(PHYSICAL_THERAPY_SERVICE_RECORD_STATES),
  occurred_at: timestamp,
  therapist_user_id: uuid,
  service_status_at_occurrence: z.enum(CLIENT_SERVICE_STATUSES),
  assessment_reference_version_id: uuid.nullable(),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();

const errorDetailSchema = z.object({
  code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,119}$/u),
  message: safeText(500),
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
    organizationId: uuid,
    branchId: uuid,
    clientId: uuid,
    recordKey: uuid,
    versionId: uuid,
    recordVersion: positiveInteger,
    recordState: z.enum(PHYSICAL_THERAPY_SERVICE_RECORD_STATES),
    occurredAt: timestamp,
    therapistUserId: uuid,
    serviceStatusAtOccurrence: z.enum(CLIENT_SERVICE_STATUSES),
    assessmentReferenceVersionId: uuid.nullable(),
    committedAt: timestamp,
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
  errors: z.tuple([]),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError(
    "INVALID_PHYSICAL_THERAPY_SERVICE",
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

export function parseCreatePhysicalTherapyServiceDraft(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): CreatePhysicalTherapyServiceDraftInput {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    invalid("個案、發生時間、服務內容、個案反應或建議未通過驗證。");
  }
  return { ...parsed.data, idempotencyKey: parseIdempotencyKey(idempotencyKey) };
}

export function parsePhysicalTherapyServiceMutation(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): PhysicalTherapyServiceMutationInput {
  const schema = body.action === "revise_draft" ? reviseSchema
    : body.action === "sign" ? signSchema
      : body.action === "correct" ? correctSchema : null;
  if (!schema) invalid("不支援的物理治療服務紀錄操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    invalid("服務紀錄內容、版本、簽署或更正理由未通過驗證。");
  }
  return {
    ...parsed.data,
    idempotencyKey: parseIdempotencyKey(idempotencyKey),
  } as PhysicalTherapyServiceMutationInput;
}

export function parsePhysicalTherapyServiceOperationResult(
  value: unknown,
  action: PhysicalTherapyServiceOperationResult["action"],
): Omit<PhysicalTherapyServiceOperationResult, "persisted" | "demo"> {
  const parsed = operationRowSchema.safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "PHYSICAL_THERAPY_SERVICE_RECEIPT_INVALID",
      "資料庫完成憑證格式不完整；畫面不會把操作當作成功。",
      502,
    );
  }
  return {
    action,
    operationId: parsed.data.operation_id,
    organizationId: parsed.data.organization_id,
    branchId: parsed.data.branch_id,
    clientId: parsed.data.client_id,
    recordKey: parsed.data.record_key,
    versionId: parsed.data.version_id,
    recordVersion: parsed.data.record_version,
    recordState: parsed.data.record_state,
    occurredAt: parsed.data.occurred_at,
    therapistUserId: parsed.data.therapist_user_id,
    serviceStatusAtOccurrence: parsed.data.service_status_at_occurrence,
    assessmentReferenceVersionId:
      parsed.data.assessment_reference_version_id,
    committedAt: parsed.data.committed_at,
    replayed: parsed.data.replayed,
  };
}

export type PhysicalTherapyServiceActionExpectation = {
  action: PhysicalTherapyServiceOperationResult["action"];
  organizationId: string;
  branchId: string;
  clientId: string;
  recordKey?: string;
  expectedVersion?: number;
};

export function parsePhysicalTherapyServiceActionSuccess(
  value: unknown,
  expectation: PhysicalTherapyServiceActionExpectation,
  httpStatus: number,
) {
  const parsed = successSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_PHYSICAL_THERAPY_SERVICE_SUCCESS");
  const data = parsed.data.data;
  const expectedState = expectation.action === "create_draft" ||
    expectation.action === "revise_draft" ? "draft"
    : expectation.action === "sign" ? "signed" : "corrected";
  if (
    data.action !== expectation.action ||
    data.organizationId !== expectation.organizationId ||
    data.branchId !== expectation.branchId ||
    data.clientId !== expectation.clientId ||
    data.recordState !== expectedState ||
    (expectation.recordKey !== undefined &&
      data.recordKey !== expectation.recordKey) ||
    (expectation.expectedVersion !== undefined &&
      data.recordVersion !== expectation.expectedVersion + 1) ||
    (expectation.action === "create_draft" && data.recordVersion !== 1) ||
    httpStatus !== (data.replayed ? 200 : 201)
  ) throw new Error("MISMATCHED_PHYSICAL_THERAPY_SERVICE_SUCCESS");
  return parsed.data;
}

export function parsePhysicalTherapyServiceActionError(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
