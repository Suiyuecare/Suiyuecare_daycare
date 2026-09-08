import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  SOCIAL_WORK_FOLLOW_UP_STATUSES,
  SOCIAL_WORK_RECORD_STATES,
  type CreateSocialWorkDraftInput,
  type SocialWorkFollowUpMutationInput,
  type SocialWorkFollowUpOperationResult,
  type SocialWorkRecordMutationInput,
  type SocialWorkRecordOperationResult,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const safeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const positiveInteger = z.number().int().positive().safe();
const nonnegativeInteger = z.number().int().nonnegative().safe();

const serviceFields = {
  clientId: uuid,
  occurredAt: timestamp,
  serviceType: safeText(120),
  serviceContent: narrative(5000),
  serviceResult: narrative(3000),
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

const trackSchema = z.object({
  action: z.literal("track"),
  clientId: uuid,
  recordKey: uuid,
  serviceVersionId: uuid,
  expectedSequence: nonnegativeInteger,
  dueOn: date,
  followUpPlan: narrative(2000),
}).strict();
const completeSchema = z.object({
  action: z.literal("complete_follow_up"),
  clientId: uuid,
  recordKey: uuid,
  serviceVersionId: uuid,
  expectedSequence: positiveInteger,
  followUpOutcome: narrative(2000),
}).strict();
const cancelSchema = z.object({
  action: z.literal("cancel_follow_up"),
  clientId: uuid,
  recordKey: uuid,
  serviceVersionId: uuid,
  expectedSequence: positiveInteger,
  transitionReason: narrative(1000),
}).strict();

const recordRowSchema = z.object({
  operation_id: uuid,
  record_key: uuid,
  version_id: uuid,
  record_version: z.union([
    positiveInteger,
    z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(positiveInteger),
  ]),
  record_state: z.enum(SOCIAL_WORK_RECORD_STATES),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();
const followUpRowSchema = z.object({
  operation_id: uuid,
  record_key: uuid,
  follow_up_event_id: uuid,
  follow_up_sequence: z.union([
    positiveInteger,
    z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(positiveInteger),
  ]),
  follow_up_status: z.enum(SOCIAL_WORK_FOLLOW_UP_STATUSES),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();

const errorDetailSchema = z.object({
  code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,119}$/u),
  message: safeText(500),
  field: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/u).optional(),
}).strict();
const apiErrorSchema = z.object({
  requestId: uuid,
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(errorDetailSchema).min(1).max(10),
}).strict();
const recordSuccessSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.object({
    receiptKind: z.literal("record"),
    action: z.enum(["create_draft", "revise_draft", "sign", "correct"]),
    operationId: uuid,
    recordKey: uuid,
    versionId: uuid,
    recordVersion: positiveInteger,
    recordState: z.enum(SOCIAL_WORK_RECORD_STATES),
    committedAt: timestamp,
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
  errors: z.tuple([]),
}).strict();
const followUpSuccessSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.object({
    receiptKind: z.literal("follow_up"),
    action: z.enum(["track", "complete_follow_up", "cancel_follow_up"]),
    operationId: uuid,
    recordKey: uuid,
    followUpEventId: uuid,
    followUpSequence: positiveInteger,
    followUpStatus: z.enum(SOCIAL_WORK_FOLLOW_UP_STATUSES),
    committedAt: timestamp,
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
  errors: z.tuple([]),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_SOCIAL_WORK_RECORD", message, 400, field);
}

function parseIdempotencyKey(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return parsed.data;
}

export function parseCreateSocialWorkDraft(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): CreateSocialWorkDraftInput {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) invalid("個案、實際發生時間、服務類型、內容或結果未通過驗證。");
  return { ...parsed.data, idempotencyKey: parseIdempotencyKey(idempotencyKey) };
}

export function parseSocialWorkRecordMutation(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): SocialWorkRecordMutationInput {
  const schema = body.action === "revise_draft" ? reviseSchema
    : body.action === "sign" ? signSchema
      : body.action === "correct" ? correctSchema : null;
  if (!schema) invalid("不支援的社工服務紀錄操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("紀錄內容、版本、簽署或更正理由未通過驗證。");
  return { ...parsed.data, idempotencyKey: parseIdempotencyKey(idempotencyKey) } as SocialWorkRecordMutationInput;
}

export function parseSocialWorkFollowUpMutation(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): SocialWorkFollowUpMutationInput {
  const schema = body.action === "track" ? trackSchema
    : body.action === "complete_follow_up" ? completeSchema
      : body.action === "cancel_follow_up" ? cancelSchema : null;
  if (!schema) invalid("不支援的社工追蹤操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("追蹤期限、計畫、結果、理由或版本未通過驗證。");
  const value = parsed.data;
  return {
    action: value.action,
    clientId: value.clientId,
    recordKey: value.recordKey,
    serviceVersionId: value.serviceVersionId,
    expectedSequence: value.expectedSequence,
    dueOn: value.action === "track" ? value.dueOn : null,
    followUpPlan: value.action === "track" ? value.followUpPlan : null,
    followUpOutcome: value.action === "complete_follow_up" ? value.followUpOutcome : null,
    transitionReason: value.action === "cancel_follow_up" ? value.transitionReason : null,
    idempotencyKey: parseIdempotencyKey(idempotencyKey),
  };
}

export function parseSocialWorkRecordOperationResult(
  value: unknown,
  action: SocialWorkRecordOperationResult["action"],
): Omit<SocialWorkRecordOperationResult, "persisted" | "demo"> {
  const parsed = recordRowSchema.safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "SOCIAL_WORK_RECEIPT_INVALID",
      "資料庫完成憑證格式不完整；畫面不會把操作當作成功。",
      502,
    );
  }
  return {
    receiptKind: "record",
    action,
    operationId: parsed.data.operation_id,
    recordKey: parsed.data.record_key,
    versionId: parsed.data.version_id,
    recordVersion: parsed.data.record_version,
    recordState: parsed.data.record_state,
    committedAt: parsed.data.committed_at,
    replayed: parsed.data.replayed,
  };
}

export function parseSocialWorkFollowUpOperationResult(
  value: unknown,
  action: SocialWorkFollowUpOperationResult["action"],
): Omit<SocialWorkFollowUpOperationResult, "persisted" | "demo"> {
  const parsed = followUpRowSchema.safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "SOCIAL_WORK_RECEIPT_INVALID",
      "資料庫追蹤完成憑證格式不完整；畫面不會把操作當作成功。",
      502,
    );
  }
  return {
    receiptKind: "follow_up",
    action,
    operationId: parsed.data.operation_id,
    recordKey: parsed.data.record_key,
    followUpEventId: parsed.data.follow_up_event_id,
    followUpSequence: parsed.data.follow_up_sequence,
    followUpStatus: parsed.data.follow_up_status,
    committedAt: parsed.data.committed_at,
    replayed: parsed.data.replayed,
  };
}

