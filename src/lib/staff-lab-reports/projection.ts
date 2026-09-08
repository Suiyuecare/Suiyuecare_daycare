import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { isStaffLabReportDate, staffLabReportTaipeiDate } from "./date";
import type { StaffLabReportFilters, StaffLabReportSnapshot } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const date = z.string().refine(isStaffLabReportDate);
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().safe();
const recordStatus = z.enum(["active", "voided"]);
const evidenceStatus = z.enum(["provided", "missing", "not_applicable"]);
const duplicateBasis = z.enum(["exact_content", "same_staff_type_tested_on_provider"]);
const duplicateRule = z.literal("exact_content_or_same_staff_type_tested_on_provider");

const duplicateMatchSchema = z.object({
  report_key: uuid, record_version_id: uuid, tested_on: date,
  match_kind: duplicateBasis,
}).strict();

const recordSchema = z.object({
  record_version_id: uuid, report_key: uuid,
  version: z.number().int().positive().safe(), previous_version_id: uuid.nullable(),
  record_status: recordStatus, correction_reason: clean(1_000, true).nullable(),
  completion_status: z.literal("completed"), staff_membership_id: uuid,
  staff_user_id: uuid, staff_display_name: clean(120),
  staff_employee_code: clean(120).nullable(), report_type: clean(160),
  tested_on: date, provider_name: clean(200), result_text: clean(2_000, true),
  valid_through: date, validity_basis: clean(500, true),
  evidence_status: evidenceStatus, attachment_reference: clean(500).nullable(),
  attachment_sha256: hash.nullable(), validity_status: z.enum(["active", "expired", "voided"]),
  exact_duplicate_count: count, key_field_duplicate_count: count,
  duplicate_warning: z.boolean(), duplicate_bases: z.array(duplicateBasis).max(2),
  duplicate_matches: z.array(duplicateMatchSchema).max(200),
  duplicate_matches_truncated: z.boolean(), duplicate_basis: duplicateRule,
  medical_interpretation_status: z.literal("not_evaluated"),
  recorded_by: uuid, recorded_by_display_name: clean(120),
  recorded_at: timestamp, content_hash: hash,
}).strict();

const historySchema = z.object({
  record_version_id: uuid, report_key: uuid,
  version: z.number().int().positive().safe(), previous_version_id: uuid.nullable(),
  record_status: recordStatus, correction_reason: clean(1_000, true).nullable(),
  completion_status: z.literal("completed"), report_type: clean(160), tested_on: date,
  provider_name: clean(200), result_text: clean(2_000, true), valid_through: date,
  validity_basis: clean(500, true), evidence_status: evidenceStatus,
  attachment_reference: clean(500).nullable(), attachment_sha256: hash.nullable(),
  recorded_by_display_name: clean(120), recorded_at: timestamp, content_hash: hash,
}).strict();

const staffSchema = z.object({
  staff_membership_id: uuid, staff_user_id: uuid, display_name: clean(120),
  employee_code: clean(120).nullable(), is_current: z.boolean(),
}).strict();
const typeSchema = z.object({ report_type: clean(160), record_count: count }).strict();

const sourceSchema = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  snapshot_date: date, records: z.array(recordSchema).max(200),
  record_total: count, records_truncated: z.boolean(), active_total: count,
  expired_total: count, missing_evidence_total: count, duplicate_warning_total: count,
  history: z.array(historySchema).max(500), history_total: count,
  history_truncated: z.boolean(), staff_options: z.array(staffSchema).max(200),
  staff_total: count, staff_truncated: z.boolean(),
  type_options: z.array(typeSchema).max(200), type_total: count,
  types_truncated: z.boolean(), validity_rule_status: z.literal("not_configured"),
  valid_through_source_mode: z.literal("manual_per_record"),
  expiry_reminder_schedule_status: z.literal("not_configured"),
  expiry_notice_days: z.null(), expiring_total: z.null(),
  duplicate_rule_status: z.literal("configured"), duplicate_basis: duplicateRule,
  duplicate_resolution: z.literal("warning_only_no_auto_merge"),
  medical_interpretation_status: z.literal("not_evaluated"),
  attachment_pipeline_status: z.literal("not_configured"),
  attachment_scan_status: z.literal("not_configured"),
  recent_aal2_max_age_minutes: z.literal(15),
}).strict();

