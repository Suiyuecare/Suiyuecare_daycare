import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { isStaffCertificateDate } from "./date";
import type {
  StaffCertificateExceptionInput,
  StaffCertificateExceptionReceipt,
  StaffCertificateRecordInput,
  StaffCertificateRecordReceipt,
} from "./types";

export const STAFF_CERTIFICATE_RECORD_MAX_BYTES = 48 * 1024;
export const STAFF_CERTIFICATE_EXCEPTION_MAX_BYTES = 24 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().refine(isStaffCertificateDate);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);

const contentSchema = {
  certificate_key: uuid,
  staff_membership_id: uuid,
  certificate_type: clean(120),
  certificate_number: clean(160),
  effective_on: date,
  expires_on: date.nullable(),
  registration_status: z.enum(["pending", "registered", "not_required", "suspended"]),
  verification_status: z.enum(["pending", "verified", "rejected"]),
  evidence_status: z.enum(["missing", "not_applicable"]),
  attachment_reference: z.null(),
  attachment_sha256: z.null(),
};

const recordInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...contentSchema,
    previous_version_id: z.null(), expected_base_version: z.literal(0),
    correction_reason: z.null(),
  }).strict(),
  z.object({ action: z.literal("correct"), ...contentSchema,
    previous_version_id: uuid,
    expected_base_version: z.number().int().positive().safe(),
    correction_reason: clean(1_000, true),
  }).strict(),
  z.object({ action: z.literal("void"), certificate_key: uuid,
    previous_version_id: uuid,
    expected_base_version: z.number().int().positive().safe(),
    staff_membership_id: uuid, correction_reason: clean(1_000, true),
  }).strict(),
]);

const exceptionInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), certificate_key: uuid,
    certificate_version_id: uuid,
    expected_certificate_version: z.number().int().positive().safe(),
    valid_from: date, valid_through: date, reason: clean(1_000, true),
  }).strict(),
  z.object({ action: z.literal("approve"), request_id: uuid,
    certificate_key: uuid, certificate_version_id: uuid,
    expected_certificate_version: z.number().int().positive().safe(),
    expected_approval_count: z.union([z.literal(0), z.literal(1)]),
  }).strict(),
]);

const recordReceiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, certificate_key: uuid,
  record_version_id: uuid, version: z.number().int().positive().safe(),
  previous_version_id: uuid.nullable(), record_status: z.enum(["active", "voided"]),
  staff_membership_id: uuid, content_hash: hash, recorded_at: timestamp,
  replayed: z.boolean(),
}).strict();

const exceptionReceiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, action: z.enum(["request", "approve"]),
  request_id: uuid, certificate_key: uuid, certificate_version_id: uuid,
  expected_certificate_version: z.number().int().positive().safe(),
  approval_id: uuid.nullable(), approval_count: z.number().int().min(0).max(2),
  exception_status: z.enum(["pending", "approved"]), valid_from: date,
  valid_through: date, committed_at: timestamp, replayed: z.boolean(),
}).strict();

const recordApiReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, certificateKey: uuid,
  recordVersionId: uuid, version: z.number().int().positive().safe(),
  previousVersionId: uuid.nullable(), recordStatus: z.enum(["active", "voided"]),
  staffMembershipId: uuid, contentHash: hash, recordedAt: timestamp,
  replayed: z.boolean(), persisted: z.literal(true), demo: z.literal(false),
}).strict();

const exceptionApiReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, action: z.enum(["request", "approve"]),
  requestId: uuid, certificateKey: uuid, certificateVersionId: uuid,
  expectedCertificateVersion: z.number().int().positive().safe(),
  approvalId: uuid.nullable(), approvalCount: z.number().int().min(0).max(2),
  exceptionStatus: z.enum(["pending", "approved"]), validFrom: date,
  validThrough: date, committedAt: timestamp, replayed: z.boolean(),
  persisted: z.literal(true), demo: z.literal(false),
}).strict();

