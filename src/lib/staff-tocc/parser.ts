import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { isStaffToccDate } from "./date";
import type { StaffToccRecordInput, StaffToccRecordReceipt } from "./types";

export const STAFF_TOCC_RECORD_MAX_BYTES = 64 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().refine(isStaffToccDate);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const disposition = z.enum(["not_recorded", "pending", "in_progress", "completed"]);

const contentSchema = {
  tocc_key: uuid,
  staff_membership_id: uuid,
  assessed_on: date,
  valid_through: date,
  validity_source: clean(240),
  result_text: clean(1_000, true),
  manual_attention_flag: z.boolean(),
  attention_note: clean(1_000, true).nullable(),
  evidence_status: z.enum(["missing", "not_applicable"]),
  attachment_reference: z.null(),
  attachment_sha256: z.null(),
  disposition_status: disposition,
  disposition_note: clean(1_000, true).nullable(),
};

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...contentSchema,
    previous_version_id: z.null(), expected_base_version: z.literal(0),
    correction_reason: z.null(),
  }).strict(),
  z.object({ action: z.literal("correct"), ...contentSchema,
    previous_version_id: uuid,
    expected_base_version: z.number().int().positive().safe(),
    correction_reason: clean(1_000, true),
  }).strict(),
  z.object({ action: z.literal("void"), tocc_key: uuid,
    previous_version_id: uuid,
    expected_base_version: z.number().int().positive().safe(),
    staff_membership_id: uuid, correction_reason: clean(1_000, true),
  }).strict(),
]);

const receiptShape = {
  organization_id: uuid,
  branch_id: uuid,
  tocc_key: uuid,
  record_version_id: uuid,
  version: z.number().int().positive().safe(),
  previous_version_id: uuid.nullable(),
  record_status: z.enum(["active", "voided"]),
  staff_membership_id: uuid,
  content_hash: hash,
  evaluated_on: date,
  expiry_warning: z.boolean(),
  manual_attention_warning: z.boolean(),
  warning_basis: z.literal("manual_valid_through_and_manual_attention_flag"),
  recorded_at: timestamp,
  replayed: z.boolean(),
};
const receiptSchema = z.object(receiptShape).strict();
const apiReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, toccKey: uuid, recordVersionId: uuid,
  version: z.number().int().positive().safe(), previousVersionId: uuid.nullable(),
  recordStatus: z.enum(["active", "voided"]), staffMembershipId: uuid,
  contentHash: hash, evaluatedOn: date, expiryWarning: z.boolean(),
  manualAttentionWarning: z.boolean(),
  warningBasis: z.literal("manual_valid_through_and_manual_attention_flag"),
  recordedAt: timestamp, replayed: z.boolean(), persisted: z.literal(true),
  demo: z.literal(false),
}).strict();
const envelopeSchema = z.object({
  requestId: uuid, status: z.literal("ok"), data: z.unknown(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_STAFF_TOCC_RECORD", message, 400);
}

function uncertain(message: string): never {
  throw new IntegrationError("STAFF_TOCC_RECEIPT_INVALID", message, 409);
}

function contentIsAligned(body: z.infer<typeof inputSchema>) {
  if (body.action === "void") return true;
  return body.valid_through >= body.assessed_on &&
    body.manual_attention_flag === (body.attention_note !== null) &&
    ((body.disposition_status === "not_recorded") === (body.disposition_note === null));
}

export function parseStaffToccRecordInput(
  value: unknown,
  idempotencyHeader: string | null,
): StaffToccRecordInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = inputSchema.safeParse(value);
  if (!key.success || !parsed.success || !contentIsAligned(parsed.data)) invalid(
    "請完整填寫員工、評估日、人工效期與來源、結果、人工警示、證明、處置、版本與操作鍵。",
  );
  const body = parsed.data;
  if (body.action === "void") return {
    action: "void", toccKey: body.tocc_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version,
    staffMembershipId: body.staff_membership_id,
    assessedOn: null, validThrough: null, validitySource: null, resultText: null,
    manualAttentionFlag: null, attentionNote: null, evidenceStatus: null,
    attachmentReference: null, attachmentSha256: null,
    dispositionStatus: null, dispositionNote: null,
    correctionReason: body.correction_reason, idempotencyKey: key.data,
  };
  return {
    action: body.action, toccKey: body.tocc_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version,
    staffMembershipId: body.staff_membership_id,
    assessedOn: body.assessed_on, validThrough: body.valid_through,
    validitySource: body.validity_source, resultText: body.result_text,
    manualAttentionFlag: body.manual_attention_flag,
    attentionNote: body.attention_note, evidenceStatus: body.evidence_status,
    attachmentReference: null, attachmentSha256: null,
    dispositionStatus: body.disposition_status,
    dispositionNote: body.disposition_note,
    correctionReason: body.correction_reason, idempotencyKey: key.data,
  };
}

export function parseStaffToccRecordReceipt(
  value: unknown,
  input: StaffToccRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): StaffToccRecordReceipt {
  const parsed = receiptSchema.safeParse(value);
  const expectedVersion = input.action === "create" ? 1 : input.expectedBaseVersion + 1;
  const expectedExpiry = input.action === "void" ? false : input.validThrough <
    (parsed.success ? parsed.data.evaluated_on : "0000-00-00");
  const expectedAttention = input.action === "void" ? false : input.manualAttentionFlag;
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId ||
    parsed.data.tocc_key !== input.toccKey || parsed.data.version !== expectedVersion ||
    parsed.data.previous_version_id !== input.previousVersionId ||
    parsed.data.record_status !== (input.action === "void" ? "voided" : "active") ||
    parsed.data.staff_membership_id !== input.staffMembershipId ||
    parsed.data.expiry_warning !== expectedExpiry ||
    parsed.data.manual_attention_warning !== expectedAttention) {
    uncertain("員工 TOCC 保存結果無法與送出內容核對；請保留相同操作鍵重試。");
  }
  return {
    organizationId: parsed.data.organization_id, branchId: parsed.data.branch_id,
    toccKey: parsed.data.tocc_key, recordVersionId: parsed.data.record_version_id,
    version: parsed.data.version, previousVersionId: parsed.data.previous_version_id,
    recordStatus: parsed.data.record_status,
    staffMembershipId: parsed.data.staff_membership_id,
    contentHash: parsed.data.content_hash, evaluatedOn: parsed.data.evaluated_on,
    expiryWarning: parsed.data.expiry_warning,
    manualAttentionWarning: parsed.data.manual_attention_warning,
    warningBasis: parsed.data.warning_basis, recordedAt: parsed.data.recorded_at,
    replayed: parsed.data.replayed, persisted: true, demo: false,
  };
}

