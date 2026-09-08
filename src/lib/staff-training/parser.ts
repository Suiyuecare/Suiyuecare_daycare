import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { isStaffTrainingCalendarDate, staffTrainingTaipeiDate } from "./date";
import {
  canonicalStaffTrainingDecimal,
  staffTrainingDecimalEqual,
  staffTrainingDecimalToScaledInteger,
} from "./decimal";
import type {
  StaffTrainingRecordInput,
  StaffTrainingRecordReceipt,
  StaffTrainingRuleInput,
  StaffTrainingRuleReceipt,
} from "./types";

export const STAFF_TRAINING_RECORD_MAX_BYTES = 48 * 1024;
export const STAFF_TRAINING_RULE_MAX_BYTES = 16 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const date = z.string().refine(isStaffTrainingCalendarDate);
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const decimal = z.string().trim()
  .regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u);
const positiveDecimal = decimal.refine((value) => {
  try { return staffTrainingDecimalToScaledInteger(value) > BigInt(0); }
  catch { return false; }
});

const contentSchema = {
  training_key: uuid, staff_membership_id: uuid, course_title: clean(240),
  training_date: date, starts_at: timestamp, ends_at: timestamp,
  course_type: clean(120), hours: positiveDecimal, credits: decimal.nullable(),
  provider_name: clean(200), evidence_status: z.enum(["missing", "not_applicable"]),
  attachment_reference: z.null(), attachment_sha256: z.null(),
};
const recordInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...contentSchema,
    previous_version_id: z.null(), expected_base_version: z.literal(0),
    correction_reason: z.null(),
  }).strict(),
  z.object({ action: z.literal("correct"), ...contentSchema,
    previous_version_id: uuid, expected_base_version: z.number().int().positive().safe(),
    correction_reason: clean(1_000, true),
  }).strict(),
  z.object({ action: z.literal("void"), training_key: uuid,
    previous_version_id: uuid, expected_base_version: z.number().int().positive().safe(),
    staff_membership_id: uuid, correction_reason: clean(1_000, true),
  }).strict(),
]);

const ruleInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("propose"), effective_from: date,
    effective_to: date.nullable(), window_years: z.number().int().min(1).max(50),
    required_credits: positiveDecimal,
    expiry_notice_days: z.number().int().min(0).max(3650),
  }).strict(),
  z.object({ action: z.literal("publish"), proposal_id: uuid }).strict(),
]);

const recordReceiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, training_key: uuid,
  record_version_id: uuid, version: z.number().int().positive().safe(),
  previous_version_id: uuid.nullable(), record_status: z.enum(["active", "voided"]),
  staff_membership_id: uuid, content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  recorded_at: timestamp, replayed: z.boolean(),
}).strict();
const ruleReceiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, action: z.enum(["propose", "publish"]),
  proposal_id: uuid, rule_version_id: uuid.nullable(),
  version: z.number().int().positive().safe().nullable(), effective_from: date,
  effective_to: date.nullable(), window_years: z.number().int().min(1).max(50),
  required_credits: decimal, expiry_notice_days: z.number().int().min(0).max(3650),
  committed_at: timestamp, replayed: z.boolean(),
}).strict();

const recordApiReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, trainingKey: uuid, recordVersionId: uuid,
  version: z.number().int().positive().safe(), previousVersionId: uuid.nullable(),
  recordStatus: z.enum(["active", "voided"]), staffMembershipId: uuid,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u), recordedAt: timestamp,
  replayed: z.boolean(), persisted: z.literal(true), demo: z.literal(false),
}).strict();
const ruleApiReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, action: z.enum(["propose", "publish"]),
  proposalId: uuid, ruleVersionId: uuid.nullable(),
  version: z.number().int().positive().safe().nullable(), effectiveFrom: date,
  effectiveTo: date.nullable(), windowYears: z.number().int().min(1).max(50),
  requiredCredits: decimal, expiryNoticeDays: z.number().int().min(0).max(3650),
  committedAt: timestamp, replayed: z.boolean(), persisted: z.literal(true),
  demo: z.literal(false),
}).strict();
const envelopeSchema = z.object({
  requestId: uuid, status: z.literal("ok"), data: z.unknown(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(code: string, message: string): never {
  throw new IntegrationError(code, message, 400);
}
function uncertain(message: string): never {
  throw new IntegrationError("STAFF_TRAINING_RECEIPT_INVALID", message, 409);
}

export function parseStaffTrainingRecordInput(
  value: unknown,
  idempotencyHeader: string | null,
): StaffTrainingRecordInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = recordInputSchema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "INVALID_STAFF_TRAINING_RECORD",
    "請完整填寫訓練內容、穩定員工識別與有效操作鍵。",
  );
  const body = parsed.data;
  if (body.action === "void") return {
    action: "void", trainingKey: body.training_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version,
    staffMembershipId: body.staff_membership_id,
    courseTitle: null, trainingDate: null, startsAt: null, endsAt: null,
    courseType: null, hours: null, credits: null, providerName: null,
    evidenceStatus: null, attachmentReference: null, attachmentSha256: null,
    correctionReason: body.correction_reason, idempotencyKey: key.data,
  };
  if (Date.parse(body.ends_at) <= Date.parse(body.starts_at) ||
    Date.parse(body.ends_at) > Date.now() + 60_000 ||
    staffTrainingTaipeiDate(body.starts_at) !== body.training_date) invalid(
    "INVALID_STAFF_TRAINING_RECORD", "課程日期、起訖時間或完成狀態不正確。",
  );
  return {
    action: body.action, trainingKey: body.training_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version,
    staffMembershipId: body.staff_membership_id, courseTitle: body.course_title,
    trainingDate: body.training_date, startsAt: body.starts_at, endsAt: body.ends_at,
    courseType: body.course_type, hours: canonicalStaffTrainingDecimal(body.hours),
    credits: body.credits === null ? null : canonicalStaffTrainingDecimal(body.credits),
    providerName: body.provider_name, evidenceStatus: body.evidence_status,
    attachmentReference: null, attachmentSha256: null,
    correctionReason: body.correction_reason, idempotencyKey: key.data,
  };
}

export function parseStaffTrainingRuleInput(
  value: unknown,
  idempotencyHeader: string | null,
): StaffTrainingRuleInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = ruleInputSchema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "INVALID_STAFF_TRAINING_RULE", "請完整填寫規則內容並使用有效操作鍵。",
  );
  if (parsed.data.action === "publish") return {
    action: "publish", proposalId: parsed.data.proposal_id,
    effectiveFrom: null, effectiveTo: null, windowYears: null,
    requiredCredits: null, expiryNoticeDays: null, idempotencyKey: key.data,
  };
  if (parsed.data.effective_to !== null &&
    parsed.data.effective_to < parsed.data.effective_from) invalid(
    "INVALID_STAFF_TRAINING_RULE", "規則生效期間不正確。",
  );
  return {
    action: "propose", effectiveFrom: parsed.data.effective_from,
    effectiveTo: parsed.data.effective_to, windowYears: parsed.data.window_years,
    requiredCredits: canonicalStaffTrainingDecimal(parsed.data.required_credits),
    expiryNoticeDays: parsed.data.expiry_notice_days, proposalId: null,
    idempotencyKey: key.data,
  };
}

export function parseStaffTrainingRecordReceipt(
  value: unknown,
  input: StaffTrainingRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): StaffTrainingRecordReceipt {
  const parsed = recordReceiptSchema.safeParse(value);
  const expectedVersion = input.action === "create" ? 1 : input.expectedBaseVersion + 1;
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId ||
    parsed.data.training_key !== input.trainingKey ||
    parsed.data.staff_membership_id !== input.staffMembershipId ||
    parsed.data.version !== expectedVersion ||
    parsed.data.previous_version_id !== input.previousVersionId ||
    parsed.data.record_status !== (input.action === "void" ? "voided" : "active") ||
    Date.parse(parsed.data.recorded_at) > Date.now() + 60_000 ||
    (input.action !== "void" && Date.parse(parsed.data.recorded_at) < Date.parse(input.endsAt))) {
    uncertain("訓練紀錄結果無法與送出內容核對；請保留相同操作鍵重試。");
  }
  return {
    organizationId: parsed.data.organization_id, branchId: parsed.data.branch_id,
    trainingKey: parsed.data.training_key,
    recordVersionId: parsed.data.record_version_id, version: parsed.data.version,
    previousVersionId: parsed.data.previous_version_id,
    recordStatus: parsed.data.record_status,
    staffMembershipId: parsed.data.staff_membership_id,
    contentHash: parsed.data.content_hash, recordedAt: parsed.data.recorded_at,
    replayed: parsed.data.replayed, persisted: true, demo: false,
  };
}

