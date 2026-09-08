import { staffCertificateTaipeiDate } from "./date";
import {
  projectStaffCertificateSnapshot,
  type StaffCertificateSnapshotSourceRow,
} from "./projection";
import type { StaffCertificateFilters } from "./types";

const STAFF_A = "72040000-0000-4000-8000-000000000001";
const STAFF_B = "72040000-0000-4000-8000-000000000002";

function addDays(day: string, amount: number) {
  const value = new Date(`${day}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + amount);
  return staffCertificateTaipeiDate(value);
}

export function buildDemoStaffCertificateSnapshot({
  organizationId, branchId, filters, now = new Date(),
}: {
  organizationId: string;
  branchId: string;
  filters: StaffCertificateFilters;
  now?: Date;
}) {
  const generatedAt = now.toISOString();
  const today = staffCertificateTaipeiDate(now);
  const recordedAt = new Date(now.getTime() - 36 * 60 * 60_000).toISOString();
  const allRecords: StaffCertificateSnapshotSourceRow["records"] = [
    {
      record_version_id: "72070000-0000-4000-8000-000000000001",
      certificate_key: "72071000-0000-4000-8000-000000000001", version: 1,
      previous_version_id: null, record_status: "active" as const, correction_reason: null,
      staff_membership_id: STAFF_A,
      staff_user_id: "72010000-0000-4000-8000-000000000001",
      staff_display_name: "展示員工甲", staff_employee_code: "DEMO-C01",
      certificate_type: "展示專業證照", certificate_number: "SYNTH-EXPIRED-001",
      effective_on: addDays(today, -400), expires_on: addDays(today, -20),
      registration_status: "registered", verification_status: "verified",
      evidence_status: "missing", validity_status: "expired",
      has_active_exception: true, approval_count: 2,
      service_eligibility_status: "not_evaluated",
      recorded_by: "72010000-0000-4000-8000-000000000003",
      recorded_by_display_name: "展示主管", recorded_at: recordedAt,
      content_hash: "1".repeat(64),
    },
    {
      record_version_id: "72070000-0000-4000-8000-000000000003",
      certificate_key: "72071000-0000-4000-8000-000000000002", version: 2,
      previous_version_id: "72070000-0000-4000-8000-000000000002",
      record_status: "active", correction_reason: "展示更正：修正到期日",
      staff_membership_id: STAFF_B,
      staff_user_id: "72010000-0000-4000-8000-000000000002",
      staff_display_name: "展示員工乙", staff_employee_code: "DEMO-C02",
      certificate_type: "展示技術證照", certificate_number: "SYNTH-ACTIVE-002",
      effective_on: addDays(today, -100), expires_on: addDays(today, 90),
      registration_status: "registered", verification_status: "verified",
      evidence_status: "not_applicable", validity_status: "active",
      has_active_exception: false, approval_count: 0,
      service_eligibility_status: "not_evaluated",
      recorded_by: "72010000-0000-4000-8000-000000000003",
      recorded_by_display_name: "展示主管", recorded_at: recordedAt,
      content_hash: "3".repeat(64),
    },
    {
      record_version_id: "72070000-0000-4000-8000-000000000004",
      certificate_key: "72071000-0000-4000-8000-000000000003", version: 1,
      previous_version_id: null, record_status: "active" as const, correction_reason: null,
      staff_membership_id: STAFF_B,
      staff_user_id: "72010000-0000-4000-8000-000000000002",
      staff_display_name: "展示員工乙", staff_employee_code: "DEMO-C02",
      certificate_type: "展示登錄證明", certificate_number: "SYNTH-PENDING-003",
      effective_on: addDays(today, -10), expires_on: null,
      registration_status: "pending", verification_status: "pending",
      evidence_status: "missing", validity_status: "pending_verification",
      has_active_exception: false, approval_count: 0,
      service_eligibility_status: "not_evaluated",
      recorded_by: "72010000-0000-4000-8000-000000000003",
      recorded_by_display_name: "展示主管", recorded_at: recordedAt,
      content_hash: "4".repeat(64),
    },
  ];
  const records = allRecords.filter((record) =>
    (filters.staffMembershipId === null ||
      record.staff_membership_id === filters.staffMembershipId) &&
    (filters.certificateType === null ||
      record.certificate_type === filters.certificateType) &&
    (filters.status === "all" || record.validity_status === filters.status) &&
    (!filters.query || [record.staff_display_name, record.staff_employee_code ?? "",
      record.certificate_type, record.certificate_number].join(" ")
      .toLocaleLowerCase("zh-TW").includes(filters.query.toLocaleLowerCase("zh-TW"))),
  );
  const keys = new Set(records.map((record) => record.certificate_key));
  const history: StaffCertificateSnapshotSourceRow["history"] = [
    ...allRecords.map((record) => ({
      record_version_id: record.record_version_id,
      certificate_key: record.certificate_key, version: record.version,
      previous_version_id: record.previous_version_id,
      record_status: record.record_status, correction_reason: record.correction_reason,
      certificate_type: record.certificate_type,
      certificate_number: record.certificate_number,
      effective_on: record.effective_on, expires_on: record.expires_on,
      registration_status: record.registration_status,
      verification_status: record.verification_status,
      evidence_status: record.evidence_status,
      recorded_by_display_name: record.recorded_by_display_name,
      recorded_at: record.recorded_at, content_hash: record.content_hash,
    })),
    {
      record_version_id: "72070000-0000-4000-8000-000000000002",
      certificate_key: "72071000-0000-4000-8000-000000000002", version: 1,
      previous_version_id: null, record_status: "active" as const, correction_reason: null,
      certificate_type: "展示技術證照", certificate_number: "SYNTH-ACTIVE-002",
      effective_on: addDays(today, -100), expires_on: addDays(today, 60),
      registration_status: "registered" as const, verification_status: "verified" as const,
      evidence_status: "not_applicable" as const, recorded_by_display_name: "展示主管",
      recorded_at: new Date(now.getTime() - 72 * 60 * 60_000).toISOString(),
      content_hash: "2".repeat(64),
    },
  ].filter((record) => keys.has(record.certificate_key))
    .sort((a, b) => a.certificate_key.localeCompare(b.certificate_key) || b.version - a.version);

  const row: StaffCertificateSnapshotSourceRow = {
    organization_id: organizationId, branch_id: branchId,
    generated_at: generatedAt, snapshot_date: today,
    records, record_total: records.length, records_truncated: false,
    valid_total: records.filter((record) => record.validity_status === "active").length,
    expired_total: records.filter((record) => record.validity_status === "expired").length,
    pending_verification_total: records.filter((record) =>
      record.validity_status === "pending_verification").length,
    history, history_total: history.length, history_truncated: false,
    staff_options: [
      { staff_membership_id: STAFF_A,
        staff_user_id: "72010000-0000-4000-8000-000000000001",
        display_name: "展示員工甲", employee_code: "DEMO-C01", is_current: true },
      { staff_membership_id: STAFF_B,
        staff_user_id: "72010000-0000-4000-8000-000000000002",
        display_name: "展示員工乙", employee_code: "DEMO-C02", is_current: true },
    ],
    staff_total: 2, staff_truncated: false,
    certificate_type_options: [
      { certificate_type: "展示專業證照", record_count: 1 },
      { certificate_type: "展示技術證照", record_count: 1 },
      { certificate_type: "展示登錄證明", record_count: 1 },
    ],
    certificate_type_total: 3, certificate_types_truncated: false,
    exception_requests: [{
      request_id: "72080000-0000-4000-8000-000000000001",
      certificate_key: "72071000-0000-4000-8000-000000000001",
      certificate_version_id: "72070000-0000-4000-8000-000000000001",
      expected_certificate_version: 1, valid_from: addDays(today, -5),
      valid_through: addDays(today, 15), reason: "展示用有限期間例外",
      requested_by: "72010000-0000-4000-8000-000000000003",
      requester_display_name: "展示主管", requested_at: recordedAt,
      approval_count: 2, exception_status: "approved",
      approvals: [
        { approval_number: 1, approved_by: "72010000-0000-4000-8000-000000000004",
          approver_display_name: "展示覆核甲", approved_at: recordedAt },
        { approval_number: 2, approved_by: "72010000-0000-4000-8000-000000000005",
          approver_display_name: "展示覆核乙", approved_at: recordedAt },
      ],
    }],
    exception_request_total: 1, exception_requests_truncated: false,
    expiry_reminder_policy_status: "not_configured", expiry_notice_days: null,
    expiring_total: null, restricted_service_policy_status: "not_configured",
    service_eligibility_scope: "not_evaluated",
    attachment_pipeline_status: "not_configured",
    attachment_scan_status: "not_configured",
  };
  return projectStaffCertificateSnapshot({ row,
    expectedOrganizationId: organizationId, expectedBranchId: branchId,
    filters, demo: true });
}
