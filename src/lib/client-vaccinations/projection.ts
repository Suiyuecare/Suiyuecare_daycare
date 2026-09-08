import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { clientVaccinationTaipeiDate, isClientVaccinationDate } from "./date";
import type { ClientVaccinationFilters, ClientVaccinationSnapshot } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const date = z.string().refine(isClientVaccinationDate);
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.union([z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe())]);
const status = z.enum(["active", "voided"]);
const evidence = z.enum(["provided", "missing", "not_applicable"]);
const source = z.enum(["manual_entry", "central_html_import", "legacy_migration"]);
const serviceStatus = z.enum(["active", "suspended", "transferred", "closed", "deceased"]);

const duplicateMatchSchema = z.object({
  vaccination_key: uuid, record_version_id: uuid, vaccinated_on: date,
}).strict();

const recordSchema = z.object({
  record_version_id: uuid, vaccination_key: uuid,
  version: z.number().int().positive().max(1_000_000),
  previous_version_id: uuid.nullable(), record_status: status,
  correction_reason: clean(1_000, true).nullable(),
  client_id: uuid, client_display_name: clean(160), client_code: clean(120),
  vaccine_name: clean(160), dose_number: clean(80), vaccinated_on: date,
  lot_number: clean(160).nullable(), provider_name: clean(200),
  evidence_status: evidence, evidence_reference_id: uuid.nullable(),
  evidence_sha256: hash.nullable(), evidence_file_name: clean(255).nullable(),
  source_system: source, source_record_id: clean(240).nullable(),
  duplicate_warning: z.boolean(), duplicate_count: count,
  duplicate_basis: z.literal("same_client_normalized_vaccine_and_dose"),
  duplicate_matches: z.array(duplicateMatchSchema).max(200),
  duplicate_matches_truncated: z.boolean(),
  medical_interpretation_status: z.literal("not_evaluated"),
  recorded_by: uuid, recorded_by_display_name: clean(160),
  recorded_at: timestamp, content_hash: hash,
}).strict();

const historySchema = recordSchema.pick({
  record_version_id: true, vaccination_key: true, version: true,
  previous_version_id: true, record_status: true, correction_reason: true,
  vaccine_name: true, dose_number: true, vaccinated_on: true, lot_number: true,
  provider_name: true, evidence_status: true, evidence_reference_id: true,
  evidence_sha256: true, evidence_file_name: true, source_system: true,
  source_record_id: true, recorded_by_display_name: true, recorded_at: true,
  content_hash: true,
});

const clientSchema = z.object({
  client_id: uuid, display_name: clean(160), client_code: clean(120),
  service_status: serviceStatus, can_record: z.boolean(),
}).strict();
const vaccineOptionSchema = z.object({
  vaccine_name: clean(160), record_count: count,
}).strict();
const doseOptionSchema = z.object({
  dose_number: clean(80), record_count: count,
}).strict();
const filtersSchema = z.object({
  client_id: uuid.nullable(), vaccine_name: clean(160).nullable(),
  dose_number: clean(80).nullable(), date_from: date.nullable(), date_to: date.nullable(),
  status: z.enum(["all", "active", "voided", "missing_evidence", "duplicate_warning"]),
  query: z.string().trim().max(120).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  stale_after: timestamp, filters: filtersSchema,
  snapshot_date: date, records: z.array(recordSchema).max(200),
  record_total: count, records_truncated: z.boolean(),
  missing_evidence_total: count, duplicate_warning_total: count,
  current_month_total: count, history: z.array(historySchema).max(500),
  history_total: count, history_truncated: z.boolean(),
  client_options: z.array(clientSchema).max(200), client_total: count,
  clients_truncated: z.boolean(),
  vaccine_options: z.array(vaccineOptionSchema).max(200),
  vaccine_total: count, vaccines_truncated: z.boolean(),
  dose_options: z.array(doseOptionSchema).max(200),
  dose_total: count, doses_truncated: z.boolean(),
  duplicate_rule_status: z.literal("configured"),
  duplicate_basis: z.literal("same_client_normalized_vaccine_and_dose"),
  duplicate_resolution: z.literal("warning_only_no_auto_merge"),
  medical_interpretation_status: z.literal("not_evaluated"),
  reminder_schedule_status: z.literal("not_configured"),
  reminder_days: z.null(), reminder_total: z.null(),
  attachment_pipeline_status: z.literal("not_configured"),
  attachment_scan_status: z.literal("not_configured"),
  batch_maximum_items: z.literal(20), offline_status: z.literal("not_configured"),
}).strict();