export function parseStaffToccRecordApiEnvelope(
  value: unknown,
  input: StaffToccRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
) {
  const envelope = envelopeSchema.safeParse(value);
  if (!envelope.success) uncertain("員工 TOCC 保存回應格式不完整。");
  const data = z.object({ receipt: apiReceiptSchema, persisted: z.literal(true),
    demo: z.literal(false),
  }).strict().safeParse(envelope.data.data);
  if (!data.success) uncertain("員工 TOCC 保存回應內容不完整。");
  parseStaffToccRecordReceipt({
    organization_id: data.data.receipt.organizationId,
    branch_id: data.data.receipt.branchId,
    tocc_key: data.data.receipt.toccKey,
    record_version_id: data.data.receipt.recordVersionId,
    version: data.data.receipt.version,
    previous_version_id: data.data.receipt.previousVersionId,
    record_status: data.data.receipt.recordStatus,
    staff_membership_id: data.data.receipt.staffMembershipId,
    content_hash: data.data.receipt.contentHash,
    evaluated_on: data.data.receipt.evaluatedOn,
    expiry_warning: data.data.receipt.expiryWarning,
    manual_attention_warning: data.data.receipt.manualAttentionWarning,
    warning_basis: data.data.receipt.warningBasis,
    recorded_at: data.data.receipt.recordedAt,
    replayed: data.data.receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  if (httpStatus !== (data.data.receipt.replayed ? 200 : 201)) {
    uncertain("員工 TOCC 保存回應狀態與完成憑證不一致；請保留相同操作鍵重試。");
  }
  return data.data.receipt;
}
