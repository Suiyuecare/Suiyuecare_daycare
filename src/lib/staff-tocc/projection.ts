import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { isStaffToccDate, staffToccTaipeiDate } from "./date";
import type { StaffToccFilters, StaffToccSnapshot } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const date = z.string().refine(isStaffToccDate);
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().safe();
const recordStatus = z.enum(["active", "voided"]);
const evidenceStatus = z.enum(["provided", "missing", "not_applicable"]);
const dispositionStatus = z.enum(["not_recorded", "pending", "in_progress", "completed"]);
const warningReason = z.enum(["expired_manual_valid_through", "manual_attention_flag"]);

const recordSchema = z.object({
  record_version_id: uuid, tocc_key: uuid,
  version: z.number().int().positive().safe(), previous_version_id: uuid.nullable(),
  record_status: recordStatus, correction_reason: clean(1_000, true).nullable(),
  staff_membership_id: uuid, staff_user_id: uuid,
  staff_display_name: clean(120), staff_employee_code: clean(120).nullable(),
  assessed_on: date, valid_through: date, validity_source: clean(240),
  result_text: clean(1_000, true), manual_attention_flag: z.boolean(),
  attention_note: clean(1_000, true).nullable(), evidence_status: evidenceStatus,
  disposition_status: dispositionStatus,
  disposition_note: clean(1_000, true).nullable(),
  validity_status: z.enum(["active", "expired", "voided"]),
  expiry_warning: z.boolean(), manual_attention_warning: z.boolean(),
  action_required: z.boolean(), warning_reasons: z.array(warningReason).max(2),
  warning_basis: z.literal("manual_valid_through_and_manual_attention_flag"),
  medical_interpretation_status: z.literal("not_evaluated"),
  recorded_by: uuid, recorded_by_display_name: clean(120),
  recorded_at: timestamp, content_hash: hash,
}).strict();

const historySchema = z.object({
  record_version_id: uuid, tocc_key: uuid,
  version: z.number().int().positive().safe(), previous_version_id: uuid.nullable(),
  record_status: recordStatus, correction_reason: clean(1_000, true).nullable(),
  assessed_on: date, valid_through: date, validity_source: clean(240),
  result_text: clean(1_000, true), manual_attention_flag: z.boolean(),
  attention_note: clean(1_000, true).nullable(), evidence_status: evidenceStatus,
  disposition_status: dispositionStatus,
  disposition_note: clean(1_000, true).nullable(),
  recorded_by_display_name: clean(120), recorded_at: timestamp, content_hash: hash,
}).strict();

const staffSchema = z.object({
  staff_membership_id: uuid, staff_user_id: uuid,
  display_name: clean(120), employee_code: clean(120).nullable(),
  is_current: z.boolean(),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  snapshot_date: date, records: z.array(recordSchema).max(200),
  record_total: count, records_truncated: z.boolean(), active_total: count,
  expired_total: count, manual_attention_total: count, action_required_total: count,
  history: z.array(historySchema).max(500), history_total: count,
  history_truncated: z.boolean(), staff_options: z.array(staffSchema).max(200),
  staff_total: count, staff_truncated: z.boolean(),
  validity_rule_status: z.literal("not_configured"),
  valid_through_source_mode: z.literal("manual_per_record"),
  warning_basis: z.literal("manual_valid_through_and_manual_attention_flag"),
  medical_interpretation_status: z.literal("not_evaluated"),
  expiry_reminder_schedule_status: z.literal("not_configured"),
  expiry_notice_days: z.null(), expiring_total: z.null(),
  attachment_pipeline_status: z.literal("not_configured"),
  attachment_scan_status: z.literal("not_configured"),
}).strict();

export type StaffToccSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("STAFF_TOCC_SNAPSHOT_INVALID");
}

function expectedReasons(record: z.infer<typeof recordSchema>) {
  if (record.record_status === "voided") return [];
  return [
    record.expiry_warning ? "expired_manual_valid_through" : null,
    record.manual_attention_warning ? "manual_attention_flag" : null,
  ].filter((value): value is "expired_manual_valid_through" | "manual_attention_flag" =>
    value !== null);
}