export type ClientVaccinationSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("CLIENT_VACCINATION_SNAPSHOT_INVALID");
}

function evidenceValid(record: z.output<typeof recordSchema> | z.output<typeof historySchema>) {
  const provided = record.evidence_status === "provided";
  return provided === (record.evidence_reference_id !== null) &&
    provided === (record.evidence_sha256 !== null) &&
    provided === (record.evidence_file_name !== null);
}

function sourceValid(record: z.output<typeof recordSchema> | z.output<typeof historySchema>) {
  return (record.source_system === "manual_entry") === (record.source_record_id === null);
}

function matches(record: z.output<typeof recordSchema>, filters: ClientVaccinationFilters) {
  const query = filters.query.toLocaleLowerCase("zh-TW");
  return (filters.clientId === null || record.client_id === filters.clientId) &&
    (filters.vaccineName === null || record.vaccine_name === filters.vaccineName) &&
    (filters.doseNumber === null || record.dose_number === filters.doseNumber) &&
    (filters.dateFrom === null || record.vaccinated_on >= filters.dateFrom) &&
    (filters.dateTo === null || record.vaccinated_on <= filters.dateTo) &&
    (filters.status === "all" || record.record_status === filters.status ||
      (filters.status === "missing_evidence" && record.evidence_status === "missing") ||
      (filters.status === "duplicate_warning" && record.duplicate_warning)) &&
    (!query || [record.client_code, record.client_display_name, record.vaccine_name,
      record.dose_number, record.lot_number ?? "", record.provider_name]
      .join(" ").toLocaleLowerCase("zh-TW").includes(query));
}

function visibleCounts(records: readonly z.output<typeof recordSchema>[], month: string) {
  return {
    missing: records.filter((record) => record.evidence_status === "missing").length,
    duplicate: records.filter((record) => record.duplicate_warning).length,
    currentMonth: records.filter((record) => record.vaccinated_on.startsWith(month)).length,
  };
}

