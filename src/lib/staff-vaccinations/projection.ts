import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { isStaffVaccinationDate } from "./date";
import type {
  StaffVaccinationFilters,
  StaffVaccinationSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const date = z.string().refine(isStaffVaccinationDate);
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().safe();
const status = z.enum(["active", "voided"]);
const evidence = z.enum(["provided", "missing", "not_applicable"]);

const duplicateMatchSchema = z.object({
  vaccination_key: uuid,
  record_version_id: uuid,
  vaccinated_on: date,
}).strict();

const recordSchema = z.object({
  record_version_id: uuid,
  vaccination_key: uuid,
  version: z.number().int().positive().safe(),
  previous_version_id: uuid.nullable(),
  record_status: status,
  correction_reason: clean(1_000, true).nullable(),
  staff_membership_id: uuid,
  staff_user_id: uuid,
  staff_display_name: clean(120),
  staff_employee_code: clean(120).nullable(),
  vaccine_name: clean(160),
  dose_number: clean(80),
  vaccinated_on: date,
  lot_number: clean(160).nullable(),
  provider_name: clean(200),
  evidence_status: evidence,
  duplicate_warning: z.boolean(),
  duplicate_count: count,
  duplicate_basis: z.literal("same_staff_normalized_vaccine_and_dose"),
  duplicate_matches: z.array(duplicateMatchSchema).max(200),
  duplicate_matches_truncated: z.boolean(),
  medical_interpretation_status: z.literal("not_evaluated"),
  recorded_by: uuid,
  recorded_by_display_name: clean(120),
  recorded_at: timestamp,
  content_hash: hash,
}).strict();

const historySchema = recordSchema.pick({
  record_version_id: true,
  vaccination_key: true,
  version: true,
  previous_version_id: true,
  record_status: true,
  correction_reason: true,
  vaccine_name: true,
  dose_number: true,
  vaccinated_on: true,
  lot_number: true,
  provider_name: true,
  evidence_status: true,
  recorded_by_display_name: true,
  recorded_at: true,
  content_hash: true,
});

const staffSchema = z.object({
  staff_membership_id: uuid,
  staff_user_id: uuid,
  display_name: clean(120),
  employee_code: clean(120).nullable(),
  is_current: z.boolean(),
}).strict();
const vaccineOptionSchema = z.object({
  vaccine_name: clean(160), record_count: count,
}).strict();
const doseOptionSchema = z.object({
  dose_number: clean(80), record_count: count,
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  snapshot_date: date,
  records: z.array(recordSchema).max(200),
  record_total: count,
  records_truncated: z.boolean(),
  missing_evidence_total: count,
  duplicate_warning_total: count,
  current_month_total: count,
  history: z.array(historySchema).max(500),
  history_total: count,
  history_truncated: z.boolean(),
  staff_options: z.array(staffSchema).max(200),
  staff_total: count,
  staff_truncated: z.boolean(),
  vaccine_options: z.array(vaccineOptionSchema).max(200),
  vaccine_total: count,
  vaccines_truncated: z.boolean(),
  dose_options: z.array(doseOptionSchema).max(200),
  dose_total: count,
  doses_truncated: z.boolean(),
  duplicate_rule_status: z.literal("configured"),
  duplicate_basis: z.literal("same_staff_normalized_vaccine_and_dose"),
  duplicate_resolution: z.literal("warning_only_no_auto_merge"),
  medical_interpretation_status: z.literal("not_evaluated"),
  reminder_schedule_status: z.literal("not_configured"),
  reminder_days: z.null(),
  reminder_total: z.null(),
  attachment_pipeline_status: z.literal("not_configured"),
  attachment_scan_status: z.literal("not_configured"),
}).strict();

export type StaffVaccinationSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("STAFF_VACCINATION_SNAPSHOT_INVALID");
}

