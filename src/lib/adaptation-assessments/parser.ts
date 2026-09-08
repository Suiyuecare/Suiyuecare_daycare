import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  ADAPTATION_FOLLOW_UP_STATUSES,
  ADAPTATION_RECORD_STATES,
  ADAPTATION_STATUSES,
  type AdaptationAssessmentMutationInput,
  type AdaptationAssessmentOperationResult,
  type AdaptationFollowUpMutationInput,
  type AdaptationFollowUpOperationResult,
  type CreateAdaptationDraftInput,
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
const positiveInteger = z.number().int().positive().safe();
const nonnegativeInteger = z.number().int().nonnegative().safe();

const assessmentFields = {
  clientId: uuid,
  assessedOn: date,
  adaptationStatus: z.enum(ADAPTATION_STATUSES),
  assessmentSummary: narrative(5000),
  reassessmentDueOn: date,
  needsFollowUp: z.boolean(),
  formVersionReference: z.literal("manual-adaptation-v1"),
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

const trackSchema = z.object({
  action: z.literal("track"),
  clientId: uuid,
  assessmentKey: uuid,
  assessmentVersionId: uuid,
  expectedSequence: nonnegativeInteger,
  dueOn: date,
  followUpPlan: narrative(2000),
}).strict();
const completeSchema = z.object({
  action: z.literal("complete_follow_up"),
  clientId: uuid,
  assessmentKey: uuid,
  assessmentVersionId: uuid,
  expectedSequence: positiveInteger,
  followUpOutcome: narrative(2000),
}).strict();
const cancelSchema = z.object({
  action: z.literal("cancel_follow_up"),
  clientId: uuid,
  assessmentKey: uuid,
  assessmentVersionId: uuid,
  expectedSequence: positiveInteger,
  transitionReason: narrative(1000),
}).strict();

const assessmentRowSchema = z.object({
  operation_id: uuid,
  client_id: uuid,
  assessment_key: uuid,
  version_id: uuid,
  assessment_version: z.union([
    positiveInteger,
    z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(positiveInteger),
  ]),
  record_state: z.enum(ADAPTATION_RECORD_STATES),
  assessed_on: date,
  adaptation_status: z.enum(ADAPTATION_STATUSES),
  reassessment_due_on: date,
  needs_follow_up: z.boolean(),
  form_version_reference: z.literal("manual-adaptation-v1"),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();
const followUpRowSchema = z.object({
  operation_id: uuid,
  client_id: uuid,
  assessment_key: uuid,
  follow_up_event_id: uuid,
  follow_up_sequence: z.union([
    positiveInteger,
    z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(positiveInteger),
  ]),
  follow_up_status: z.enum(ADAPTATION_FOLLOW_UP_STATUSES),
  due_on: date.nullable(),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();

const errorDetailSchema = z.object({
  code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,119}$/u),
  message: z.string().trim().min(1).max(500),
  field: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/u).optional(),
}).strict();
const apiErrorSchema = z.object({
  requestId: uuid,
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(errorDetailSchema).min(1).max(10),
}).strict();
const assessmentSuccessSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.object({
    receiptKind: z.literal("assessment"),
    action: z.enum(["create_draft", "revise_draft", "sign", "correct"]),
    operationId: uuid,
    clientId: uuid,
    assessmentKey: uuid,
    versionId: uuid,
    assessmentVersion: positiveInteger,
    recordState: z.enum(ADAPTATION_RECORD_STATES),
    assessedOn: date,
    adaptationStatus: z.enum(ADAPTATION_STATUSES),
    reassessmentDueOn: date,
    needsFollowUp: z.boolean(),
    formVersionReference: z.literal("manual-adaptation-v1"),
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
    clientId: uuid,
    assessmentKey: uuid,
    followUpEventId: uuid,
    followUpSequence: positiveInteger,
    followUpStatus: z.enum(ADAPTATION_FOLLOW_UP_STATUSES),
    dueOn: date.nullable(),
    committedAt: timestamp,
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
  errors: z.tuple([]),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_ADAPTATION_ASSESSMENT", message, 400, field);
}

function parseIdempotencyKey(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return parsed.data;
}

function ensureDateOrder<T extends { assessedOn: string; reassessmentDueOn: string }>(value: T) {
  if (value.reassessmentDueOn < value.assessedOn) {
    invalid("人工輸入的複評期限不得早於評估日期。", "reassessmentDueOn");
  }
  return value;
}

export function parseCreateAdaptationDraft(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): CreateAdaptationDraftInput {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) invalid("個案、評估日期、人工適應狀態、摘要或複評期限未通過驗證。");
  return {
    ...ensureDateOrder(parsed.data),
    idempotencyKey: parseIdempotencyKey(idempotencyKey),
  };
}

export function parseAdaptationAssessmentMutation(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): AdaptationAssessmentMutationInput {
  const schema = body.action === "revise_draft" ? reviseSchema
    : body.action === "sign" ? signSchema
      : body.action === "correct" ? correctSchema : null;
  if (!schema) invalid("不支援的適應評估操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("評估內容、版本、簽署或更正理由未通過驗證。");
  const data = parsed.data;
  if (data.action !== "sign") ensureDateOrder(data);
  return {
    ...data,
    idempotencyKey: parseIdempotencyKey(idempotencyKey),
  } as AdaptationAssessmentMutationInput;
}

export function parseAdaptationFollowUpMutation(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): AdaptationFollowUpMutationInput {
  const schema = body.action === "track" ? trackSchema
    : body.action === "complete_follow_up" ? completeSchema
      : body.action === "cancel_follow_up" ? cancelSchema : null;
  if (!schema) invalid("不支援的適應追蹤操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("追蹤期限、計畫、結果、理由或版本未通過驗證。");
  const value = parsed.data;
  return {
    action: value.action,
    clientId: value.clientId,
    assessmentKey: value.assessmentKey,
    assessmentVersionId: value.assessmentVersionId,
    expectedSequence: value.expectedSequence,
    dueOn: value.action === "track" ? value.dueOn : null,
    followUpPlan: value.action === "track" ? value.followUpPlan : null,
    followUpOutcome: value.action === "complete_follow_up" ? value.followUpOutcome : null,
    transitionReason: value.action === "cancel_follow_up" ? value.transitionReason : null,
    idempotencyKey: parseIdempotencyKey(idempotencyKey),
  };
}

export function parseAdaptationAssessmentOperationResult(
  value: unknown,
  action: AdaptationAssessmentOperationResult["action"],
): Omit<AdaptationAssessmentOperationResult, "persisted" | "demo"> {
  const parsed = assessmentRowSchema.safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "ADAPTATION_RECEIPT_INVALID",
      "資料庫評估完成憑證格式不完整；畫面不會把操作當作成功。",
      502,
    );
  }
  return {
    receiptKind: "assessment",
    action,
    operationId: parsed.data.operation_id,
    clientId: parsed.data.client_id,
    assessmentKey: parsed.data.assessment_key,
    versionId: parsed.data.version_id,
    assessmentVersion: parsed.data.assessment_version,
    recordState: parsed.data.record_state,
    assessedOn: parsed.data.assessed_on,
    adaptationStatus: parsed.data.adaptation_status,
    reassessmentDueOn: parsed.data.reassessment_due_on,
    needsFollowUp: parsed.data.needs_follow_up,
    formVersionReference: parsed.data.form_version_reference,
    committedAt: parsed.data.committed_at,
    replayed: parsed.data.replayed,
  };
}

export function parseAdaptationFollowUpOperationResult(
  value: unknown,
  action: AdaptationFollowUpOperationResult["action"],
): Omit<AdaptationFollowUpOperationResult, "persisted" | "demo"> {
  const parsed = followUpRowSchema.safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "ADAPTATION_RECEIPT_INVALID",
      "資料庫追蹤完成憑證格式不完整；畫面不會把操作當作成功。",
      502,
    );
  }
  return {
    receiptKind: "follow_up",
    action,
    operationId: parsed.data.operation_id,
    clientId: parsed.data.client_id,
    assessmentKey: parsed.data.assessment_key,
    followUpEventId: parsed.data.follow_up_event_id,
    followUpSequence: parsed.data.follow_up_sequence,
    followUpStatus: parsed.data.follow_up_status,
    dueOn: parsed.data.due_on,
    committedAt: parsed.data.committed_at,
    replayed: parsed.data.replayed,
  };
}