export function projectClientVaccinationSnapshot({
  row: value, expectedOrganizationId, expectedBranchId, filters, demo,
}: {
  row: ClientVaccinationSnapshotSourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: ClientVaccinationFilters;
  demo: boolean;
}): ClientVaccinationSnapshot {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== expectedOrganizationId.toLowerCase() ||
    row.branch_id !== expectedBranchId.toLowerCase() ||
    row.snapshot_date !== clientVaccinationTaipeiDate(row.generated_at) ||
    Date.parse(row.stale_after) - Date.parse(row.generated_at) !== 60_000 ||
    row.filters.client_id !== filters.clientId ||
    row.filters.vaccine_name !== filters.vaccineName ||
    row.filters.dose_number !== filters.doseNumber ||
    row.filters.date_from !== filters.dateFrom || row.filters.date_to !== filters.dateTo ||
    row.filters.status !== filters.status || row.filters.query !== filters.query ||
    row.record_total < row.records.length ||
    row.missing_evidence_total > row.record_total ||
    row.duplicate_warning_total > row.record_total || row.current_month_total > row.record_total ||
    row.records_truncated !== (row.record_total > row.records.length) ||
    (row.records_truncated && row.records.length !== 200) ||
    row.history_total < row.history.length ||
    row.history_truncated !== (row.history_total > row.history.length) ||
    (row.history_truncated && row.history.length !== 500) ||
    row.client_total < row.client_options.length ||
    row.clients_truncated !== (row.client_total > row.client_options.length) ||
    (row.clients_truncated && row.client_options.length !== 200) ||
    row.vaccine_total < row.vaccine_options.length ||
    row.vaccines_truncated !== (row.vaccine_total > row.vaccine_options.length) ||
    (row.vaccines_truncated && row.vaccine_options.length !== 200) ||
    row.dose_total < row.dose_options.length ||
    row.doses_truncated !== (row.dose_total > row.dose_options.length) ||
    (row.doses_truncated && row.dose_options.length !== 200)) invalid();

  const vaccinationKeys = new Set<string>();
  let previousOrder: [string, string] | null = null;
  for (const record of row.records) {
    const order: [string, string] = [record.vaccinated_on, record.vaccination_key];
    const orderInvalid = previousOrder && (order[0] > previousOrder[0] ||
      (order[0] === previousOrder[0] && order[1] < previousOrder[1]));
    const matchKeys = new Set(record.duplicate_matches.map((match) => match.vaccination_key));
    if (orderInvalid || vaccinationKeys.has(record.vaccination_key) ||
      record.vaccinated_on > row.snapshot_date || !matches(record, filters) ||
      (record.version === 1) !== (record.previous_version_id === null) ||
      (record.version === 1) !== (record.correction_reason === null) ||
      !evidenceValid(record) || !sourceValid(record) ||
      record.duplicate_warning !== (record.duplicate_count > 0) ||
      record.duplicate_matches_truncated !==
        (record.duplicate_count > record.duplicate_matches.length) ||
      record.duplicate_matches.length !== Math.min(record.duplicate_count, 200) ||
      matchKeys.size !== record.duplicate_matches.length ||
      matchKeys.has(record.vaccination_key) ||
      record.duplicate_matches.some((match) => match.vaccinated_on > row.snapshot_date) ||
      (record.record_status === "voided" &&
        (record.duplicate_warning || record.duplicate_count !== 0))) invalid();
    vaccinationKeys.add(record.vaccination_key);
    previousOrder = order;
  }

  const historyIds = new Set<string>();
  for (const record of row.history) {
    if (historyIds.has(record.record_version_id) ||
      (!row.records_truncated && !vaccinationKeys.has(record.vaccination_key)) ||
      record.vaccinated_on > row.snapshot_date ||
      (record.version === 1) !== (record.previous_version_id === null) ||
      (record.version === 1) !== (record.correction_reason === null) ||
      !evidenceValid(record) || !sourceValid(record)) invalid();
    historyIds.add(record.record_version_id);
  }
  if (row.client_options.some((item) => item.can_record && item.service_status !== "active") ||
    new Set(row.client_options.map((item) => item.client_id)).size !==
      row.client_options.length ||
    new Set(row.vaccine_options.map((item) => item.vaccine_name)).size !==
      row.vaccine_options.length ||
    new Set(row.dose_options.map((item) => item.dose_number)).size !==
      row.dose_options.length) invalid();

  const visible = visibleCounts(row.records, row.snapshot_date.slice(0, 7));
  if (row.records_truncated ?
    visible.missing > row.missing_evidence_total ||
      visible.duplicate > row.duplicate_warning_total ||
      visible.currentMonth > row.current_month_total :
    row.record_total !== row.records.length ||
      visible.missing !== row.missing_evidence_total ||
      visible.duplicate !== row.duplicate_warning_total ||
      visible.currentMonth !== row.current_month_total) invalid();
  if (!row.history_truncated && row.history_total !== row.history.length) invalid();
  if (!row.clients_truncated && row.client_total !== row.client_options.length) invalid();
  if (!row.vaccines_truncated && row.vaccine_total !== row.vaccine_options.length) invalid();
  if (!row.doses_truncated && row.dose_total !== row.dose_options.length) invalid();

  return {
    organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at, snapshotDate: row.snapshot_date,
    staleAfter: row.stale_after,
    filters,
    records: row.records.map((record) => ({
      recordVersionId: record.record_version_id, vaccinationKey: record.vaccination_key,
      version: record.version, previousVersionId: record.previous_version_id,
      recordStatus: record.record_status, correctionReason: record.correction_reason,
      clientId: record.client_id, clientDisplayName: record.client_display_name,
      clientCode: record.client_code, vaccineName: record.vaccine_name,
      doseNumber: record.dose_number, vaccinatedOn: record.vaccinated_on,
      lotNumber: record.lot_number, providerName: record.provider_name,
      evidenceStatus: record.evidence_status,
      evidenceReferenceId: record.evidence_reference_id,
      evidenceSha256: record.evidence_sha256,
      evidenceFileName: record.evidence_file_name,
      sourceSystem: record.source_system, sourceRecordId: record.source_record_id,
      duplicateWarning: record.duplicate_warning,
      duplicateCount: record.duplicate_count, duplicateBasis: record.duplicate_basis,
      duplicateMatches: record.duplicate_matches.map((match) => ({
        vaccinationKey: match.vaccination_key,
        recordVersionId: match.record_version_id,
        vaccinatedOn: match.vaccinated_on,
      })), duplicateMatchesTruncated: record.duplicate_matches_truncated,
      medicalInterpretationStatus: record.medical_interpretation_status,
      recordedBy: record.recorded_by,
      recordedByDisplayName: record.recorded_by_display_name,
      recordedAt: record.recorded_at, contentHash: record.content_hash,
    })),
    recordTotal: row.record_total, recordsTruncated: row.records_truncated,
    missingEvidenceTotal: row.missing_evidence_total,
    duplicateWarningTotal: row.duplicate_warning_total,
    currentMonthTotal: row.current_month_total,
    history: row.history.map((record) => ({
      recordVersionId: record.record_version_id, vaccinationKey: record.vaccination_key,
      version: record.version, previousVersionId: record.previous_version_id,
      recordStatus: record.record_status, correctionReason: record.correction_reason,
      vaccineName: record.vaccine_name, doseNumber: record.dose_number,
      vaccinatedOn: record.vaccinated_on, lotNumber: record.lot_number,
      providerName: record.provider_name, evidenceStatus: record.evidence_status,
      evidenceReferenceId: record.evidence_reference_id,
      evidenceSha256: record.evidence_sha256,
      evidenceFileName: record.evidence_file_name,
      sourceSystem: record.source_system, sourceRecordId: record.source_record_id,
      recordedByDisplayName: record.recorded_by_display_name,
      recordedAt: record.recorded_at, contentHash: record.content_hash,
    })), historyTotal: row.history_total, historyTruncated: row.history_truncated,
    clientOptions: row.client_options.map((item) => ({ clientId: item.client_id,
      displayName: item.display_name, clientCode: item.client_code,
      serviceStatus: item.service_status, canRecord: item.can_record })),
    clientTotal: row.client_total, clientsTruncated: row.clients_truncated,
    vaccineOptions: row.vaccine_options.map((item) => ({
      value: item.vaccine_name, recordCount: item.record_count })),
    vaccineTotal: row.vaccine_total, vaccinesTruncated: row.vaccines_truncated,
    doseOptions: row.dose_options.map((item) => ({
      value: item.dose_number, recordCount: item.record_count })),
    doseTotal: row.dose_total, dosesTruncated: row.doses_truncated,
    duplicateRuleStatus: row.duplicate_rule_status, duplicateBasis: row.duplicate_basis,
    duplicateResolution: row.duplicate_resolution,
    medicalInterpretationStatus: row.medical_interpretation_status,
    reminderScheduleStatus: row.reminder_schedule_status,
    reminderDays: row.reminder_days, reminderTotal: row.reminder_total,
    attachmentPipelineStatus: row.attachment_pipeline_status,
    attachmentScanStatus: row.attachment_scan_status,
    batchMaximumItems: row.batch_maximum_items,
    offlineStatus: row.offline_status, demo,
  };
}
