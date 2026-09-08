import { clientVaccinationTaipeiDate } from "./date";
import { projectClientVaccinationSnapshot,
  type ClientVaccinationSnapshotSourceRow } from "./projection";
import type { ClientVaccinationFilters } from "./types";

const CLIENT_A = "23010000-0000-4000-8000-000000000001";
const CLIENT_B = "23010000-0000-4000-8000-000000000002";

function addDays(day: string, amount: number) {
  const value = new Date(`${day}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + amount);
  return clientVaccinationTaipeiDate(value);
}

export function buildDemoClientVaccinationSnapshot({
  organizationId, branchId, filters, now = new Date(),
}: {
  organizationId: string;
  branchId: string;
  filters: ClientVaccinationFilters;
  now?: Date;
}) {
  const generatedAt = now.toISOString();
  const today = clientVaccinationTaipeiDate(now);
  const dateA = addDays(today, -7);
  const dateB = addDays(today, -40);
  const dateC = addDays(today, -95);
  const recordedAt = new Date(now.getTime() - 30 * 60 * 60_000).toISOString();
  const duplicateA = { vaccination_key: "23030000-0000-4000-8000-000000000002",
    record_version_id: "23020000-0000-4000-8000-000000000002",
    vaccinated_on: dateB };
  const duplicateB = { vaccination_key: "23030000-0000-4000-8000-000000000001",
    record_version_id: "23020000-0000-4000-8000-000000000001",
    vaccinated_on: dateA };
  const common = {
    duplicate_basis: "same_client_normalized_vaccine_and_dose" as const,
    medical_interpretation_status: "not_evaluated" as const,
    recorded_by: "23040000-0000-4000-8000-000000000001",
    recorded_by_display_name: "展示護理人員",
    recorded_at: recordedAt,
    evidence_reference_id: null,
    evidence_sha256: null,
    evidence_file_name: null,
    source_system: "manual_entry" as const,
    source_record_id: null,
  };
  const allRecords: ClientVaccinationSnapshotSourceRow["records"] = [
    { ...common, record_version_id: "23020000-0000-4000-8000-000000000001",
      vaccination_key: "23030000-0000-4000-8000-000000000001", version: 1,
      previous_version_id: null, record_status: "active", correction_reason: null,
      client_id: CLIENT_A, client_display_name: "展示個案甲", client_code: "DEMO-C001",
      vaccine_name: "展示疫苗甲", dose_number: "展示第 1 劑",
      vaccinated_on: dateA, lot_number: "SYNTH-LOT-A",
      provider_name: "展示接種院所甲", evidence_status: "missing",
      duplicate_warning: true, duplicate_count: 1,
      duplicate_matches: [duplicateA], duplicate_matches_truncated: false,
      content_hash: "1".repeat(64) },
    { ...common, record_version_id: "23020000-0000-4000-8000-000000000002",
      vaccination_key: "23030000-0000-4000-8000-000000000002", version: 1,
      previous_version_id: null, record_status: "active", correction_reason: null,
      client_id: CLIENT_A, client_display_name: "展示個案甲", client_code: "DEMO-C001",
      vaccine_name: "展示疫苗甲", dose_number: "展示第 1 劑",
      vaccinated_on: dateB, lot_number: "SYNTH-LOT-B",
      provider_name: "展示接種院所乙", evidence_status: "not_applicable",
      duplicate_warning: true, duplicate_count: 1,
      duplicate_matches: [duplicateB], duplicate_matches_truncated: false,
      content_hash: "2".repeat(64) },
    { ...common, record_version_id: "23020000-0000-4000-8000-000000000004",
      vaccination_key: "23030000-0000-4000-8000-000000000003", version: 2,
      previous_version_id: "23020000-0000-4000-8000-000000000003",
      record_status: "active", correction_reason: "展示更正：修正人工照錄批號",
      client_id: CLIENT_B, client_display_name: "展示個案乙", client_code: "DEMO-C002",
      vaccine_name: "展示疫苗乙", dose_number: "展示追加劑",
      vaccinated_on: dateC, lot_number: "SYNTH-LOT-C2",
      provider_name: "展示接種院所丙", evidence_status: "missing",
      duplicate_warning: false, duplicate_count: 0, duplicate_matches: [],
      duplicate_matches_truncated: false, content_hash: "4".repeat(64) },
  ];
  allRecords.sort((left, right) =>
    right.vaccinated_on.localeCompare(left.vaccinated_on) ||
    left.vaccination_key.localeCompare(right.vaccination_key));
  const termMatches = (record: typeof allRecords[number]) =>
    (filters.clientId === null || record.client_id === filters.clientId) &&
    (filters.vaccineName === null || record.vaccine_name === filters.vaccineName) &&
    (filters.doseNumber === null || record.dose_number === filters.doseNumber) &&
    (filters.dateFrom === null || record.vaccinated_on >= filters.dateFrom) &&
    (filters.dateTo === null || record.vaccinated_on <= filters.dateTo) &&
    (filters.status === "all" || record.record_status === filters.status ||
      (filters.status === "missing_evidence" && record.evidence_status === "missing") ||
      (filters.status === "duplicate_warning" && record.duplicate_warning)) &&
    (!filters.query || [record.client_code, record.client_display_name,
      record.vaccine_name, record.dose_number, record.lot_number ?? "",
      record.provider_name].join(" ").toLocaleLowerCase("zh-TW")
      .includes(filters.query.toLocaleLowerCase("zh-TW")));
  const records = allRecords.filter(termMatches);
  const historyBase: ClientVaccinationSnapshotSourceRow["history"] = [
    ...allRecords.map((record) => ({
      record_version_id: record.record_version_id,
      vaccination_key: record.vaccination_key, version: record.version,
      previous_version_id: record.previous_version_id,
      record_status: record.record_status, correction_reason: record.correction_reason,
      vaccine_name: record.vaccine_name, dose_number: record.dose_number,
      vaccinated_on: record.vaccinated_on, lot_number: record.lot_number,
      provider_name: record.provider_name, evidence_status: record.evidence_status,
      evidence_reference_id: record.evidence_reference_id,
      evidence_sha256: record.evidence_sha256,
      evidence_file_name: record.evidence_file_name,
      source_system: record.source_system, source_record_id: record.source_record_id,
      recorded_by_display_name: record.recorded_by_display_name,
      recorded_at: record.recorded_at, content_hash: record.content_hash,
    })),
    { record_version_id: "23020000-0000-4000-8000-000000000003",
      vaccination_key: "23030000-0000-4000-8000-000000000003", version: 1,
      previous_version_id: null, record_status: "active", correction_reason: null,
      vaccine_name: "展示疫苗乙", dose_number: "展示追加劑",
      vaccinated_on: dateC, lot_number: "SYNTH-LOT-C1",
      provider_name: "展示接種院所丙", evidence_status: "missing",
      evidence_reference_id: null, evidence_sha256: null, evidence_file_name: null,
      source_system: "manual_entry", source_record_id: null,
      recorded_by_display_name: "展示護理人員",
      recorded_at: new Date(now.getTime() - 60 * 60 * 60_000).toISOString(),
      content_hash: "3".repeat(64) },
  ];
  const visibleKeys = new Set(records.map((record) => record.vaccination_key));
  const history = historyBase.filter((record) => visibleKeys.has(record.vaccination_key))
    .sort((left, right) => left.vaccination_key.localeCompare(right.vaccination_key) ||
      right.version - left.version);
  const row: ClientVaccinationSnapshotSourceRow = {
    organization_id: organizationId, branch_id: branchId, generated_at: generatedAt,
    stale_after: new Date(now.getTime() + 60_000).toISOString(),
    filters: { client_id: filters.clientId, vaccine_name: filters.vaccineName,
      dose_number: filters.doseNumber, date_from: filters.dateFrom, date_to: filters.dateTo,
      status: filters.status, query: filters.query },
    snapshot_date: today, records, record_total: records.length,
    records_truncated: false,
    missing_evidence_total: records.filter((record) =>
      record.evidence_status === "missing").length,
    duplicate_warning_total: records.filter((record) => record.duplicate_warning).length,
    current_month_total: records.filter((record) =>
      record.vaccinated_on.startsWith(today.slice(0, 7))).length,
    history, history_total: history.length, history_truncated: false,
    client_options: [
      { client_id: CLIENT_A, display_name: "展示個案甲", client_code: "DEMO-C001",
        service_status: "active", can_record: true },
      { client_id: CLIENT_B, display_name: "展示個案乙", client_code: "DEMO-C002",
        service_status: "active", can_record: true },
    ], client_total: 2, clients_truncated: false,
    vaccine_options: [
      { vaccine_name: "展示疫苗甲", record_count: 2 },
      { vaccine_name: "展示疫苗乙", record_count: 1 },
    ], vaccine_total: 2, vaccines_truncated: false,
    dose_options: [
      { dose_number: "展示第 1 劑", record_count: 2 },
      { dose_number: "展示追加劑", record_count: 1 },
    ], dose_total: 2, doses_truncated: false,
    duplicate_rule_status: "configured",
    duplicate_basis: "same_client_normalized_vaccine_and_dose",
    duplicate_resolution: "warning_only_no_auto_merge",
    medical_interpretation_status: "not_evaluated",
    reminder_schedule_status: "not_configured", reminder_days: null,
    reminder_total: null, attachment_pipeline_status: "not_configured",
    attachment_scan_status: "not_configured", batch_maximum_items: 20,
    offline_status: "not_configured",
  };
  return projectClientVaccinationSnapshot({ row,
    expectedOrganizationId: organizationId, expectedBranchId: branchId,
    filters, demo: true });
}