const envelopeSchema = z.object({
  requestId: uuid, status: z.literal("ok"), data: z.unknown(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(code: string, message: string): never {
  throw new IntegrationError(code, message, 400);
}
function uncertain(message: string): never {
  throw new IntegrationError("STAFF_CERTIFICATE_RECEIPT_INVALID", message, 409);
}

export function parseStaffCertificateRecordInput(
  value: unknown,
  idempotencyHeader: string | null,
): StaffCertificateRecordInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = recordInputSchema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "INVALID_STAFF_CERTIFICATE_RECORD",
    "請完整填寫證照、人員、版本與有效操作鍵。",
  );
  const body = parsed.data;
  if (body.action === "void") return {
    action: "void", certificateKey: body.certificate_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version,
    staffMembershipId: body.staff_membership_id,
    certificateType: null, certificateNumber: null, effectiveOn: null,
    expiresOn: null, registrationStatus: null, verificationStatus: null,
    evidenceStatus: null, attachmentReference: null, attachmentSha256: null,
    correctionReason: body.correction_reason, idempotencyKey: key.data,
  };
  if (body.expires_on !== null && body.expires_on < body.effective_on) invalid(
    "INVALID_STAFF_CERTIFICATE_RECORD", "證照到期日不得早於生效日。",
  );
  return {
    action: body.action, certificateKey: body.certificate_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version,
    staffMembershipId: body.staff_membership_id,
    certificateType: body.certificate_type,
    certificateNumber: body.certificate_number,
    effectiveOn: body.effective_on, expiresOn: body.expires_on,
    registrationStatus: body.registration_status,
    verificationStatus: body.verification_status,
    evidenceStatus: body.evidence_status,
    attachmentReference: null, attachmentSha256: null,
    correctionReason: body.correction_reason, idempotencyKey: key.data,
  };
}

export function parseStaffCertificateExceptionInput(
  value: unknown,
  idempotencyHeader: string | null,
): StaffCertificateExceptionInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = exceptionInputSchema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "INVALID_STAFF_CERTIFICATE_EXCEPTION",
    "請完整填寫例外期間、理由、版本與有效操作鍵。",
  );
  const body = parsed.data;
  if (body.action === "request") {
    if (body.valid_through < body.valid_from) invalid(
      "INVALID_STAFF_CERTIFICATE_EXCEPTION", "例外截止日不得早於起始日。",
    );
    return {
      action: "request", certificateKey: body.certificate_key,
      certificateVersionId: body.certificate_version_id,
      expectedCertificateVersion: body.expected_certificate_version,
      validFrom: body.valid_from, validThrough: body.valid_through,
      reason: body.reason, requestId: null, expectedApprovalCount: null,
      idempotencyKey: key.data,
    };
  }
  return {
    action: "approve", requestId: body.request_id,
    certificateKey: body.certificate_key,
    certificateVersionId: body.certificate_version_id,
    expectedCertificateVersion: body.expected_certificate_version,
    expectedApprovalCount: body.expected_approval_count,
    validFrom: null, validThrough: null, reason: null,
    idempotencyKey: key.data,
  };
}

export function parseStaffCertificateRecordReceipt(
  value: unknown,
  input: StaffCertificateRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): StaffCertificateRecordReceipt {
  const parsed = recordReceiptSchema.safeParse(value);
  const expectedVersion = input.action === "create" ? 1 : input.expectedBaseVersion + 1;
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId ||
    parsed.data.certificate_key !== input.certificateKey ||
    parsed.data.version !== expectedVersion ||
    parsed.data.previous_version_id !== input.previousVersionId ||
    parsed.data.record_status !== (input.action === "void" ? "voided" : "active") ||
    parsed.data.staff_membership_id !== input.staffMembershipId) {
    uncertain("證照保存結果無法與送出內容核對；請保留相同操作鍵重試。");
  }
  return {
    organizationId: parsed.data.organization_id, branchId: parsed.data.branch_id,
    certificateKey: parsed.data.certificate_key,
    recordVersionId: parsed.data.record_version_id, version: parsed.data.version,
    previousVersionId: parsed.data.previous_version_id,
    recordStatus: parsed.data.record_status,
    staffMembershipId: parsed.data.staff_membership_id,
    contentHash: parsed.data.content_hash, recordedAt: parsed.data.recorded_at,
    replayed: parsed.data.replayed, persisted: true, demo: false,
  };
}

