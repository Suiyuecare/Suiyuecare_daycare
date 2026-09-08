import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { isStaffVitalSignDate, staffVitalSignTaipeiDate } from "./date";
import type {
  StaffVitalSignFilters,
  StaffVitalSignSnapshot,
  StaffVitalSignTrendSeries,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const date = z.string().refine(isStaffVitalSignDate);
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const decimalText = z.string().regex(
  /^[+-]?(?:[0-9]{1,18}(?:\.[0-9]{1,12})?|\.[0-9]{1,12})$/u,
);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().safe();
const recordStatus = z.enum(["active", "voided"]);
const valueStatus = z.enum(["measured", "missing", "not_applicable"]);

const recordSchema = z.object({
  record_version_id: uuid, vital_sign_key: uuid,
  version: z.number().int().positive().safe(), previous_version_id: uuid.nullable(),
  record_status: recordStatus, correction_reason: clean(1_000, true).nullable(),
  completion_status: z.literal("completed"), staff_membership_id: uuid,
  staff_user_id: uuid, staff_display_name: clean(120),
  staff_employee_code: clean(120).nullable(), measurement_type: clean(120),
  value_status: valueStatus, value_decimal_text: decimalText.nullable(),
  unit: clean(40).nullable(), status_reason: clean(500, true).nullable(),
  occurred_at: timestamp, source: clean(160), note: clean(1_000, true).nullable(),
  threshold_evaluation_status: z.literal("not_configured"),
  threshold_version_id: z.null(), warning_status: z.null(),
  medical_interpretation_status: z.literal("not_evaluated"),
  recorded_by: uuid, recorded_by_display_name: clean(120),
  recorded_at: timestamp, content_hash: hash,
}).strict();

const historySchema = z.object({
  record_version_id: uuid, vital_sign_key: uuid,
  version: z.number().int().positive().safe(), previous_version_id: uuid.nullable(),
  record_status: recordStatus, correction_reason: clean(1_000, true).nullable(),
  completion_status: z.literal("completed"), measurement_type: clean(120),
  value_status: valueStatus, value_decimal_text: decimalText.nullable(),
  unit: clean(40).nullable(), status_reason: clean(500, true).nullable(),
  occurred_at: timestamp, source: clean(160), note: clean(1_000, true).nullable(),
  recorded_by_display_name: clean(120), recorded_at: timestamp, content_hash: hash,
}).strict();

const staffSchema = z.object({
  staff_membership_id: uuid, staff_user_id: uuid, display_name: clean(120),
  employee_code: clean(120).nullable(), is_current: z.boolean(),
}).strict();
const typeSchema = z.object({
  measurement_type: clean(120), record_count: z.number().int().positive().safe(),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  snapshot_date: date, records: z.array(recordSchema).max(200),
  record_total: count, records_truncated: z.boolean(), measured_total: count,
  missing_total: count, not_applicable_total: count, voided_total: count,
  history: z.array(historySchema).max(500), history_total: count,
  history_truncated: z.boolean(), staff_options: z.array(staffSchema).max(200),
  staff_total: count, staff_truncated: z.boolean(),
  type_options: z.array(typeSchema).max(200), type_total: count,
  types_truncated: z.boolean(), threshold_rule_status: z.literal("not_configured"),
  threshold_version_id: z.null(), threshold_warning_total: z.null(),
  threshold_pending_confirmation_total: z.null(),
  scheduled_missing_rule_status: z.literal("not_configured"),
  scheduled_missing_total: z.null(),
  decimal_preservation: z.literal("verbatim_after_outer_trim"),
  value_status_separation: z.literal("measured_missing_not_applicable"),
  medical_interpretation_status: z.literal("not_evaluated"),
  attachment_pipeline_status: z.literal("not_configured"),
  export_status: z.literal("disabled"), offline_status: z.literal("disabled"),
  recent_aal2_max_age_minutes: z.literal(15),
}).strict();

export type StaffVitalSignSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("STAFF_VITAL_SIGN_SNAPSHOT_INVALID");
}