export function projectStaffToccSnapshot({
  row: value, expectedOrganizationId, expectedBranchId, filters, demo,
}: {
  row: StaffToccSnapshotSourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: StaffToccFilters;
  demo: boolean;
}): StaffToccSnapshot {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== expectedOrganizationId ||
    row.branch_id !== expectedBranchId ||
    row.snapshot_date !== staffToccTaipeiDate(new Date(row.generated_at)) ||
    row.records_truncated !== (row.record_total > 200) ||
    row.history_truncated !== (row.history_total > 500) ||
    row.staff_truncated !== (row.staff_total > 200) ||
    row.records.length > row.record_total || row.history.length > row.history_total ||
    row.staff_options.length > row.staff_total) invalid();

  const keys = new Set<string>();
  for (const record of row.records) {
    const expiry = record.record_status === "active" &&
      record.valid_through < row.snapshot_date;
    const attention = record.record_status === "active" && record.manual_attention_flag;
    const action = attention && record.disposition_status !== "completed";
    const validity = record.record_status === "voided" ? "voided" :
      expiry ? "expired" : "active";
    if (keys.has(record.tocc_key) || record.valid_through < record.assessed_on ||
      (record.version === 1) !== (record.previous_version_id === null) ||
      (record.version === 1) !== (record.correction_reason === null) ||
      record.manual_attention_flag !== (record.attention_note !== null) ||
      ((record.disposition_status === "not_recorded") !==
        (record.disposition_note === null)) ||
      record.validity_status !== validity || record.expiry_warning !== expiry ||
      record.manual_attention_warning !== attention || record.action_required !== action ||
      JSON.stringify(record.warning_reasons) !== JSON.stringify(expectedReasons(record))) {
      invalid();
    }
    keys.add(record.tocc_key);
  }

  const historyIds = new Set<string>();
  for (const record of row.history) {
    if (historyIds.has(record.record_version_id) ||
      record.valid_through < record.assessed_on ||
      (record.version === 1) !== (record.previous_version_id === null) ||
      (record.version === 1) !== (record.correction_reason === null) ||
      record.manual_attention_flag !== (record.attention_note !== null) ||
      ((record.disposition_status === "not_recorded") !==
        (record.disposition_note === null))) invalid();
    historyIds.add(record.record_version_id);
  }

  if (!row.records_truncated && (row.record_total !== row.records.length ||
    row.active_total !== row.records.filter((record) =>
      record.validity_status === "active").length ||
    row.expired_total !== row.records.filter((record) =>
      record.validity_status === "expired").length ||
    row.manual_attention_total !== row.records.filter((record) =>
      record.manual_attention_warning).length ||
    row.action_required_total !== row.records.filter((record) =>
      record.action_required).length)) invalid();
  if (!row.history_truncated && row.history_total !== row.history.length) invalid();
  if (!row.staff_truncated && row.staff_total !== row.staff_options.length) invalid();

  return {
    organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at, snapshotDate: row.snapshot_date,
    staleAfter: new Date(Date.parse(row.generated_at) + 5 * 60_000).toISOString(),
    filters,
    records: row.records.map((record) => ({
      recordVersionId: record.record_version_id, toccKey: record.tocc_key,
      version: record.version, previousVersionId: record.previous_version_id,
      recordStatus: record.record_status, correctionReason: record.correction_reason,
      staffMembershipId: record.staff_membership_id, staffUserId: record.staff_user_id,
      staffDisplayName: record.staff_display_name,
      staffEmployeeCode: record.staff_employee_code,
      assessedOn: record.assessed_on, validThrough: record.valid_through,
      validitySource: record.validity_source, resultText: record.result_text,
      manualAttentionFlag: record.manual_attention_flag,
      attentionNote: record.attention_note, evidenceStatus: record.evidence_status,
      dispositionStatus: record.disposition_status,
      dispositionNote: record.disposition_note, validityStatus: record.validity_status,
      expiryWarning: record.expiry_warning,
      manualAttentionWarning: record.manual_attention_warning,
      actionRequired: record.action_required, warningReasons: record.warning_reasons,
      warningBasis: record.warning_basis,
      medicalInterpretationStatus: record.medical_interpretation_status,
      recordedBy: record.recorded_by,
      recordedByDisplayName: record.recorded_by_display_name,
      recordedAt: record.recorded_at, contentHash: record.content_hash,
    })),
    recordTotal: row.record_total, recordsTruncated: row.records_truncated,
    activeTotal: row.active_total, expiredTotal: row.expired_total,
    manualAttentionTotal: row.manual_attention_total,
    actionRequiredTotal: row.action_required_total,
    history: row.history.map((record) => ({
      recordVersionId: record.record_version_id, toccKey: record.tocc_key,
      version: record.version, previousVersionId: record.previous_version_id,
      recordStatus: record.record_status, correctionReason: record.correction_reason,
      assessedOn: record.assessed_on, validThrough: record.valid_through,
      validitySource: record.validity_source, resultText: record.result_text,
      manualAttentionFlag: record.manual_attention_flag,
      attentionNote: record.attention_note, evidenceStatus: record.evidence_status,
      dispositionStatus: record.disposition_status,
      dispositionNote: record.disposition_note,
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
    validityRuleStatus: row.validity_rule_status,
    validThroughSourceMode: row.valid_through_source_mode,
    warningBasis: row.warning_basis,
    medicalInterpretationStatus: row.medical_interpretation_status,
    expiryReminderScheduleStatus: row.expiry_reminder_schedule_status,
    expiryNoticeDays: null, expiringTotal: null,
    attachmentPipelineStatus: row.attachment_pipeline_status,
    attachmentScanStatus: row.attachment_scan_status, demo,
  };
}