export function parseStaffCertificateExceptionReceipt(
  value: unknown,
  input: StaffCertificateExceptionInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): StaffCertificateExceptionReceipt {
  const parsed = exceptionReceiptSchema.safeParse(value);
  const expectedCount = input.action === "request" ? 0 : input.expectedApprovalCount + 1;
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId || parsed.data.action !== input.action ||
    parsed.data.certificate_key !== input.certificateKey ||
    parsed.data.certificate_version_id !== input.certificateVersionId ||
    parsed.data.expected_certificate_version !== input.expectedCertificateVersion ||
    parsed.data.approval_count !== expectedCount ||
    parsed.data.exception_status !== (expectedCount === 2 ? "approved" : "pending") ||
    (input.action === "request" && (parsed.data.approval_id !== null ||
      parsed.data.valid_from !== input.validFrom ||
      parsed.data.valid_through !== input.validThrough)) ||
    (input.action === "approve" && (parsed.data.request_id !== input.requestId ||
      parsed.data.approval_id === null))) {
    uncertain("證照例外結果無法與送出內容核對；請保留相同操作鍵重試。");
  }
  return {
    organizationId: parsed.data.organization_id, branchId: parsed.data.branch_id,
    action: parsed.data.action, requestId: parsed.data.request_id,
    certificateKey: parsed.data.certificate_key,
    certificateVersionId: parsed.data.certificate_version_id,
    expectedCertificateVersion: parsed.data.expected_certificate_version,
    approvalId: parsed.data.approval_id,
    approvalCount: parsed.data.approval_count as 0 | 1 | 2,
    exceptionStatus: parsed.data.exception_status,
    validFrom: parsed.data.valid_from, validThrough: parsed.data.valid_through,
    committedAt: parsed.data.committed_at, replayed: parsed.data.replayed,
    persisted: true, demo: false,
  };
}

export function parseStaffCertificateRecordApiEnvelope(
  value: unknown,
  input: StaffCertificateRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
) {
  const envelope = envelopeSchema.safeParse(value);
  if (!envelope.success) uncertain("證照保存回應格式不完整。");
  const data = z.object({ receipt: recordApiReceiptSchema,
    persisted: z.literal(true), demo: z.literal(false),
  }).strict().safeParse(envelope.data.data);
  if (!data.success) uncertain("證照保存回應內容不完整。");
  parseStaffCertificateRecordReceipt({
    organization_id: data.data.receipt.organizationId,
    branch_id: data.data.receipt.branchId,
    certificate_key: data.data.receipt.certificateKey,
    record_version_id: data.data.receipt.recordVersionId,
    version: data.data.receipt.version,
    previous_version_id: data.data.receipt.previousVersionId,
    record_status: data.data.receipt.recordStatus,
    staff_membership_id: data.data.receipt.staffMembershipId,
    content_hash: data.data.receipt.contentHash,
    recorded_at: data.data.receipt.recordedAt,
    replayed: data.data.receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  if (httpStatus !== (data.data.receipt.replayed ? 200 : 201)) {
    uncertain("證照保存回應狀態與完成憑證不一致；請保留相同操作鍵重試。");
  }
  return data.data.receipt;
}

export function parseStaffCertificateExceptionApiEnvelope(
  value: unknown,
  input: StaffCertificateExceptionInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
) {
  const envelope = envelopeSchema.safeParse(value);
  if (!envelope.success) uncertain("證照例外回應格式不完整。");
  const data = z.object({ receipt: exceptionApiReceiptSchema,
    persisted: z.literal(true), demo: z.literal(false),
  }).strict().safeParse(envelope.data.data);
  if (!data.success) uncertain("證照例外回應內容不完整。");
  parseStaffCertificateExceptionReceipt({
    organization_id: data.data.receipt.organizationId,
    branch_id: data.data.receipt.branchId,
    action: data.data.receipt.action,
    request_id: data.data.receipt.requestId,
    certificate_key: data.data.receipt.certificateKey,
    certificate_version_id: data.data.receipt.certificateVersionId,
    expected_certificate_version: data.data.receipt.expectedCertificateVersion,
    approval_id: data.data.receipt.approvalId,
    approval_count: data.data.receipt.approvalCount,
    exception_status: data.data.receipt.exceptionStatus,
    valid_from: data.data.receipt.validFrom,
    valid_through: data.data.receipt.validThrough,
    committed_at: data.data.receipt.committedAt,
    replayed: data.data.receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  if (httpStatus !== (data.data.receipt.replayed ? 200 : 201)) {
    uncertain("證照例外回應狀態與完成憑證不一致；請保留相同操作鍵重試。");
  }
  return data.data.receipt;
}
