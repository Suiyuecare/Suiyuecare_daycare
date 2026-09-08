import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { isStaffCertificateDate } from "./date";
import type { StaffCertificateFilters, StaffCertificateSnapshot } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const date = z.string().refine(isStaffCertificateDate);
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedCount = z.number().int().nonnegative().safe();
const registration = z.enum(["pending", "registered", "not_required", "suspended"]);
const verification = z.enum(["pending", "verified", "rejected"]);
const evidence = z.enum(["provided", "missing", "not_applicable"]);
const validity = z.enum([
  "active", "upcoming", "expired", "pending_verification",
  "registration_not_active", "voided",
]);

const recordSchema = z.object({
  record_version_id: uuid, certificate_key: uuid,
  version: z.number().int().positive().safe(), previous_version_id: uuid.nullable(),
  record_status: z.enum(["active", "voided"]),
  correction_reason: clean(1_000, true).nullable(), staff_membership_id: uuid,
  staff_user_id: uuid, staff_display_name: clean(120),
  staff_employee_code: clean(120).nullable(), certificate_type: clean(120),
  certificate_number: clean(160), effective_on: date, expires_on: date.nullable(),
  registration_status: registration, verification_status: verification,
  evidence_status: evidence, validity_status: validity,
  has_active_exception: z.boolean(), approval_count: z.number().int().min(0).max(2),
  service_eligibility_status: z.literal("not_evaluated"), recorded_by: uuid,
  recorded_by_display_name: clean(120), recorded_at: timestamp, content_hash: hash,
}).strict();

const historySchema = z.object({
  record_version_id: uuid, certificate_key: uuid,
  version: z.number().int().positive().safe(), previous_version_id: uuid.nullable(),
  record_status: z.enum(["active", "voided"]),
  correction_reason: clean(1_000, true).nullable(), certificate_type: clean(120),
  certificate_number: clean(160), effective_on: date, expires_on: date.nullable(),
  registration_status: registration, verification_status: verification,
  evidence_status: evidence, recorded_by_display_name: clean(120),
  recorded_at: timestamp, content_hash: hash,
}).strict();

const staffSchema = z.object({
  staff_membership_id: uuid, staff_user_id: uuid, display_name: clean(120),
  employee_code: clean(120).nullable(), is_current: z.boolean(),
}).strict();
const typeSchema = z.object({
  certificate_type: clean(120), record_count: boundedCount,
}).strict();
const approvalSchema = z.object({
  approval_number: z.union([z.literal(1), z.literal(2)]), approved_by: uuid,
  approver_display_name: clean(120), approved_at: timestamp,
}).strict();
const exceptionSchema = z.object({
  request_id: uuid, certificate_key: uuid, certificate_version_id: uuid,
  expected_certificate_version: z.number().int().positive().safe(),
  valid_from: date, valid_through: date, reason: clean(1_000, true),
  requested_by: uuid, requester_display_name: clean(120), requested_at: timestamp,
  approval_count: z.number().int().min(0).max(2),
  exception_status: z.enum(["pending", "approved", "expired"]),
  approvals: z.array(approvalSchema).max(2),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  snapshot_date: date, records: z.array(recordSchema).max(200),
  record_total: boundedCount, records_truncated: z.boolean(),
  valid_total: boundedCount, expired_total: boundedCount,
  pending_verification_total: boundedCount,
  history: z.array(historySchema).max(500), history_total: boundedCount,
  history_truncated: z.boolean(), staff_options: z.array(staffSchema).max(200),
  staff_total: boundedCount, staff_truncated: z.boolean(),
  certificate_type_options: z.array(typeSchema).max(200),
  certificate_type_total: boundedCount, certificate_types_truncated: z.boolean(),
  exception_requests: z.array(exceptionSchema).max(200),
  exception_request_total: boundedCount, exception_requests_truncated: z.boolean(),
  expiry_reminder_policy_status: z.literal("not_configured"),
  expiry_notice_days: z.null(), expiring_total: z.null(),
  restricted_service_policy_status: z.literal("not_configured"),
  service_eligibility_scope: z.literal("not_evaluated"),
  attachment_pipeline_status: z.literal("not_configured"),
  attachment_scan_status: z.literal("not_configured"),
}).strict();