function validValueContract(record: {
  value_status: "measured" | "missing" | "not_applicable";
  value_decimal_text: string | null;
  unit: string | null;
  status_reason: string | null;
}) {
  return record.value_status === "measured"
    ? record.value_decimal_text !== null && record.unit !== null &&
      record.status_reason === null
    : record.value_decimal_text === null && record.unit === null &&
      record.status_reason !== null;
}

function deriveTrendSeries(
  records: z.output<typeof recordSchema>[],
): StaffVitalSignTrendSeries[] {
  const grouped = new Map<string, {
    staffMembershipId: string;
    staffDisplayName: string;
    measurementType: string;
    unit: string;
    points: Array<{ recordVersionId: string; occurredAt: string;
      valueDecimalText: string }>;
  }>();
  for (const record of records) {
    if (record.record_status !== "active" || record.value_status !== "measured" ||
      record.value_decimal_text === null || record.unit === null) continue;
    const key = JSON.stringify([
      record.staff_membership_id, record.measurement_type, record.unit,
    ]);
    const series = grouped.get(key) ?? {
      staffMembershipId: record.staff_membership_id,
      staffDisplayName: record.staff_display_name,
      measurementType: record.measurement_type,
      unit: record.unit,
      points: [],
    };
    series.points.push({
      recordVersionId: record.record_version_id,
      occurredAt: record.occurred_at,
      valueDecimalText: record.value_decimal_text,
    });
    grouped.set(key, series);
  }
  return [...grouped.values()].map((series) => ({
    ...series,
    points: series.points.sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) ||
      a.recordVersionId.localeCompare(b.recordVersionId)),
  })).sort((a, b) =>
    a.staffDisplayName.localeCompare(b.staffDisplayName, "zh-TW") ||
    a.measurementType.localeCompare(b.measurementType, "zh-TW") ||
    a.unit.localeCompare(b.unit, "zh-TW"));
}

