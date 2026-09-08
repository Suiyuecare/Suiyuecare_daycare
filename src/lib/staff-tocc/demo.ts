import { staffToccTaipeiDate } from "./date";
import { projectStaffToccSnapshot, type StaffToccSnapshotSourceRow } from "./projection";
import type { StaffToccFilters } from "./types";

const STAFF_A = "74040000-0000-4000-8000-000000000001";
const STAFF_B = "74040000-0000-4000-8000-000000000002";

function addDays(day: string, amount: number) {
  const value = new Date(`${day}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + amount);
  return staffToccTaipeiDate(value);
}

export function buildDemoStaffToccSnapshot({
  organizationId, branchId, filters, now = new Date(),
}: {
  organizationId: string;
  branchId: string;
  filters: StaffToccFilters;
  now?: Date;
}) {
  const generatedAt = now.toISOString();
  const today = staffToccTaipeiDate(now);
  const recordedAt = new Date(now.getTime() - 30 * 60 * 60_000).toISOString();
  const assessedA = addDays(today, -40);
  const assessedB = addDays(today, -5);
  const assessedC = addDays(today, -12);
  const allRecords: StaffToccSnapshotSourceRow["records"] = [
    {
      record_version_id: "74070000-0000-4000-8000-000000000001",
      tocc_key: "74071000-0000-4000-8000-000000000001",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, staff_membership_id: STAFF_A,
      staff_user_id: "74010000-0000-4000-8000-000000000001",
      staff_display_name: "展示員工甲", staff_employee_code: "DEMO-T01",
      assessed_on: assessedA, valid_through: addDays(today, -1),
      validity_source: "展示來源：人工輸入之外部文件效期",
      result_text: "展示結果文字：僅照錄來源內容",
      manual_attention_flag: false, attention_note: null,
      evidence_status: "missing", disposition_status: "not_recorded",
      disposition_note: null, validity_status: "expired", expiry_warning: true,
      manual_attention_warning: false, action_required: false,
      warning_reasons: ["expired_manual_valid_through"],
      warning_basis: "manual_valid_through_and_manual_attention_flag",
      medical_interpretation_status: "not_evaluated",
      recorded_by: "74010000-0000-4000-8000-000000000003",
      recorded_by_display_name: "展示主管", recorded_at: recordedAt,
      content_hash: "1".repeat(64),
    },
    {
      record_version_id: "74070000-0000-4000-8000-000000000002",
      tocc_key: "74071000-0000-4000-8000-000000000002",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, staff_membership_id: STAFF_B,
      staff_user_id: "74010000-0000-4000-8000-000000000002",
      staff_display_name: "展示員工乙", staff_employee_code: "DEMO-T02",
      assessed_on: assessedB, valid_through: addDays(today, 14),
      validity_source: "展示來源：機構人員人工確認",
      result_text: "展示結果文字：依來源照錄，未由系統分類",
      manual_attention_flag: true,
      attention_note: "展示人工標記：請由授權人員依既有程序追蹤",
      evidence_status: "not_applicable", disposition_status: "pending",
      disposition_note: "展示處置：等待人工確認",
      validity_status: "active", expiry_warning: false,
      manual_attention_warning: true, action_required: true,
      warning_reasons: ["manual_attention_flag"],
      warning_basis: "manual_valid_through_and_manual_attention_flag",
      medical_interpretation_status: "not_evaluated",
      recorded_by: "74010000-0000-4000-8000-000000000003",
      recorded_by_display_name: "展示主管", recorded_at: recordedAt,
      content_hash: "2".repeat(64),
    },
    {
      record_version_id: "74070000-0000-4000-8000-000000000004",
      tocc_key: "74071000-0000-4000-8000-000000000003",
      version: 2,
      previous_version_id: "74070000-0000-4000-8000-000000000003",
      record_status: "active", correction_reason: "展示更正：校正來源文字",
      staff_membership_id: STAFF_B,
      staff_user_id: "74010000-0000-4000-8000-000000000002",
      staff_display_name: "展示員工乙", staff_employee_code: "DEMO-T02",
      assessed_on: assessedC, valid_through: addDays(today, 30),
      validity_source: "展示來源：更正後人工效期",
      result_text: "展示來源包含 positive-like 字樣；系統仍不自動判定",
      manual_attention_flag: false, attention_note: null,
      evidence_status: "missing", disposition_status: "completed",
      disposition_note: "展示處置：人工流程已完成",
      validity_status: "active", expiry_warning: false,
      manual_attention_warning: false, action_required: false,
      warning_reasons: [],
      warning_basis: "manual_valid_through_and_manual_attention_flag",
      medical_interpretation_status: "not_evaluated",
      recorded_by: "74010000-0000-4000-8000-000000000003",
      recorded_by_display_name: "展示主管", recorded_at: recordedAt,
      content_hash: "4".repeat(64),
    },
  ];
  allRecords.sort((a, b) => Number(b.expiry_warning || b.manual_attention_warning) -
    Number(a.expiry_warning || a.manual_attention_warning) ||
    a.valid_through.localeCompare(b.valid_through) ||
    a.staff_display_name.localeCompare(b.staff_display_name, "zh-TW") ||
    a.tocc_key.localeCompare(b.tocc_key));

  const lowerQuery = filters.query.toLocaleLowerCase("zh-TW");
  const records = allRecords.filter((record) =>
    (filters.staffMembershipId === null ||
      record.staff_membership_id === filters.staffMembershipId) &&
    (filters.validityStatus === "all" ||
      record.validity_status === filters.validityStatus) &&
    (filters.attentionStatus === "all" ||
      (filters.attentionStatus === "flagged" && record.manual_attention_warning) ||
      (filters.attentionStatus === "not_flagged" && !record.manual_attention_warning)) &&
    (filters.dispositionStatus === "all" ||
      record.disposition_status === filters.dispositionStatus) &&
    (filters.dateFrom === null || record.assessed_on >= filters.dateFrom) &&
    (filters.dateTo === null || record.assessed_on <= filters.dateTo) &&
    (!lowerQuery || [record.staff_display_name, record.staff_employee_code ?? "",
      record.result_text, record.validity_source, record.attention_note ?? "",
      record.disposition_note ?? ""].join(" ").toLocaleLowerCase("zh-TW")
      .includes(lowerQuery)),
  );

  const visibleKeys = new Set(records.map((record) => record.tocc_key));
  const historyCurrent = (record: StaffToccSnapshotSourceRow["history"][number]) =>
    allRecords.find((item) => item.tocc_key === record.tocc_key);
  const allHistory: StaffToccSnapshotSourceRow["history"] = [
    ...allRecords.map((record) => ({
      record_version_id: record.record_version_id, tocc_key: record.tocc_key,
      version: record.version, previous_version_id: record.previous_version_id,
      record_status: record.record_status, correction_reason: record.correction_reason,
      assessed_on: record.assessed_on, valid_through: record.valid_through,
      validity_source: record.validity_source, result_text: record.result_text,
      manual_attention_flag: record.manual_attention_flag,
      attention_note: record.attention_note, evidence_status: record.evidence_status,
      disposition_status: record.disposition_status,
      disposition_note: record.disposition_note,
      recorded_by_display_name: record.recorded_by_display_name,
      recorded_at: record.recorded_at, content_hash: record.content_hash,
    })),
    {
      record_version_id: "74070000-0000-4000-8000-000000000003",
      tocc_key: "74071000-0000-4000-8000-000000000003",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, assessed_on: assessedC,
      valid_through: addDays(today, 30),
      validity_source: "展示來源：原始人工效期",
      result_text: "展示原始結果文字", manual_attention_flag: false,
      attention_note: null, evidence_status: "missing",
      disposition_status: "not_recorded", disposition_note: null,
      recorded_by_display_name: "展示主管",
      recorded_at: new Date(now.getTime() - 60 * 60 * 60_000).toISOString(),
      content_hash: "3".repeat(64),
    },
  ];
  const history = allHistory.filter((record) => {
    const current = historyCurrent(record);
    return current !== undefined && visibleKeys.has(record.tocc_key);
  }).sort((a, b) => a.tocc_key.localeCompare(b.tocc_key) || b.version - a.version);

  const row: StaffToccSnapshotSourceRow = {
    organization_id: organizationId, branch_id: branchId,
    generated_at: generatedAt, snapshot_date: today,
    records, record_total: records.length, records_truncated: false,
    active_total: records.filter((record) => record.validity_status === "active").length,
    expired_total: records.filter((record) => record.validity_status === "expired").length,
    manual_attention_total: records.filter((record) =>
      record.manual_attention_warning).length,
    action_required_total: records.filter((record) => record.action_required).length,
    history, history_total: history.length, history_truncated: false,
    staff_options: [
      { staff_membership_id: STAFF_A,
        staff_user_id: "74010000-0000-4000-8000-000000000001",
        display_name: "展示員工甲", employee_code: "DEMO-T01", is_current: true },
      { staff_membership_id: STAFF_B,
        staff_user_id: "74010000-0000-4000-8000-000000000002",
        display_name: "展示員工乙", employee_code: "DEMO-T02", is_current: true },
    ],
    staff_total: 2, staff_truncated: false,
    validity_rule_status: "not_configured",
    valid_through_source_mode: "manual_per_record",
    warning_basis: "manual_valid_through_and_manual_attention_flag",
    medical_interpretation_status: "not_evaluated",
    expiry_reminder_schedule_status: "not_configured",
    expiry_notice_days: null, expiring_total: null,
    attachment_pipeline_status: "not_configured",
    attachment_scan_status: "not_configured",
  };
  return projectStaffToccSnapshot({ row, expectedOrganizationId: organizationId,
    expectedBranchId: branchId, filters, demo: true,
  });
}
