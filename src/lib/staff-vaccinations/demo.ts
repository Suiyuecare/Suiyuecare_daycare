import { staffVaccinationTaipeiDate } from "./date";
import {
  projectStaffVaccinationSnapshot,
  type StaffVaccinationSnapshotSourceRow,
} from "./projection";
import type { StaffVaccinationFilters } from "./types";

const STAFF_A = "73040000-0000-4000-8000-000000000001";
const STAFF_B = "73040000-0000-4000-8000-000000000002";

function addDays(day: string, amount: number) {
  const value = new Date(`${day}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + amount);
  return staffVaccinationTaipeiDate(value);
}

export function buildDemoStaffVaccinationSnapshot({
  organizationId,
  branchId,
  filters,
  now = new Date(),
}: {
  organizationId: string;
  branchId: string;
  filters: StaffVaccinationFilters;
  now?: Date;
}) {
  const generatedAt = now.toISOString();
  const today = staffVaccinationTaipeiDate(now);
  const recordedAt = new Date(now.getTime() - 36 * 60 * 60_000).toISOString();
  const dateA = addDays(today, -8);
  const dateB = addDays(today, -32);
  const dateC = addDays(today, -75);
  const duplicateA = {
    vaccination_key: "73071000-0000-4000-8000-000000000002",
    record_version_id: "73070000-0000-4000-8000-000000000002",
    vaccinated_on: dateB,
  };
  const duplicateB = {
    vaccination_key: "73071000-0000-4000-8000-000000000001",
    record_version_id: "73070000-0000-4000-8000-000000000001",
    vaccinated_on: dateA,
  };
  const allRecords: StaffVaccinationSnapshotSourceRow["records"] = [
    {
      record_version_id: "73070000-0000-4000-8000-000000000001",
      vaccination_key: "73071000-0000-4000-8000-000000000001",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, staff_membership_id: STAFF_A,
      staff_user_id: "73010000-0000-4000-8000-000000000001",
      staff_display_name: "展示員工甲", staff_employee_code: "DEMO-V01",
      vaccine_name: "展示疫苗甲", dose_number: "展示第 1 劑",
      vaccinated_on: dateA, lot_number: "SYNTH-LOT-A",
      provider_name: "展示接種院所甲", evidence_status: "missing",
      duplicate_warning: true, duplicate_count: 1,
      duplicate_basis: "same_staff_normalized_vaccine_and_dose",
      duplicate_matches: [duplicateA], duplicate_matches_truncated: false,
      medical_interpretation_status: "not_evaluated",
      recorded_by: "73010000-0000-4000-8000-000000000003",
      recorded_by_display_name: "展示主管", recorded_at: recordedAt,
      content_hash: "1".repeat(64),
    },
    {
      record_version_id: "73070000-0000-4000-8000-000000000002",
      vaccination_key: "73071000-0000-4000-8000-000000000002",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, staff_membership_id: STAFF_A,
      staff_user_id: "73010000-0000-4000-8000-000000000001",
      staff_display_name: "展示員工甲", staff_employee_code: "DEMO-V01",
      vaccine_name: "展示疫苗甲", dose_number: "展示第 1 劑",
      vaccinated_on: dateB, lot_number: "SYNTH-LOT-B",
      provider_name: "展示接種院所乙", evidence_status: "not_applicable",
      duplicate_warning: true, duplicate_count: 1,
      duplicate_basis: "same_staff_normalized_vaccine_and_dose",
      duplicate_matches: [duplicateB], duplicate_matches_truncated: false,
      medical_interpretation_status: "not_evaluated",
      recorded_by: "73010000-0000-4000-8000-000000000003",
      recorded_by_display_name: "展示主管", recorded_at: recordedAt,
      content_hash: "2".repeat(64),
    },
    {
      record_version_id: "73070000-0000-4000-8000-000000000004",
      vaccination_key: "73071000-0000-4000-8000-000000000003",
      version: 2,
      previous_version_id: "73070000-0000-4000-8000-000000000003",
      record_status: "active", correction_reason: "展示更正：修正批號文字",
      staff_membership_id: STAFF_B,
      staff_user_id: "73010000-0000-4000-8000-000000000002",
      staff_display_name: "展示員工乙", staff_employee_code: "DEMO-V02",
      vaccine_name: "展示疫苗乙", dose_number: "展示追加劑",
      vaccinated_on: dateC, lot_number: "SYNTH-LOT-C2",
      provider_name: "展示接種院所丙", evidence_status: "missing",
      duplicate_warning: false, duplicate_count: 0,
      duplicate_basis: "same_staff_normalized_vaccine_and_dose", duplicate_matches: [],
      duplicate_matches_truncated: false,
      medical_interpretation_status: "not_evaluated",
      recorded_by: "73010000-0000-4000-8000-000000000003",
      recorded_by_display_name: "展示主管", recorded_at: recordedAt,
      content_hash: "4".repeat(64),
    },
  ];
  allRecords.sort((a, b) => b.vaccinated_on.localeCompare(a.vaccinated_on) ||
    a.staff_display_name.localeCompare(b.staff_display_name, "zh-TW") ||
    a.vaccination_key.localeCompare(b.vaccination_key));

  const records = allRecords.filter((record) =>
    (filters.staffMembershipId === null ||
      record.staff_membership_id === filters.staffMembershipId) &&
    (filters.vaccineName === null || record.vaccine_name === filters.vaccineName) &&
    (filters.doseNumber === null || record.dose_number === filters.doseNumber) &&
    (filters.dateFrom === null || record.vaccinated_on >= filters.dateFrom) &&
    (filters.dateTo === null || record.vaccinated_on <= filters.dateTo) &&
    (filters.status === "all" ||
      (filters.status === "active" && record.record_status === "active") ||
      (filters.status === "voided" && record.record_status === "voided") ||
      (filters.status === "missing_evidence" && record.evidence_status === "missing") ||
      (filters.status === "duplicate_warning" && record.duplicate_warning)) &&
    (!filters.query || [record.staff_display_name, record.staff_employee_code ?? "",
      record.vaccine_name, record.dose_number, record.lot_number ?? "",
      record.provider_name].join(" ").toLocaleLowerCase("zh-TW")
      .includes(filters.query.toLocaleLowerCase("zh-TW"))),
  );

  const historyFilter = (record: StaffVaccinationSnapshotSourceRow["history"][number]) => {
    const current = allRecords.find((item) => item.vaccination_key === record.vaccination_key);
    return current !== undefined &&
      (filters.staffMembershipId === null ||
        current.staff_membership_id === filters.staffMembershipId) &&
      (filters.vaccineName === null || record.vaccine_name === filters.vaccineName) &&
      (filters.doseNumber === null || record.dose_number === filters.doseNumber) &&
      (filters.dateFrom === null || record.vaccinated_on >= filters.dateFrom) &&
      (filters.dateTo === null || record.vaccinated_on <= filters.dateTo);
  };
  const allHistory: StaffVaccinationSnapshotSourceRow["history"] = [
    ...allRecords.map((record) => ({
      record_version_id: record.record_version_id,
      vaccination_key: record.vaccination_key,
      version: record.version,
      previous_version_id: record.previous_version_id,
      record_status: record.record_status,
      correction_reason: record.correction_reason,
      vaccine_name: record.vaccine_name,
      dose_number: record.dose_number,
      vaccinated_on: record.vaccinated_on,
      lot_number: record.lot_number,
      provider_name: record.provider_name,
      evidence_status: record.evidence_status,
      recorded_by_display_name: record.recorded_by_display_name,
      recorded_at: record.recorded_at,
      content_hash: record.content_hash,
    })),
    {
      record_version_id: "73070000-0000-4000-8000-000000000003",
      vaccination_key: "73071000-0000-4000-8000-000000000003",
      version: 1, previous_version_id: null, record_status: "active",
      correction_reason: null, vaccine_name: "展示疫苗乙",
      dose_number: "展示追加劑", vaccinated_on: dateC,
      lot_number: "SYNTH-LOT-C1", provider_name: "展示接種院所丙",
      evidence_status: "missing", recorded_by_display_name: "展示主管",
      recorded_at: new Date(now.getTime() - 72 * 60 * 60_000).toISOString(),
      content_hash: "3".repeat(64),
    },
  ];
  const history = allHistory.filter(historyFilter).sort((a, b) =>
    a.vaccination_key.localeCompare(b.vaccination_key) || b.version - a.version);

  const row: StaffVaccinationSnapshotSourceRow = {
    organization_id: organizationId,
    branch_id: branchId,
    generated_at: generatedAt,
    snapshot_date: today,
    records,
    record_total: records.length,
    records_truncated: false,
    missing_evidence_total: records.filter((record) =>
      record.evidence_status === "missing").length,
    duplicate_warning_total: records.filter((record) => record.duplicate_warning).length,
    current_month_total: records.filter((record) =>
      record.vaccinated_on.startsWith(today.slice(0, 7))).length,
    history,
    history_total: history.length,
    history_truncated: false,
    staff_options: [
      { staff_membership_id: STAFF_A,
        staff_user_id: "73010000-0000-4000-8000-000000000001",
        display_name: "展示員工甲", employee_code: "DEMO-V01", is_current: true },
      { staff_membership_id: STAFF_B,
        staff_user_id: "73010000-0000-4000-8000-000000000002",
        display_name: "展示員工乙", employee_code: "DEMO-V02", is_current: true },
    ],
    staff_total: 2,
    staff_truncated: false,
    vaccine_options: [
      { vaccine_name: "展示疫苗甲", record_count: 2 },
      { vaccine_name: "展示疫苗乙", record_count: 1 },
    ],
    vaccine_total: 2,
    vaccines_truncated: false,
    dose_options: [
      { dose_number: "展示第 1 劑", record_count: 2 },
      { dose_number: "展示追加劑", record_count: 1 },
    ],
    dose_total: 2,
    doses_truncated: false,
    duplicate_rule_status: "configured",
    duplicate_basis: "same_staff_normalized_vaccine_and_dose",
    duplicate_resolution: "warning_only_no_auto_merge",
    medical_interpretation_status: "not_evaluated",
    reminder_schedule_status: "not_configured",
    reminder_days: null,
    reminder_total: null,
    attachment_pipeline_status: "not_configured",
    attachment_scan_status: "not_configured",
  };
  return projectStaffVaccinationSnapshot({
    row, expectedOrganizationId: organizationId, expectedBranchId: branchId,
    filters, demo: true,
  });
}