export type SocialWorkActionExpectation = {
  action: SocialWorkRecordOperationResult["action"] | SocialWorkFollowUpOperationResult["action"];
  recordKey?: string;
  expectedVersion?: number;
  expectedFollowUpSequence?: number;
};

export function parseSocialWorkActionSuccess(
  value: unknown,
  expectation: SocialWorkActionExpectation,
  httpStatus: number,
) {
  if (["create_draft", "revise_draft", "sign", "correct"].includes(expectation.action)) {
    const parsed = recordSuccessSchema.safeParse(value);
    if (!parsed.success) throw new Error("INVALID_SOCIAL_WORK_SUCCESS");
    const data = parsed.data.data;
    const expectedState = expectation.action === "create_draft" || expectation.action === "revise_draft"
      ? "draft" : expectation.action === "sign" ? "signed" : "corrected";
    if (
      data.action !== expectation.action || data.recordState !== expectedState ||
      (expectation.recordKey !== undefined && data.recordKey !== expectation.recordKey) ||
      (expectation.expectedVersion !== undefined && data.recordVersion !== expectation.expectedVersion + 1) ||
      (expectation.action === "create_draft" && data.recordVersion !== 1)
    ) throw new Error("MISMATCHED_SOCIAL_WORK_SUCCESS");
    if (httpStatus !== (data.replayed ? 200 : 201)) {
      throw new Error("INVALID_SOCIAL_WORK_HTTP_STATUS");
    }
    return parsed.data;
  }
  const parsed = followUpSuccessSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_SOCIAL_WORK_SUCCESS");
  const data = parsed.data.data;
  const expectedStatus = expectation.action === "track" ? "pending"
    : expectation.action === "complete_follow_up" ? "completed" : "cancelled";
  if (
    data.action !== expectation.action || data.followUpStatus !== expectedStatus ||
    (expectation.recordKey !== undefined && data.recordKey !== expectation.recordKey) ||
    (expectation.expectedFollowUpSequence !== undefined &&
      data.followUpSequence !== expectation.expectedFollowUpSequence + 1)
  ) throw new Error("MISMATCHED_SOCIAL_WORK_SUCCESS");
  if (httpStatus !== (data.replayed ? 200 : 201)) {
    throw new Error("INVALID_SOCIAL_WORK_HTTP_STATUS");
  }
  return parsed.data;
}

export function parseSocialWorkActionError(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