export type StaffCertificateSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("STAFF_CERTIFICATE_SNAPSHOT_INVALID");
}

function expectedValidity(record: z.output<typeof recordSchema>, snapshotDate: string) {
  if (record.record_status === "voided") return "voided";
  if (record.effective_on > snapshotDate) return "upcoming";
  if (record.expires_on !== null && record.expires_on < snapshotDate) return "expired";
  if (record.verification_status !== "verified") return "pending_verification";
  if (record.registration_status !== "registered" &&
    record.registration_status !== "not_required") return "registration_not_active";
  return "active";
}

export function projectStaffCertificateSnapshot({
  row: value, expectedOrganizationId, expectedBranchId, filters, demo,
}: {
  row: StaffCertificateSnapshotSourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: StaffCertificateFilters;
  demo: boolean;
}): StaffCertificateSnapshot {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== expectedOrganizationId ||
    row.branch_id !== expectedBranchId ||
    row.records_truncated !== (row.record_total > 200) ||
    row.history_truncated !== (row.history_total > 500) ||
    row.staff_truncated !== (row.staff_total > 200) ||
    row.certificate_types_truncated !== (row.certificate_type_total > 200) ||
    row.exception_requests_truncated !== (row.exception_request_total > 200) ||
    row.records.length > row.record_total || row.history.length > row.history_total ||
    row.staff_options.length > row.staff_total ||
    row.certificate_type_options.length > row.certificate_type_total ||
    row.exception_requests.length > row.exception_request_total) invalid();

  const recordKeys = new Set<string>();
  let priorSort = "";
  for (const record of row.records) {
    if (recordKeys.has(record.certificate_key) ||
      expectedValidity(record, row.snapshot_date) !== record.validity_status ||
      (record.version === 1) !== (record.previous_version_id === null) ||
      (record.version === 1) !== (record.correction_reason === null) ||
      (record.expires_on !== null && record.expires_on < record.effective_on) ||
      (record.has_active_exception && record.approval_count !== 2)) invalid();
    recordKeys.add(record.certificate_key);
    const sort = `${record.expires_on ?? "9999-12-31"}:${record.staff_display_name}:${record.certificate_key}`;
    if (priorSort && sort < priorSort) invalid();
    priorSort = sort;
  }

  const exceptionIds = new Set<string>();
  for (const request of row.exception_requests) {
    if (exceptionIds.has(request.request_id) ||
      request.valid_through < request.valid_from ||
      request.approval_count !== request.approvals.length ||
      request.approvals.some((approval, index) => approval.approval_number !== index + 1) ||
      new Set(request.approvals.map((approval) => approval.approved_by)).size !==
        request.approvals.length ||
      request.approvals.some((approval) => approval.approved_by === request.requested_by) ||
      (request.exception_status === "approved" && request.approval_count !== 2) ||
      (request.exception_status === "pending" && (
        request.approval_count >= 2 || request.valid_through < row.snapshot_date
      )) ||
      (request.exception_status === "expired" && request.valid_through >= row.snapshot_date)) {
      invalid();
    }
    exceptionIds.add(request.request_id);
  }

  if (!row.records_truncated) {
    if (row.record_total !== row.records.length ||
      row.valid_total !== row.records.filter((record) =>
        record.validity_status === "active").length ||
      row.expired_total !== row.records.filter((record) =>
        record.validity_status === "expired").length ||
      row.pending_verification_total !== row.records.filter((record) =>
        record.validity_status === "pending_verification").length) invalid();
  }

  return {
    organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at, snapshotDate: row.snapshot_date,
    staleAfter: new Date(Date.parse(row.generated_at) + 5 * 60_000).toISOString(),
    filters,
    records: row.records.map((record) => ({
      recordVersionId: record.record_version_id,
      certificateKey: record.certificate_key, version: record.version,
      previousVersionId: record.previous_version_id,
      recordStatus: record.record_status, correctionReason: record.correction_reason,
      staffMembershipId: record.staff_membership_id, staffUserId: record.staff_user_id,
      staffDisplayName: record.staff_display_name,
      staffEmployeeCode: record.staff_employee_code,
      certificateType: record.certificate_type,
      certificateNumber: record.certificate_number,
      effectiveOn: record.effective_on, expiresOn: record.expires_on,
      registrationStatus: record.registration_status,
      verificationStatus: record.verification_status,
      evidenceStatus: record.evidence_status, validityStatus: record.validity_status,
      hasActiveException: record.has_active_exception,
      approvalCount: record.approval_count,
      serviceEligibilityStatus: record.service_eligibility_status,
      recordedBy: record.recorded_by,
      recordedByDisplayName: record.recorded_by_display_name,
      recordedAt: record.recorded_at, contentHash: record.content_hash,
    })),
    recordTotal: row.record_total, recordsTruncated: row.records_truncated,
    validTotal: row.valid_total, expiredTotal: row.expired_total,
    pendingVerificationTotal: row.pending_verification_total,
    history: row.history.map((record) => ({
      recordVersionId: record.record_version_id,
      certificateKey: record.certificate_key, version: record.version,
      previousVersionId: record.previous_version_id,
      recordStatus: record.record_status, correctionReason: record.correction_reason,
      certificateType: record.certificate_type,
      certificateNumber: record.certificate_number,
      effectiveOn: record.effective_on, expiresOn: record.expires_on,
      registrationStatus: record.registration_status,
      verificationStatus: record.verification_status,
      evidenceStatus: record.evidence_status,
      recordedByDisplayName: record.recorded_by_display_name,
      recordedAt: record.recorded_at, contentHash: record.content_hash,
    })),
    historyTotal: row.history_total, historyTruncated: row.history_truncated,
    staffOptions: row.staff_options.map((staff) => ({
      staffMembershipId: staff.staff_membership_id,
      staffUserId: staff.staff_user_id, displayName: staff.display_name,
      employeeCode: staff.employee_code, isCurrent: staff.is_current,
    })),
    staffTotal: row.staff_total, staffTruncated: row.staff_truncated,
    certificateTypeOptions: row.certificate_type_options.map((option) => ({
      certificateType: option.certificate_type, recordCount: option.record_count,
    })),
    certificateTypeTotal: row.certificate_type_total,
    certificateTypesTruncated: row.certificate_types_truncated,
    exceptionRequests: row.exception_requests.map((request) => ({
      requestId: request.request_id, certificateKey: request.certificate_key,
      certificateVersionId: request.certificate_version_id,
      expectedCertificateVersion: request.expected_certificate_version,
      validFrom: request.valid_from, validThrough: request.valid_through,
      reason: request.reason, requestedBy: request.requested_by,
      requesterDisplayName: request.requester_display_name,
      requestedAt: request.requested_at, approvalCount: request.approval_count,
      exceptionStatus: request.exception_status,
      approvals: request.approvals.map((approval) => ({
        approvalNumber: approval.approval_number,
        approvedBy: approval.approved_by,
        approverDisplayName: approval.approver_display_name,
        approvedAt: approval.approved_at,
      })),
    })),
    exceptionRequestTotal: row.exception_request_total,
    exceptionRequestsTruncated: row.exception_requests_truncated,
    expiryReminderPolicyStatus: row.expiry_reminder_policy_status,
    expiryNoticeDays: null, expiringTotal: null,
    restrictedServicePolicyStatus: row.restricted_service_policy_status,
    serviceEligibilityScope: row.service_eligibility_scope,
    attachmentPipelineStatus: row.attachment_pipeline_status,
    attachmentScanStatus: row.attachment_scan_status, demo,
  };
}