export function parseStaffTrainingRuleReceipt(
  value: unknown,
  input: StaffTrainingRuleInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): StaffTrainingRuleReceipt {
  const parsed = ruleReceiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId || parsed.data.action !== input.action ||
    Date.parse(parsed.data.committed_at) > Date.now() + 60_000 ||
    (input.action === "propose" && (parsed.data.rule_version_id !== null ||
      parsed.data.version !== null || parsed.data.effective_from !== input.effectiveFrom ||
      parsed.data.effective_to !== input.effectiveTo ||
      parsed.data.window_years !== input.windowYears ||
      !staffTrainingDecimalEqual(parsed.data.required_credits, input.requiredCredits) ||
      parsed.data.expiry_notice_days !== input.expiryNoticeDays)) ||
    (input.action === "publish" && (parsed.data.proposal_id !== input.proposalId ||
      parsed.data.rule_version_id === null || parsed.data.version === null))) {
    uncertain("訓練規則結果無法與送出內容核對；請保留相同操作鍵重試。");
  }
  return {
    organizationId: parsed.data.organization_id, branchId: parsed.data.branch_id,
    action: parsed.data.action, proposalId: parsed.data.proposal_id,
    ruleVersionId: parsed.data.rule_version_id, version: parsed.data.version,
    effectiveFrom: parsed.data.effective_from, effectiveTo: parsed.data.effective_to,
    windowYears: parsed.data.window_years,
    requiredCredits: canonicalStaffTrainingDecimal(parsed.data.required_credits),
    expiryNoticeDays: parsed.data.expiry_notice_days,
    committedAt: parsed.data.committed_at, replayed: parsed.data.replayed,
    persisted: true, demo: false,
  };
}

export function parseStaffTrainingRecordApiEnvelope(
  value: unknown,
  input: StaffTrainingRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
) {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) uncertain("訓練紀錄回應格式不完整。");
  const data = z.object({ receipt: recordApiReceiptSchema,
    persisted: z.literal(true), demo: z.literal(false),
  }).strict().safeParse(parsed.data.data);
  if (!data.success) uncertain("訓練紀錄回應內容不完整。");
  const receipt = data.data.receipt;
  parseStaffTrainingRecordReceipt({
    organization_id: receipt.organizationId, branch_id: receipt.branchId,
    training_key: receipt.trainingKey, record_version_id: receipt.recordVersionId,
    version: receipt.version, previous_version_id: receipt.previousVersionId,
    record_status: receipt.recordStatus, staff_membership_id: receipt.staffMembershipId,
    content_hash: receipt.contentHash, recorded_at: receipt.recordedAt,
    replayed: receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  return data.data.receipt;
}

export function parseStaffTrainingRuleApiEnvelope(
  value: unknown,
  input: StaffTrainingRuleInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
) {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) uncertain("訓練規則回應格式不完整。");
  const data = z.object({ receipt: ruleApiReceiptSchema,
    persisted: z.literal(true), demo: z.literal(false),
  }).strict().safeParse(parsed.data.data);
  if (!data.success) uncertain("訓練規則回應內容不完整。");
  const receipt = data.data.receipt;
  parseStaffTrainingRuleReceipt({
    organization_id: receipt.organizationId, branch_id: receipt.branchId,
    action: receipt.action, proposal_id: receipt.proposalId,
    rule_version_id: receipt.ruleVersionId, version: receipt.version,
    effective_from: receipt.effectiveFrom, effective_to: receipt.effectiveTo,
    window_years: receipt.windowYears, required_credits: receipt.requiredCredits,
    expiry_notice_days: receipt.expiryNoticeDays, committed_at: receipt.committedAt,
    replayed: receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  return data.data.receipt;
}