export type StaffLabReportSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("STAFF_LAB_REPORT_SNAPSHOT_INVALID");
}

function expectedBases(exact: number, keyFields: number) {
  return [
    exact > 0 ? "exact_content" : null,
    keyFields > exact ? "same_staff_type_tested_on_provider" : null,
  ].filter((value): value is "exact_content" |
    "same_staff_type_tested_on_provider" => value !== null);
}

export function projectStaffLabReportSnapshot({
  row: value, expectedOrganizationId, expectedBranchId, filters, demo,
}: {
  row: StaffLabReportSnapshotSourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: StaffLabReportFilters;
  demo: boolean;
}): StaffLabReportSnapshot {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== expectedOrganizationId ||
    row.branch_id !== expectedBranchId ||
    row.snapshot_date !== staffLabReportTaipeiDate(new Date(row.generated_at)) ||
    row.records_truncated !== (row.record_total > 200) ||
    row.history_truncated !== (row.history_total > 500) ||
    row.staff_truncated !== (row.staff_total > 200) ||
    row.types_truncated !== (row.type_total > 200) ||
    row.records.length > row.record_total || row.history.length > row.history_total ||
    row.staff_options.length > row.staff_total || row.type_options.length > row.type_total) {
    invalid();
  }

  const reportKeys = new Set<string>();
  for (const record of row.records) {
    const validity = record.record_status === "voided" ? "voided" :
      record.valid_through < row.snapshot_date ? "expired" : "active";
    const bases = expectedBases(
      record.exact_duplicate_count, record.key_field_duplicate_count,
    );
    const matchIds = new Set(record.duplicate_matches.map((match) =>
      match.record_version_id));
    const exactMatches = record.duplicate_matches.filter((match) =>
      match.match_kind === "exact_content").length;
    if (reportKeys.has(record.report_key) || record.valid_through < record.tested_on ||
      (record.version === 1) !== (record.previous_version_id === null) ||
      (record.version === 1) !== (record.correction_reason === null) ||
      record.validity_status !== validity ||
      record.key_field_duplicate_count < record.exact_duplicate_count ||
      record.duplicate_warning !== (record.key_field_duplicate_count > 0) ||
      record.duplicate_matches.length !== Math.min(
        record.key_field_duplicate_count, 200,
      ) ||
      record.duplicate_matches_truncated !== (record.key_field_duplicate_count > 200) ||
      (!record.duplicate_matches_truncated &&
        exactMatches !== record.exact_duplicate_count) ||
      matchIds.size !== record.duplicate_matches.length ||
      record.duplicate_matches.some((match) => match.report_key === record.report_key) ||
      record.duplicate_matches.some((match) => match.tested_on !== record.tested_on) ||
      JSON.stringify(record.duplicate_bases) !== JSON.stringify(bases) ||
      (record.evidence_status === "provided") !==
        (record.attachment_reference !== null && record.attachment_sha256 !== null) ||
      (record.evidence_status !== "provided" &&
        (record.attachment_reference !== null || record.attachment_sha256 !== null))) {
      invalid();
    }
    reportKeys.add(record.report_key);
  }

  const historyIds = new Set<string>();
  for (const record of row.history) {
    if (historyIds.has(record.record_version_id) ||
      record.valid_through < record.tested_on ||
      (record.version === 1) !== (record.previous_version_id === null) ||
      (record.version === 1) !== (record.correction_reason === null) ||
      (record.evidence_status === "provided") !==
        (record.attachment_reference !== null && record.attachment_sha256 !== null) ||
      (record.evidence_status !== "provided" &&
        (record.attachment_reference !== null || record.attachment_sha256 !== null))) {
      invalid();
    }
    historyIds.add(record.record_version_id);
  }

  if (!row.records_truncated && (row.record_total !== row.records.length ||
    row.active_total !== row.records.filter((record) =>
      record.validity_status === "active").length ||
    row.expired_total !== row.records.filter((record) =>
      record.validity_status === "expired").length ||
    row.missing_evidence_total !== row.records.filter((record) =>
      record.evidence_status === "missing").length ||
    row.duplicate_warning_total !== row.records.filter((record) =>
      record.duplicate_warning).length)) invalid();
  if (row.active_total + row.expired_total > row.record_total ||
    row.missing_evidence_total > row.record_total ||
    row.duplicate_warning_total > row.record_total) invalid();
  if (!row.history_truncated && row.history_total !== row.history.length) invalid();
  if (!row.staff_truncated && row.staff_total !== row.staff_options.length) invalid();
  if (!row.types_truncated && row.type_total !== row.type_options.length) invalid();

  return {
    organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at, snapshotDate: row.snapshot_date,
    staleAfter: new Date(Date.parse(row.generated_at) + 5 * 60_000).toISOString(),
    filters,
    records: row.records.map((record) => ({
      recordVersionId: record.record_version_id, reportKey: record.report_key,
      version: record.version, previousVersionId: record.previous_version_id,
      recordStatus: record.record_status, correctionReason: record.correction_reason,
      completionStatus: record.completion_status,
      staffMembershipId: record.staff_membership_id, staffUserId: record.staff_user_id,
      staffDisplayName: record.staff_display_name,
      staffEmployeeCode: record.staff_employee_code, reportType: record.report_type,
      testedOn: record.tested_on, providerName: record.provider_name,
      resultText: record.result_text, validThrough: record.valid_through,
      validityBasis: record.validity_basis, evidenceStatus: record.evidence_status,
      attachmentReference: record.attachment_reference,
      attachmentSha256: record.attachment_sha256,
      validityStatus: record.validity_status,
      exactDuplicateCount: record.exact_duplicate_count,
      keyFieldDuplicateCount: record.key_field_duplicate_count,
      duplicateWarning: record.duplicate_warning,
      duplicateBases: record.duplicate_bases,
      duplicateMatches: record.duplicate_matches.map((match) => ({
        reportKey: match.report_key, recordVersionId: match.record_version_id,
        testedOn: match.tested_on, matchKind: match.match_kind,
      })),
      duplicateMatchesTruncated: record.duplicate_matches_truncated,
      duplicateBasis: record.duplicate_basis,
      medicalInterpretationStatus: record.medical_interpretation_status,
      recordedBy: record.recorded_by,
      recordedByDisplayName: record.recorded_by_display_name,
      recordedAt: record.recorded_at, contentHash: record.content_hash,
    })),
    recordTotal: row.record_total, recordsTruncated: row.records_truncated,
    activeTotal: row.active_total, expiredTotal: row.expired_total,
    missingEvidenceTotal: row.missing_evidence_total,
    duplicateWarningTotal: row.duplicate_warning_total,
    history: row.history.map((record) => ({
      recordVersionId: record.record_version_id, reportKey: record.report_key,
      version: record.version, previousVersionId: record.previous_version_id,
      recordStatus: record.record_status, correctionReason: record.correction_reason,
      completionStatus: record.completion_status, reportType: record.report_type,
      testedOn: record.tested_on, providerName: record.provider_name,
      resultText: record.result_text, validThrough: record.valid_through,
      validityBasis: record.validity_basis, evidenceStatus: record.evidence_status,
      attachmentReference: record.attachment_reference,
      attachmentSha256: record.attachment_sha256,
      recordedByDisplayName: record.recorded_by_display_name,
      recordedAt: record.recorded_at, contentHash: record.content_hash,
    })),
    historyTotal: row.history_total, historyTruncated: row.history_truncated,
    staffOptions: row.staff_options.map((staff) => ({
      staffMembershipId: staff.staff_membership_id, staffUserId: staff.staff_user_id,
      displayName: staff.display_name, employeeCode: staff.employee_code,
      isCurrent: staff.is_current,
    })),
    staffTotal: row.staff_total, staffTruncated: row.staff_truncated,
    typeOptions: row.type_options.map((option) => ({
      reportType: option.report_type, recordCount: option.record_count,
    })),
    typeTotal: row.type_total, typesTruncated: row.types_truncated,
    validityRuleStatus: row.validity_rule_status,
    validThroughSourceMode: row.valid_through_source_mode,
    expiryReminderScheduleStatus: row.expiry_reminder_schedule_status,
    expiryNoticeDays: null, expiringTotal: null,
    duplicateRuleStatus: row.duplicate_rule_status,
    duplicateBasis: row.duplicate_basis,
    duplicateResolution: row.duplicate_resolution,
    medicalInterpretationStatus: row.medical_interpretation_status,
    attachmentPipelineStatus: row.attachment_pipeline_status,
    attachmentScanStatus: row.attachment_scan_status,
    recentAal2MaxAgeMinutes: row.recent_aal2_max_age_minutes,
    demo,
  };
}