export function projectStaffVitalSignSnapshot({
  row: value, expectedOrganizationId, expectedBranchId, filters, demo,
}: {
  row: StaffVitalSignSnapshotSourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: StaffVitalSignFilters;
  demo: boolean;
}): StaffVitalSignSnapshot {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== expectedOrganizationId ||
    row.branch_id !== expectedBranchId ||
    row.snapshot_date !== staffVitalSignTaipeiDate(new Date(row.generated_at)) ||
    row.records_truncated !== (row.record_total > 200) ||
    row.history_truncated !== (row.history_total > 500) ||
    row.staff_truncated !== (row.staff_total > 200) ||
    row.types_truncated !== (row.type_total > 200) ||
    row.records.length > row.record_total || row.history.length > row.history_total ||
    row.staff_options.length > row.staff_total || row.type_options.length > row.type_total ||
    row.measured_total + row.missing_total + row.not_applicable_total +
      row.voided_total > row.record_total) invalid();

  const recordKeys = new Set<string>();
  const recordVersionIds = new Set<string>();
  for (const record of row.records) {
    if (recordKeys.has(record.vital_sign_key) ||
      recordVersionIds.has(record.record_version_id) ||
      (record.version === 1) !== (record.previous_version_id === null) ||
      (record.version === 1) !== (record.correction_reason === null) ||
      !validValueContract(record) ||
      record.threshold_evaluation_status !== "not_configured" ||
      record.threshold_version_id !== null || record.warning_status !== null) invalid();
    recordKeys.add(record.vital_sign_key);
    recordVersionIds.add(record.record_version_id);
  }

  const historyIds = new Set<string>();
  for (const record of row.history) {
    if (historyIds.has(record.record_version_id) ||
      (record.version === 1) !== (record.previous_version_id === null) ||
      (record.version === 1) !== (record.correction_reason === null) ||
      !validValueContract(record)) invalid();
    historyIds.add(record.record_version_id);
  }
  if (!row.history_truncated && row.records.some((record) =>
    !row.history.some((history) => history.record_version_id === record.record_version_id &&
      history.vital_sign_key === record.vital_sign_key &&
      history.version === record.version && history.content_hash === record.content_hash))) {
    invalid();
  }

  const staffIds = new Set(row.staff_options.map((staff) => staff.staff_membership_id));
  const typeNames = new Set(row.type_options.map((option) => option.measurement_type));
  if (staffIds.size !== row.staff_options.length ||
    typeNames.size !== row.type_options.length) invalid();

  if (!row.records_truncated && (
    row.record_total !== row.records.length ||
    row.measured_total !== row.records.filter((record) =>
      record.record_status === "active" && record.value_status === "measured").length ||
    row.missing_total !== row.records.filter((record) =>
      record.record_status === "active" && record.value_status === "missing").length ||
    row.not_applicable_total !== row.records.filter((record) =>
      record.record_status === "active" &&
      record.value_status === "not_applicable").length ||
    row.voided_total !== row.records.filter((record) =>
      record.record_status === "voided").length
  )) invalid();
  if (!row.history_truncated && row.history_total !== row.history.length) invalid();
  if (!row.staff_truncated && row.staff_total !== row.staff_options.length) invalid();
  if (!row.types_truncated && row.type_total !== row.type_options.length) invalid();

  const trendSeries = deriveTrendSeries(row.records);
  const trendPointTotal = trendSeries.reduce(
    (total, series) => total + series.points.length, 0,
  );
  if (trendPointTotal !== row.records.filter((record) =>
    record.record_status === "active" && record.value_status === "measured").length) {
    invalid();
  }

  return {
    organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at, snapshotDate: row.snapshot_date,
    staleAfter: new Date(Date.parse(row.generated_at) + 5 * 60_000).toISOString(),
    filters,
    records: row.records.map((record) => ({
      recordVersionId: record.record_version_id,
      vitalSignKey: record.vital_sign_key, version: record.version,
      previousVersionId: record.previous_version_id,
      recordStatus: record.record_status,
      correctionReason: record.correction_reason,
      completionStatus: record.completion_status,
      staffMembershipId: record.staff_membership_id,
      staffUserId: record.staff_user_id,
      staffDisplayName: record.staff_display_name,
      staffEmployeeCode: record.staff_employee_code,
      measurementType: record.measurement_type,
      valueStatus: record.value_status,
      valueDecimalText: record.value_decimal_text,
      unit: record.unit, statusReason: record.status_reason,
      occurredAt: record.occurred_at, source: record.source, note: record.note,
      thresholdEvaluationStatus: record.threshold_evaluation_status,
      thresholdVersionId: null, warningStatus: null,
      medicalInterpretationStatus: record.medical_interpretation_status,
      recordedBy: record.recorded_by,
      recordedByDisplayName: record.recorded_by_display_name,
      recordedAt: record.recorded_at, contentHash: record.content_hash,
    })),
    recordTotal: row.record_total, recordsTruncated: row.records_truncated,
    measuredTotal: row.measured_total, missingTotal: row.missing_total,
    notApplicableTotal: row.not_applicable_total, voidedTotal: row.voided_total,
    history: row.history.map((record) => ({
      recordVersionId: record.record_version_id,
      vitalSignKey: record.vital_sign_key, version: record.version,
      previousVersionId: record.previous_version_id,
      recordStatus: record.record_status,
      correctionReason: record.correction_reason,
      completionStatus: record.completion_status,
      measurementType: record.measurement_type,
      valueStatus: record.value_status,
      valueDecimalText: record.value_decimal_text,
      unit: record.unit, statusReason: record.status_reason,
      occurredAt: record.occurred_at, source: record.source, note: record.note,
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
    typeOptions: row.type_options.map((option) => ({
      measurementType: option.measurement_type, recordCount: option.record_count,
    })),
    typeTotal: row.type_total, typesTruncated: row.types_truncated,
    trendSeries, trendPointTotal,
    thresholdRuleStatus: row.threshold_rule_status,
    thresholdVersionId: null, thresholdWarningTotal: null,
    thresholdPendingConfirmationTotal: null,
    scheduledMissingRuleStatus: row.scheduled_missing_rule_status,
    scheduledMissingTotal: null,
    decimalPreservation: row.decimal_preservation,
    valueStatusSeparation: row.value_status_separation,
    medicalInterpretationStatus: row.medical_interpretation_status,
    attachmentPipelineStatus: row.attachment_pipeline_status,
    exportStatus: row.export_status, offlineStatus: row.offline_status,
    recentAal2MaxAgeMinutes: row.recent_aal2_max_age_minutes,
    demo,
  };
}