export function projectStaffVaccinationSnapshot({
  row: value,
  expectedOrganizationId,
  expectedBranchId,
  filters,
  demo,
}: {
  row: StaffVaccinationSnapshotSourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: StaffVaccinationFilters;
  demo: boolean;
}): StaffVaccinationSnapshot {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== expectedOrganizationId ||
    row.branch_id !== expectedBranchId ||
    row.records_truncated !== (row.record_total > 200) ||
    row.history_truncated !== (row.history_total > 500) ||
    row.staff_truncated !== (row.staff_total > 200) ||
    row.vaccines_truncated !== (row.vaccine_total > 200) ||
    row.doses_truncated !== (row.dose_total > 200) ||
    row.records.length > row.record_total ||
    row.history.length > row.history_total ||
    row.staff_options.length > row.staff_total ||
    row.vaccine_options.length > row.vaccine_total ||
    row.dose_options.length > row.dose_total) invalid();

  const vaccinationKeys = new Set<string>();
  let priorDate = "9999-12-31";
  for (const record of row.records) {
    const matchKeys = new Set(record.duplicate_matches.map((match) => match.vaccination_key));
    if (vaccinationKeys.has(record.vaccination_key) ||
      record.vaccinated_on > priorDate ||
      (record.version === 1) !== (record.previous_version_id === null) ||
      (record.version === 1) !== (record.correction_reason === null) ||
      record.duplicate_warning !== (record.duplicate_count > 0) ||
      record.duplicate_matches_truncated !== (record.duplicate_count > 200) ||
      record.duplicate_matches.length !== Math.min(record.duplicate_count, 200) ||
      matchKeys.size !== record.duplicate_matches.length ||
      matchKeys.has(record.vaccination_key) ||
      (record.record_status === "voided" && record.duplicate_warning)) invalid();
    vaccinationKeys.add(record.vaccination_key);
    priorDate = record.vaccinated_on;
  }

  const historyIds = new Set<string>();
  for (const record of row.history) {
    if (historyIds.has(record.record_version_id) ||
      (record.version === 1) !== (record.previous_version_id === null) ||
      (record.version === 1) !== (record.correction_reason === null)) invalid();
    historyIds.add(record.record_version_id);
  }

  if (!row.records_truncated && (
    row.record_total !== row.records.length ||
    row.missing_evidence_total !== row.records.filter((record) =>
      record.evidence_status === "missing").length ||
    row.duplicate_warning_total !== row.records.filter((record) =>
      record.duplicate_warning).length ||
    row.current_month_total !== row.records.filter((record) =>
      record.vaccinated_on.startsWith(row.snapshot_date.slice(0, 7))).length
  )) invalid();
  if (!row.history_truncated && row.history_total !== row.history.length) invalid();
  if (!row.staff_truncated && row.staff_total !== row.staff_options.length) invalid();
  if (!row.vaccines_truncated && row.vaccine_total !== row.vaccine_options.length) invalid();
  if (!row.doses_truncated && row.dose_total !== row.dose_options.length) invalid();

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    snapshotDate: row.snapshot_date,
    staleAfter: new Date(Date.parse(row.generated_at) + 5 * 60_000).toISOString(),
    filters,
    records: row.records.map((record) => ({
      recordVersionId: record.record_version_id,
      vaccinationKey: record.vaccination_key,
      version: record.version,
      previousVersionId: record.previous_version_id,
      recordStatus: record.record_status,
      correctionReason: record.correction_reason,
      staffMembershipId: record.staff_membership_id,
      staffUserId: record.staff_user_id,
      staffDisplayName: record.staff_display_name,
      staffEmployeeCode: record.staff_employee_code,
      vaccineName: record.vaccine_name,
      doseNumber: record.dose_number,
      vaccinatedOn: record.vaccinated_on,
      lotNumber: record.lot_number,
      providerName: record.provider_name,
      evidenceStatus: record.evidence_status,
      duplicateWarning: record.duplicate_warning,
      duplicateCount: record.duplicate_count,
      duplicateBasis: record.duplicate_basis,
      duplicateMatches: record.duplicate_matches.map((match) => ({
        vaccinationKey: match.vaccination_key,
        recordVersionId: match.record_version_id,
        vaccinatedOn: match.vaccinated_on,
      })),
      duplicateMatchesTruncated: record.duplicate_matches_truncated,
      medicalInterpretationStatus: record.medical_interpretation_status,
      recordedBy: record.recorded_by,
      recordedByDisplayName: record.recorded_by_display_name,
      recordedAt: record.recorded_at,
      contentHash: record.content_hash,
    })),
    recordTotal: row.record_total,
    recordsTruncated: row.records_truncated,
    missingEvidenceTotal: row.missing_evidence_total,
    duplicateWarningTotal: row.duplicate_warning_total,
    currentMonthTotal: row.current_month_total,
    history: row.history.map((record) => ({
      recordVersionId: record.record_version_id,
      vaccinationKey: record.vaccination_key,
      version: record.version,
      previousVersionId: record.previous_version_id,
      recordStatus: record.record_status,
      correctionReason: record.correction_reason,
      vaccineName: record.vaccine_name,
      doseNumber: record.dose_number,
      vaccinatedOn: record.vaccinated_on,
      lotNumber: record.lot_number,
      providerName: record.provider_name,
      evidenceStatus: record.evidence_status,
      recordedByDisplayName: record.recorded_by_display_name,
      recordedAt: record.recorded_at,
      contentHash: record.content_hash,
    })),
    historyTotal: row.history_total,
    historyTruncated: row.history_truncated,
    staffOptions: row.staff_options.map((staff) => ({
      staffMembershipId: staff.staff_membership_id,
      staffUserId: staff.staff_user_id,
      displayName: staff.display_name,
      employeeCode: staff.employee_code,
      isCurrent: staff.is_current,
    })),
    staffTotal: row.staff_total,
    staffTruncated: row.staff_truncated,
    vaccineOptions: row.vaccine_options.map((option) => ({
      value: option.vaccine_name, recordCount: option.record_count,
    })),
    vaccineTotal: row.vaccine_total,
    vaccinesTruncated: row.vaccines_truncated,
    doseOptions: row.dose_options.map((option) => ({
      value: option.dose_number, recordCount: option.record_count,
    })),
    doseTotal: row.dose_total,
    dosesTruncated: row.doses_truncated,
    duplicateRuleStatus: row.duplicate_rule_status,
    duplicateBasis: row.duplicate_basis,
    duplicateResolution: row.duplicate_resolution,
    medicalInterpretationStatus: row.medical_interpretation_status,
    reminderScheduleStatus: row.reminder_schedule_status,
    reminderDays: null,
    reminderTotal: null,
    attachmentPipelineStatus: row.attachment_pipeline_status,
    attachmentScanStatus: row.attachment_scan_status,
    demo,
  };
}
