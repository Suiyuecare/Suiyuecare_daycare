import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { isStaffLabReportDate } from "./date";
import type { StaffLabReportRecordInput, StaffLabReportRecordReceipt } from "./types";

export const STAFF_LAB_REPORT_RECORD_MAX_BYTES = 64 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().refine(isStaffLabReportDate);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().safe();
const duplicateBasis = z.literal(
  "exact_content_or_same_staff_type_tested_on_provider",
);

const contentSchema = {
  report_key: uuid,
  staff_membership_id: uuid,
  report_type: clean(160),
  tested_on: date,
  provider_name: clean(200),
  result_text: clean(2_000, true),
  valid_through: date,
  validity_basis: clean(500, true),
  evidence_status: z.enum(["missing", "not_applicable"]),
  attachment_reference: z.null(),
  attachment_sha256: z.null(),
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
  z.object({ action: z.literal("void"), report_key: uuid,
    previous_version_id: uuid,
    expected_base_version: z.number().int().positive().safe(),
    staff_membership_id: uuid, correction_reason: clean(1_000, true),
  }).strict(),
]);

const receiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, report_key: uuid,
  record_version_id: uuid, version: z.number().int().positive().safe(),
  previous_version_id: uuid.nullable(), record_status: z.enum(["active", "voided"]),
  completion_status: z.literal("completed"), staff_membership_id: uuid,
  content_hash: hash, exact_duplicate_count: count,
  key_field_duplicate_count: count, duplicate_warning: z.boolean(),
  duplicate_basis: duplicateBasis, recorded_at: timestamp, replayed: z.boolean(),
}).strict();

const apiReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, reportKey: uuid, recordVersionId: uuid,
  version: z.number().int().positive().safe(), previousVersionId: uuid.nullable(),
  recordStatus: z.enum(["active", "voided"]), completionStatus: z.literal("completed"),
  staffMembershipId: uuid, contentHash: hash, exactDuplicateCount: count,
  keyFieldDuplicateCount: count, duplicateWarning: z.boolean(),
  duplicateBasis, recordedAt: timestamp, replayed: z.boolean(),
  persisted: z.literal(true), demo: z.literal(false),
}).strict();

const envelopeSchema = z.object({
  requestId: uuid, status: z.literal("ok"), data: z.unknown(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_STAFF_LAB_REPORT_RECORD", message, 400);
}

function uncertain(message: string): never {
  throw new IntegrationError("STAFF_LAB_REPORT_RECEIPT_INVALID", message, 409);
}

export function parseStaffLabReportRecordInput(
  value: unknown,
  idempotencyHeader: string | null,
): StaffLabReportRecordInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = inputSchema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "請完整填寫員工、檢驗資料、人工效期、證明狀態、版本與操作鍵。",
  );
  const body = parsed.data;
  if (body.action === "void") return {
    action: "void", reportKey: body.report_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version,
    staffMembershipId: body.staff_membership_id,
    reportType: null, testedOn: null, providerName: null, resultText: null,
    validThrough: null, validityBasis: null, evidenceStatus: null,
    attachmentReference: null, attachmentSha256: null,
    correctionReason: body.correction_reason, idempotencyKey: key.data,
  };
  if (body.valid_through < body.tested_on) invalid(
    "人工輸入的有效至不得早於檢驗日期。",
  );
  return {
    action: body.action, reportKey: body.report_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version,
    staffMembershipId: body.staff_membership_id, reportType: body.report_type,
    testedOn: body.tested_on, providerName: body.provider_name,
    resultText: body.result_text, validThrough: body.valid_through,
    validityBasis: body.validity_basis, evidenceStatus: body.evidence_status,
    attachmentReference: null, attachmentSha256: null,
    correctionReason: body.correction_reason, idempotencyKey: key.data,
  };
}

export function parseStaffLabReportRecordReceipt(
  value: unknown,
  input: StaffLabReportRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): StaffLabReportRecordReceipt {
  const parsed = receiptSchema.safeParse(value);
  const expectedVersion = input.action === "create" ? 1 : input.expectedBaseVersion + 1;
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId ||
    parsed.data.report_key !== input.reportKey || parsed.data.version !== expectedVersion ||
    parsed.data.previous_version_id !== input.previousVersionId ||
    parsed.data.record_status !== (input.action === "void" ? "voided" : "active") ||
    parsed.data.staff_membership_id !== input.staffMembershipId ||
    parsed.data.key_field_duplicate_count < parsed.data.exact_duplicate_count ||
    parsed.data.duplicate_warning !== (parsed.data.key_field_duplicate_count > 0) ||
    (input.action === "void" && (parsed.data.exact_duplicate_count !== 0 ||
      parsed.data.key_field_duplicate_count !== 0))) {
    uncertain("檢驗報告保存結果無法與送出內容核對；請保留相同操作鍵重試。");
  }
  return {
    organizationId: parsed.data.organization_id, branchId: parsed.data.branch_id,
    reportKey: parsed.data.report_key, recordVersionId: parsed.data.record_version_id,
    version: parsed.data.version, previousVersionId: parsed.data.previous_version_id,
    recordStatus: parsed.data.record_status,
    completionStatus: parsed.data.completion_status,
    staffMembershipId: parsed.data.staff_membership_id,
    contentHash: parsed.data.content_hash,
    exactDuplicateCount: parsed.data.exact_duplicate_count,
    keyFieldDuplicateCount: parsed.data.key_field_duplicate_count,
    duplicateWarning: parsed.data.duplicate_warning,
    duplicateBasis: parsed.data.duplicate_basis,
    recordedAt: parsed.data.recorded_at, replayed: parsed.data.replayed,
    persisted: true, demo: false,
  };
}

export function parseStaffLabReportRecordApiEnvelope(
  value: unknown,
  input: StaffLabReportRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
) {
  const envelope = envelopeSchema.safeParse(value);
  if (!envelope.success) uncertain("檢驗報告保存回應格式不完整。");
  const data = z.object({ receipt: apiReceiptSchema,
    persisted: z.literal(true), demo: z.literal(false),
  }).strict().safeParse(envelope.data.data);
  if (!data.success) uncertain("檢驗報告保存回應內容不完整。");
  parseStaffLabReportRecordReceipt({
    organization_id: data.data.receipt.organizationId,
    branch_id: data.data.receipt.branchId,
    report_key: data.data.receipt.reportKey,
    record_version_id: data.data.receipt.recordVersionId,
    version: data.data.receipt.version,
    previous_version_id: data.data.receipt.previousVersionId,
    record_status: data.data.receipt.recordStatus,
    completion_status: data.data.receipt.completionStatus,
    staff_membership_id: data.data.receipt.staffMembershipId,
    content_hash: data.data.receipt.contentHash,
    exact_duplicate_count: data.data.receipt.exactDuplicateCount,
    key_field_duplicate_count: data.data.receipt.keyFieldDuplicateCount,
    duplicate_warning: data.data.receipt.duplicateWarning,
    duplicate_basis: data.data.receipt.duplicateBasis,
    recorded_at: data.data.receipt.recordedAt,
    replayed: data.data.receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  if (httpStatus !== (data.data.receipt.replayed ? 200 : 201)) uncertain(
    "檢驗報告保存回應狀態與完成憑證不一致；請保留相同操作鍵重試。",
  );
  return data.data.receipt;
}
