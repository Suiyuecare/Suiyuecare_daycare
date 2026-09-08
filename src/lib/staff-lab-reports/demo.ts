import { staffLabReportTaipeiDate } from "./date";
import {
  projectStaffLabReportSnapshot,
  type StaffLabReportSnapshotSourceRow,
} from "./projection";
import type { StaffLabReportFilters } from "./types";

const STAFF_A = "78040000-0000-4000-8000-000000000001";
const STAFF_B = "78040000-0000-4000-8000-000000000002";

function addDays(day: string, amount: number) {
  const value = new Date(`${day}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + amount);
  return staffLabReportTaipeiDate(value);
}

export function buildDemoStaffLabReportSnapshot({
  organizationId, branchId, filters, now = new Date(),
}: {
  organizationId: string;
  branchId: string;
  filters: StaffLabReportFilters;
  now?: Date;
}) {
  const generatedAt = now.toISOString();
  const today = staffLabReportTaipeiDate(now);
  const testedDuplicate = addDays(today, -35);
  const testedOther = addDays(today, -8);
  const recordedAt = new Date(now.getTime() - 28 * 60 * 60_000).toISOString();
  const duplicateBasis = "exact_content_or_same_staff_type_tested_on_provider" as const;
  const interpretation = "not_evaluated" as const;
  const allRecords: StaffLabReportSnapshotSourceRow["records"] = [
    {
      record_version_id: "78070000-0000-4000-8000-000000000001",
      report_key: "78071000-0000-4000-8000-000000000001",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, completion_status: "completed",
      staff_membership_id: STAFF_A,
      staff_user_id: "78010000-0000-4000-8000-000000000001",
      staff_display_name: "展示員工甲", staff_employee_code: "DEMO-L01",
      report_type: "展示檢驗類型 A", tested_on: testedDuplicate,
      provider_name: "展示院所", result_text: "展示結果：依來源逐字照錄",
      valid_through: addDays(today, -1),
      validity_basis: "展示依據：由授權人員依來源人工填寫",
      evidence_status: "missing", attachment_reference: null,
      attachment_sha256: null, validity_status: "expired",
      exact_duplicate_count: 1, key_field_duplicate_count: 2,
      duplicate_warning: true,
      duplicate_bases: ["exact_content", "same_staff_type_tested_on_provider"],
      duplicate_matches: [
        { report_key: "78071000-0000-4000-8000-000000000002",
          record_version_id: "78070000-0000-4000-8000-000000000002",
          tested_on: testedDuplicate, match_kind: "exact_content" },
        { report_key: "78071000-0000-4000-8000-000000000003",
          record_version_id: "78070000-0000-4000-8000-000000000003",
          tested_on: testedDuplicate,
          match_kind: "same_staff_type_tested_on_provider" },
      ],
      duplicate_matches_truncated: false, duplicate_basis: duplicateBasis,
      medical_interpretation_status: interpretation,
      recorded_by: "78010000-0000-4000-8000-000000000003",
      recorded_by_display_name: "展示健康管理員", recorded_at: recordedAt,
      content_hash: "1".repeat(64),
    },
    {
      record_version_id: "78070000-0000-4000-8000-000000000002",
      report_key: "78071000-0000-4000-8000-000000000002",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, completion_status: "completed",
      staff_membership_id: STAFF_A,
      staff_user_id: "78010000-0000-4000-8000-000000000001",
      staff_display_name: "展示員工甲", staff_employee_code: "DEMO-L01",
      report_type: "展示檢驗類型 A", tested_on: testedDuplicate,
      provider_name: "展示院所", result_text: "展示結果：依來源逐字照錄",
      valid_through: addDays(today, -1),
      validity_basis: "展示依據：由授權人員依來源人工填寫",
      evidence_status: "missing", attachment_reference: null,
      attachment_sha256: null, validity_status: "expired",
      exact_duplicate_count: 1, key_field_duplicate_count: 2,
      duplicate_warning: true,
      duplicate_bases: ["exact_content", "same_staff_type_tested_on_provider"],
      duplicate_matches: [
        { report_key: "78071000-0000-4000-8000-000000000001",
          record_version_id: "78070000-0000-4000-8000-000000000001",
          tested_on: testedDuplicate, match_kind: "exact_content" },
        { report_key: "78071000-0000-4000-8000-000000000003",
          record_version_id: "78070000-0000-4000-8000-000000000003",
          tested_on: testedDuplicate,
          match_kind: "same_staff_type_tested_on_provider" },
      ],
      duplicate_matches_truncated: false, duplicate_basis: duplicateBasis,
      medical_interpretation_status: interpretation,
      recorded_by: "78010000-0000-4000-8000-000000000003",
      recorded_by_display_name: "展示健康管理員", recorded_at: recordedAt,
      content_hash: "2".repeat(64),
    },
    {
      record_version_id: "78070000-0000-4000-8000-000000000003",
      report_key: "78071000-0000-4000-8000-000000000003",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, completion_status: "completed",
      staff_membership_id: STAFF_A,
      staff_user_id: "78010000-0000-4000-8000-000000000001",
      staff_display_name: "展示員工甲", staff_employee_code: "DEMO-L01",
      report_type: "展示檢驗類型 A", tested_on: testedDuplicate,
      provider_name: "展示院所", result_text: "展示結果：另一份來源文字",
      valid_through: addDays(today, 21),
      validity_basis: "展示依據：另一份文件的人工效期",
      evidence_status: "not_applicable", attachment_reference: null,
      attachment_sha256: null, validity_status: "active",
      exact_duplicate_count: 0, key_field_duplicate_count: 2,
      duplicate_warning: true,
      duplicate_bases: ["same_staff_type_tested_on_provider"],
      duplicate_matches: [
        { report_key: "78071000-0000-4000-8000-000000000001",
          record_version_id: "78070000-0000-4000-8000-000000000001",
          tested_on: testedDuplicate,
          match_kind: "same_staff_type_tested_on_provider" },
        { report_key: "78071000-0000-4000-8000-000000000002",
          record_version_id: "78070000-0000-4000-8000-000000000002",
          tested_on: testedDuplicate,
          match_kind: "same_staff_type_tested_on_provider" },
      ],
      duplicate_matches_truncated: false, duplicate_basis: duplicateBasis,
      medical_interpretation_status: interpretation,
      recorded_by: "78010000-0000-4000-8000-000000000003",
      recorded_by_display_name: "展示健康管理員", recorded_at: recordedAt,
      content_hash: "3".repeat(64),
    },
    {
      record_version_id: "78070000-0000-4000-8000-000000000005",
      report_key: "78071000-0000-4000-8000-000000000004",
      version: 2,
      previous_version_id: "78070000-0000-4000-8000-000000000004",
      record_status: "active", correction_reason: "展示更正：校正人工效期依據",
      completion_status: "completed", staff_membership_id: STAFF_B,
      staff_user_id: "78010000-0000-4000-8000-000000000002",
      staff_display_name: "展示員工乙", staff_employee_code: "DEMO-L02",
      report_type: "展示檢驗類型 B", tested_on: testedOther,
      provider_name: "展示檢驗單位", result_text: "展示結果：不作醫療判讀",
      valid_through: addDays(today, 30),
      validity_basis: "展示更正後人工依據", evidence_status: "missing",
      attachment_reference: null, attachment_sha256: null,
      validity_status: "active", exact_duplicate_count: 0,
      key_field_duplicate_count: 0, duplicate_warning: false,
      duplicate_bases: [], duplicate_matches: [],
      duplicate_matches_truncated: false, duplicate_basis: duplicateBasis,
      medical_interpretation_status: interpretation,
      recorded_by: "78010000-0000-4000-8000-000000000003",
      recorded_by_display_name: "展示健康管理員", recorded_at: recordedAt,
      content_hash: "5".repeat(64),
    },
  ];

  allRecords.sort((a, b) => Number(b.duplicate_warning) - Number(a.duplicate_warning) ||
    Number(b.validity_status === "expired") - Number(a.validity_status === "expired") ||
    b.tested_on.localeCompare(a.tested_on) ||
    a.staff_display_name.localeCompare(b.staff_display_name, "zh-TW") ||
    a.report_key.localeCompare(b.report_key));

  const query = filters.query.toLocaleLowerCase("zh-TW");
  const records = allRecords.filter((record) =>
    (filters.staffMembershipId === null ||
      record.staff_membership_id === filters.staffMembershipId) &&
    (filters.reportType === null || record.report_type === filters.reportType) &&
    (filters.validityStatus === "all" ||
      record.validity_status === filters.validityStatus) &&
    (filters.duplicateStatus === "all" ||
      (filters.duplicateStatus === "any" && record.duplicate_warning) ||
      (filters.duplicateStatus === "exact" && record.exact_duplicate_count > 0) ||
      (filters.duplicateStatus === "key_fields" &&
        record.key_field_duplicate_count > record.exact_duplicate_count) ||
      (filters.duplicateStatus === "none" && !record.duplicate_warning)) &&
    (filters.evidenceStatus === "all" ||
      record.evidence_status === filters.evidenceStatus) &&
    (filters.dateFrom === null || record.tested_on >= filters.dateFrom) &&
    (filters.dateTo === null || record.tested_on <= filters.dateTo) &&
    (!query || [record.staff_display_name, record.staff_employee_code ?? "",
      record.report_type, record.provider_name, record.result_text,
      record.validity_basis].join(" ").toLocaleLowerCase("zh-TW").includes(query)),
  );

  const visibleKeys = new Set(records.map((record) => record.report_key));
  const allHistory: StaffLabReportSnapshotSourceRow["history"] = [
    ...allRecords.map((record) => ({
      record_version_id: record.record_version_id, report_key: record.report_key,
      version: record.version, previous_version_id: record.previous_version_id,
      record_status: record.record_status, correction_reason: record.correction_reason,
      completion_status: record.completion_status, report_type: record.report_type,
      tested_on: record.tested_on, provider_name: record.provider_name,
      result_text: record.result_text, valid_through: record.valid_through,
      validity_basis: record.validity_basis, evidence_status: record.evidence_status,
      attachment_reference: record.attachment_reference,
      attachment_sha256: record.attachment_sha256,
      recorded_by_display_name: record.recorded_by_display_name,
      recorded_at: record.recorded_at, content_hash: record.content_hash,
    })),
    {
      record_version_id: "78070000-0000-4000-8000-000000000004",
      report_key: "78071000-0000-4000-8000-000000000004",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, completion_status: "completed",
      report_type: "展示檢驗類型 B", tested_on: testedOther,
      provider_name: "展示檢驗單位", result_text: "展示原始結果文字",
      valid_through: addDays(today, 20), validity_basis: "展示原始人工依據",
      evidence_status: "missing", attachment_reference: null,
      attachment_sha256: null, recorded_by_display_name: "展示健康管理員",
      recorded_at: new Date(now.getTime() - 52 * 60 * 60_000).toISOString(),
      content_hash: "4".repeat(64),
    },
  ];
  const history = allHistory.filter((record) => visibleKeys.has(record.report_key))
    .sort((a, b) => a.report_key.localeCompare(b.report_key) || b.version - a.version);

  const row: StaffLabReportSnapshotSourceRow = {
    organization_id: organizationId, branch_id: branchId,
    generated_at: generatedAt, snapshot_date: today,
    records, record_total: records.length, records_truncated: false,
    active_total: records.filter((record) => record.validity_status === "active").length,
    expired_total: records.filter((record) => record.validity_status === "expired").length,
    missing_evidence_total: records.filter((record) =>
      record.evidence_status === "missing").length,
    duplicate_warning_total: records.filter((record) => record.duplicate_warning).length,
    history, history_total: history.length, history_truncated: false,
    staff_options: [
      { staff_membership_id: STAFF_A,
        staff_user_id: "78010000-0000-4000-8000-000000000001",
        display_name: "展示員工甲", employee_code: "DEMO-L01", is_current: true },
      { staff_membership_id: STAFF_B,
        staff_user_id: "78010000-0000-4000-8000-000000000002",
        display_name: "展示員工乙", employee_code: "DEMO-L02", is_current: true },
    ],
    staff_total: 2, staff_truncated: false,
    type_options: [
      { report_type: "展示檢驗類型 A", record_count: 3 },
      { report_type: "展示檢驗類型 B", record_count: 1 },
    ],
    type_total: 2, types_truncated: false,
    validity_rule_status: "not_configured",
    valid_through_source_mode: "manual_per_record",
    expiry_reminder_schedule_status: "not_configured",
    expiry_notice_days: null, expiring_total: null,
    duplicate_rule_status: "configured", duplicate_basis: duplicateBasis,
    duplicate_resolution: "warning_only_no_auto_merge",
    medical_interpretation_status: interpretation,
    attachment_pipeline_status: "not_configured",
    attachment_scan_status: "not_configured", recent_aal2_max_age_minutes: 15,
  };
  return projectStaffLabReportSnapshot({ row, expectedOrganizationId: organizationId,
    expectedBranchId: branchId, filters, demo: true,
  });
}