export type AdaptationActionExpectation = {
  action: AdaptationAssessmentOperationResult["action"] | AdaptationFollowUpOperationResult["action"];
  clientId: string;
  assessmentKey?: string;
  expectedVersion?: number;
  expectedFollowUpSequence?: number;
};

export function parseAdaptationActionSuccess(
  value: unknown,
  expectation: AdaptationActionExpectation,
  httpStatus: number,
) {
  if (["create_draft", "revise_draft", "sign", "correct"].includes(expectation.action)) {
    const parsed = assessmentSuccessSchema.safeParse(value);
    if (!parsed.success) throw new Error("INVALID_ADAPTATION_SUCCESS");
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
      (expectation.action === "create_draft" && data.assessmentVersion !== 1)
    ) throw new Error("MISMATCHED_ADAPTATION_SUCCESS");
    if (httpStatus !== (data.replayed ? 200 : 201)) {
      throw new Error("INVALID_ADAPTATION_HTTP_STATUS");
    }
    return parsed.data;
  }
  const parsed = followUpSuccessSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_ADAPTATION_SUCCESS");
  const data = parsed.data.data;
  const expectedStatus = expectation.action === "track" ? "pending"
    : expectation.action === "complete_follow_up" ? "completed" : "cancelled";
  if (
    data.action !== expectation.action || data.clientId !== expectation.clientId ||
    data.followUpStatus !== expectedStatus ||
    (expectation.assessmentKey !== undefined &&
      data.assessmentKey !== expectation.assessmentKey) ||
    (expectation.expectedFollowUpSequence !== undefined &&
      data.followUpSequence !== expectation.expectedFollowUpSequence + 1) ||
    (data.followUpStatus === "pending") !== (data.dueOn !== null)
  ) throw new Error("MISMATCHED_ADAPTATION_SUCCESS");
  if (httpStatus !== (data.replayed ? 200 : 201)) {
    throw new Error("INVALID_ADAPTATION_HTTP_STATUS");
  }
  return parsed.data;
}

export function parseAdaptationActionError(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
