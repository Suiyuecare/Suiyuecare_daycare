import { staffVitalSignTaipeiDate } from "./date";
import {
  projectStaffVitalSignSnapshot,
  type StaffVitalSignSnapshotSourceRow,
} from "./projection";
import type { StaffVitalSignFilters } from "./types";

const STAFF_A = "69040000-0000-4000-8000-000000000001";
const STAFF_B = "69040000-0000-4000-8000-000000000002";

function hoursBefore(now: Date, hours: number) {
  return new Date(now.getTime() - hours * 60 * 60_000).toISOString();
}

export function buildDemoStaffVitalSignSnapshot({
  organizationId, branchId, filters, now = new Date(),
}: {
  organizationId: string;
  branchId: string;
  filters: StaffVitalSignFilters;
  now?: Date;
}) {
  const generatedAt = now.toISOString();
  const today = staffVitalSignTaipeiDate(now);
  const base = {
    completion_status: "completed" as const,
    threshold_evaluation_status: "not_configured" as const,
    threshold_version_id: null,
    warning_status: null,
    medical_interpretation_status: "not_evaluated" as const,
    recorded_by: "69010000-0000-4000-8000-000000000003",
    recorded_by_display_name: "展示健康管理員",
  };
  const allRecords: StaffVitalSignSnapshotSourceRow["records"] = [
    {
      ...base,
      record_version_id: "69070000-0000-4000-8000-000000000001",
      vital_sign_key: "69071000-0000-4000-8000-000000000001",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, staff_membership_id: STAFF_A,
      staff_user_id: "69010000-0000-4000-8000-000000000001",
      staff_display_name: "展示員工甲", staff_employee_code: "DEMO-V01",
      measurement_type: "展示量測類型 A", value_status: "measured",
      value_decimal_text: "118.500", unit: "展示單位",
      status_reason: null, occurred_at: hoursBefore(now, 50),
      source: "展示手動輸入", note: "合成資料，不代表任何健康判定",
      recorded_at: hoursBefore(now, 49), content_hash: "1".repeat(64),
    },
    {
      ...base,
      record_version_id: "69070000-0000-4000-8000-000000000003",
      vital_sign_key: "69071000-0000-4000-8000-000000000002",
      version: 2,
      previous_version_id: "69070000-0000-4000-8000-000000000002",
      record_status: "active", correction_reason: "展示更正：照錄來源值",
      staff_membership_id: STAFF_A,
      staff_user_id: "69010000-0000-4000-8000-000000000001",
      staff_display_name: "展示員工甲", staff_employee_code: "DEMO-V01",
      measurement_type: "展示量測類型 A", value_status: "measured",
      value_decimal_text: "120.00", unit: "展示單位",
      status_reason: null, occurred_at: hoursBefore(now, 2),
      source: "展示設備轉錄", note: null,
      recorded_at: hoursBefore(now, 1), content_hash: "3".repeat(64),
    },
    {
      ...base,
      record_version_id: "69070000-0000-4000-8000-000000000004",
      vital_sign_key: "69071000-0000-4000-8000-000000000003",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, staff_membership_id: STAFF_B,
      staff_user_id: "69010000-0000-4000-8000-000000000002",
      staff_display_name: "展示員工乙", staff_employee_code: "DEMO-V02",
      measurement_type: "展示量測類型 B", value_status: "missing",
      value_decimal_text: null, unit: null,
      status_reason: "展示原因：本次未取得量測值",
      occurred_at: hoursBefore(now, 4), source: "展示手動輸入", note: null,
      recorded_at: hoursBefore(now, 3), content_hash: "4".repeat(64),
    },
    {
      ...base,
      record_version_id: "69070000-0000-4000-8000-000000000005",
      vital_sign_key: "69071000-0000-4000-8000-000000000004",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, staff_membership_id: STAFF_B,
      staff_user_id: "69010000-0000-4000-8000-000000000002",
      staff_display_name: "展示員工乙", staff_employee_code: "DEMO-V02",
      measurement_type: "展示量測類型 C", value_status: "not_applicable",
      value_decimal_text: null, unit: null,
      status_reason: "展示原因：此項本次不適用",
      occurred_at: hoursBefore(now, 28), source: "展示手動輸入", note: null,
      recorded_at: hoursBefore(now, 27), content_hash: "5".repeat(64),
    },
    {
      ...base,
      record_version_id: "69070000-0000-4000-8000-000000000006",
      vital_sign_key: "69071000-0000-4000-8000-000000000005",
      version: 2,
      previous_version_id: "69070000-0000-4000-8000-000000000007",
      record_status: "voided", correction_reason: "展示作廢：原來源撤回",
      staff_membership_id: STAFF_A,
      staff_user_id: "69010000-0000-4000-8000-000000000001",
      staff_display_name: "展示員工甲", staff_employee_code: "DEMO-V01",
      measurement_type: "展示量測類型 B", value_status: "measured",
      value_decimal_text: "36.50", unit: "展示單位二",
      status_reason: null, occurred_at: hoursBefore(now, 75),
      source: "展示手動輸入", note: "展示作廢終端",
      recorded_at: hoursBefore(now, 74), content_hash: "6".repeat(64),
    },
  ];
  allRecords.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) ||
    a.staff_display_name.localeCompare(b.staff_display_name, "zh-TW") ||
    a.vital_sign_key.localeCompare(b.vital_sign_key));

  const query = filters.query.toLocaleLowerCase("zh-TW");
  const records = allRecords.filter((record) => {
    const state = record.record_status === "voided"
      ? "voided" : record.value_status;
    const localDate = staffVitalSignTaipeiDate(new Date(record.occurred_at));
    return (filters.staffMembershipId === null ||
        record.staff_membership_id === filters.staffMembershipId) &&
      (filters.measurementType === null ||
        record.measurement_type === filters.measurementType) &&
      (filters.stateStatus === "all" || state === filters.stateStatus) &&
      (filters.dateFrom === null || localDate >= filters.dateFrom) &&
      (filters.dateTo === null || localDate <= filters.dateTo) &&
      (!query || [record.staff_display_name, record.staff_employee_code ?? "",
        record.measurement_type, record.source, record.note ?? "",
        record.status_reason ?? ""].join(" ").toLocaleLowerCase("zh-TW").includes(query));
  });
  const visibleKeys = new Set(records.map((record) => record.vital_sign_key));
  const allHistory: StaffVitalSignSnapshotSourceRow["history"] = [
    ...allRecords.map((record) => ({
      record_version_id: record.record_version_id,
      vital_sign_key: record.vital_sign_key, version: record.version,
      previous_version_id: record.previous_version_id,
      record_status: record.record_status,
      correction_reason: record.correction_reason,
      completion_status: record.completion_status,
      measurement_type: record.measurement_type,
      value_status: record.value_status,
      value_decimal_text: record.value_decimal_text, unit: record.unit,
      status_reason: record.status_reason, occurred_at: record.occurred_at,
      source: record.source, note: record.note,
      recorded_by_display_name: record.recorded_by_display_name,
      recorded_at: record.recorded_at, content_hash: record.content_hash,
    })),
    {
      record_version_id: "69070000-0000-4000-8000-000000000002",
      vital_sign_key: "69071000-0000-4000-8000-000000000002",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, completion_status: "completed",
      measurement_type: "展示量測類型 A", value_status: "measured",
      value_decimal_text: "119.90", unit: "展示單位", status_reason: null,
      occurred_at: hoursBefore(now, 2), source: "展示設備轉錄", note: null,
      recorded_by_display_name: "展示健康管理員",
      recorded_at: hoursBefore(now, 1.5), content_hash: "2".repeat(64),
    },
    {
      record_version_id: "69070000-0000-4000-8000-000000000007",
      vital_sign_key: "69071000-0000-4000-8000-000000000005",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, completion_status: "completed",
      measurement_type: "展示量測類型 B", value_status: "measured",
      value_decimal_text: "36.50", unit: "展示單位二", status_reason: null,
      occurred_at: hoursBefore(now, 75), source: "展示手動輸入",
      note: "展示原始版本", recorded_by_display_name: "展示健康管理員",
      recorded_at: hoursBefore(now, 74.5), content_hash: "7".repeat(64),
    },
  ];
  const history = allHistory.filter((record) => visibleKeys.has(record.vital_sign_key))
    .sort((a, b) => a.vital_sign_key.localeCompare(b.vital_sign_key) ||
      b.version - a.version);
  const row: StaffVitalSignSnapshotSourceRow = {
    organization_id: organizationId, branch_id: branchId,
    generated_at: generatedAt, snapshot_date: today,
    records, record_total: records.length, records_truncated: false,
    measured_total: records.filter((record) => record.record_status === "active" &&
      record.value_status === "measured").length,
    missing_total: records.filter((record) => record.record_status === "active" &&
      record.value_status === "missing").length,
    not_applicable_total: records.filter((record) =>
      record.record_status === "active" &&
      record.value_status === "not_applicable").length,
    voided_total: records.filter((record) => record.record_status === "voided").length,
    history, history_total: history.length, history_truncated: false,
    staff_options: [
      { staff_membership_id: STAFF_A,
        staff_user_id: "69010000-0000-4000-8000-000000000001",
        display_name: "展示員工甲", employee_code: "DEMO-V01", is_current: true },
      { staff_membership_id: STAFF_B,
        staff_user_id: "69010000-0000-4000-8000-000000000002",
        display_name: "展示員工乙", employee_code: "DEMO-V02", is_current: true },
    ],
    staff_total: 2, staff_truncated: false,
    type_options: [
      { measurement_type: "展示量測類型 A", record_count: 2 },
      { measurement_type: "展示量測類型 B", record_count: 2 },
      { measurement_type: "展示量測類型 C", record_count: 1 },
    ],
    type_total: 3, types_truncated: false,
    threshold_rule_status: "not_configured", threshold_version_id: null,
    threshold_warning_total: null, threshold_pending_confirmation_total: null,
    scheduled_missing_rule_status: "not_configured", scheduled_missing_total: null,
    decimal_preservation: "verbatim_after_outer_trim",
    value_status_separation: "measured_missing_not_applicable",
    medical_interpretation_status: "not_evaluated",
    attachment_pipeline_status: "not_configured", export_status: "disabled",
    offline_status: "disabled", recent_aal2_max_age_minutes: 15,
  };
  return projectStaffVitalSignSnapshot({ row,
    expectedOrganizationId: organizationId, expectedBranchId: branchId,
    filters, demo: true,
  });
}
