import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { isStaffTrainingCalendarDate, staffTrainingTaipeiDate } from "./date";
import {
  canonicalStaffTrainingDecimal,
  staffTrainingDecimalToScaledInteger,
} from "./decimal";
import type { StaffTrainingFilters, StaffTrainingSnapshot } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const date = z.string().refine(isStaffTrainingCalendarDate);
const text = (max: number) => z.string().trim().min(1).max(max);
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const decimal = z.string().regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u);

const recordSchema = z.object({
  record_version_id: uuid, training_key: uuid,
  version: z.number().int().positive().safe(), previous_version_id: uuid.nullable(),
  record_status: z.enum(["active", "voided"]), correction_reason: text(1_000).nullable(),
  staff_membership_id: uuid, staff_user_id: uuid,
  staff_display_name: text(120), staff_employee_code: text(120).nullable(),
  course_title: text(240), training_date: date, starts_at: timestamp, ends_at: timestamp,
  course_type: text(120), hours: decimal, credits: decimal.nullable(),
  provider_name: text(200),
  evidence_status: z.enum(["provided", "missing", "not_applicable"]),
  credit_expires_on: date.nullable(), is_expiring: z.boolean().nullable(),
  recorded_by: uuid, recorded_by_display_name: text(120), recorded_at: timestamp,
  content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

const staffSchema = z.object({
  staff_membership_id: uuid, staff_user_id: uuid, display_name: text(120),
  employee_code: text(120).nullable(), is_current: z.boolean(),
}).strict();
const courseTypeSchema = z.object({
  course_type: text(120), record_count: count,
}).strict();
const progressSchema = z.object({
  staff_membership_id: uuid, staff_user_id: uuid, display_name: text(120),
  employee_code: text(120).nullable(), active_record_count: count,
  known_credits: decimal.nullable(), missing_credit_count: count.nullable(),
  required_credits: decimal.nullable(), credit_gap: decimal.nullable(),
  progress_status: z.enum(["not_configured", "indeterminate", "complete", "incomplete"]),
  window_start: date.nullable(), window_end: date.nullable(),
  rule_version: z.number().int().positive().safe().nullable(),
}).strict();
const proposalSchema = z.object({
  proposal_id: uuid, effective_from: date, effective_to: date.nullable(),
  window_years: z.number().int().min(1).max(50), required_credits: decimal,
  expiry_notice_days: z.number().int().min(0).max(3650), proposed_by: uuid,
  proposer_display_name: text(120), proposed_at: timestamp,
  content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp, snapshot_date: date,
  policy_status: z.enum(["not_configured", "published"]),
  rule_version_id: uuid.nullable(), rule_version: z.number().int().positive().safe().nullable(),
  rule_effective_from: date.nullable(), rule_effective_to: date.nullable(),
  window_years: z.number().int().min(1).max(50).nullable(),
  required_credits: decimal.nullable(),
  expiry_notice_days: z.number().int().min(0).max(3650).nullable(),
  records: z.array(recordSchema).max(200), record_total: count,
  records_truncated: z.boolean(), hours_total: decimal,
  credits_total: decimal.nullable(), credited_record_total: count,
  missing_credit_total: count, missing_evidence_total: count,
  expiring_total: count.nullable(), staff_options: z.array(staffSchema).max(200),
  staff_total: count, staff_truncated: z.boolean(),
  course_type_options: z.array(courseTypeSchema).max(200), course_type_total: count,
  course_types_truncated: z.boolean(), staff_progress: z.array(progressSchema).max(200),
  progress_total: count, progress_truncated: z.boolean(), gap_staff_total: count.nullable(),
  indeterminate_staff_total: count.nullable(),
  pending_rule_proposals: z.array(proposalSchema).max(200),
  pending_rule_proposal_total: count, pending_rule_proposals_truncated: z.boolean(),
  attachment_pipeline_status: z.literal("not_configured"),
  attachment_scan_status: z.literal("not_configured"),
  external_reporting: z.literal("not_implemented"),
  progress_scope: z.literal("published_rule_window_all_course_types"),
}).strict();

export type StaffTrainingSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_STAFF_TRAINING_PROJECTION");
}
function unique(values: readonly string[]) {
  return values.length === new Set(values).size;
}
function totalInvariant(total: number, loaded: number, truncated: boolean) {
  return total >= loaded && truncated === (total > loaded) &&
    (truncated || total === loaded);
}
function addDays(dateValue: string, days: number) {
  const dateObject = new Date(`${dateValue}T00:00:00Z`);
  dateObject.setUTCDate(dateObject.getUTCDate() + days);
  return dateObject.toISOString().slice(0, 10);
}

export function projectStaffTrainingSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: StaffTrainingFilters;
  demo: boolean;
}): StaffTrainingSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data ||
    staffTrainingTaipeiDate(row.generated_at) !== row.snapshot_date ||
    !totalInvariant(row.record_total, row.records.length, row.records_truncated) ||
    !totalInvariant(row.staff_total, row.staff_options.length, row.staff_truncated) ||
    !totalInvariant(row.course_type_total, row.course_type_options.length,
      row.course_types_truncated) ||
    !totalInvariant(row.progress_total, row.staff_progress.length, row.progress_truncated) ||
    !totalInvariant(row.pending_rule_proposal_total, row.pending_rule_proposals.length,
      row.pending_rule_proposals_truncated) ||
    !unique(row.records.map((record) => record.training_key)) ||
    !unique(row.records.map((record) => record.record_version_id)) ||
    !unique(row.staff_options.map((staff) => staff.staff_membership_id)) ||
    !unique(row.course_type_options.map((option) => option.course_type)) ||
    !unique(row.staff_progress.map((progress) => progress.staff_membership_id)) ||
    !unique(row.pending_rule_proposals.map((proposal) => proposal.proposal_id)) ||
    row.credited_record_total + row.missing_credit_total > row.record_total) invalid();

  if (row.policy_status === "not_configured") {
    if (row.rule_version_id !== null || row.rule_version !== null ||
      row.rule_effective_from !== null || row.rule_effective_to !== null ||
      row.window_years !== null || row.required_credits !== null ||
      row.expiry_notice_days !== null || row.expiring_total !== null ||
      row.gap_staff_total !== null || row.indeterminate_staff_total !== null) invalid();
  } else if (row.rule_version_id === null || row.rule_version === null ||
    row.rule_effective_from === null || row.window_years === null ||
    row.required_credits === null || row.expiry_notice_days === null ||
    row.expiring_total === null || row.gap_staff_total === null ||
    row.indeterminate_staff_total === null ||
    row.rule_effective_from > row.snapshot_date ||
    (row.rule_effective_to !== null && row.rule_effective_to < row.snapshot_date)) invalid();

  let previousSort: string | null = null;
  for (const record of row.records) {
    const sort = `${record.training_date}|${record.starts_at}|${record.training_key}`;
    const matchesSearch = `${record.staff_display_name} ${record.staff_employee_code ?? ""} ` +
      `${record.course_title} ${record.course_type} ${record.provider_name}`;
    if ((record.version === 1) !== (record.previous_version_id === null) ||
      (record.version === 1) !== (record.correction_reason === null) ||
      Date.parse(record.ends_at) <= Date.parse(record.starts_at) ||
      Date.parse(record.ends_at) > Date.parse(record.recorded_at) ||
      Date.parse(record.recorded_at) > Date.parse(row.generated_at) ||
      staffTrainingTaipeiDate(record.starts_at) !== record.training_date ||
      (previousSort !== null && sort > previousSort) ||
      (input.filters.dateFrom !== null && record.training_date < input.filters.dateFrom) ||
      (input.filters.dateTo !== null && record.training_date > input.filters.dateTo) ||
      (input.filters.staffMembershipId !== null &&
        record.staff_membership_id !== input.filters.staffMembershipId) ||
      (input.filters.courseType !== null && record.course_type !== input.filters.courseType) ||
      (input.filters.query && !matchesSearch.toLocaleLowerCase("zh-TW")
        .includes(input.filters.query.toLocaleLowerCase("zh-TW"))) ||
      (input.filters.status === "active" && record.record_status !== "active") ||
      (input.filters.status === "voided" && record.record_status !== "voided") ||
      (input.filters.status === "missing_evidence" &&
        (record.record_status !== "active" || record.evidence_status !== "missing")) ||
      (input.filters.status === "expiring" &&
        (record.record_status !== "active" || record.is_expiring !== true))) invalid();
    if (row.policy_status === "not_configured") {
      if (record.credit_expires_on !== null || record.is_expiring !== null) invalid();
    } else if (record.credits === null) {
      if (record.credit_expires_on !== null || record.is_expiring !== null) invalid();
    } else {
      if (record.credit_expires_on === null || record.is_expiring === null) invalid();
      const expectedExpiring = record.credit_expires_on > row.snapshot_date &&
        record.credit_expires_on <= addDays(row.snapshot_date, row.expiry_notice_days!);
      if (record.is_expiring !== expectedExpiring) invalid();
    }
    previousSort = sort;
  }

  for (const progress of row.staff_progress) {
    if (row.policy_status === "not_configured") {
      if (progress.progress_status !== "not_configured" || progress.known_credits !== null ||
        progress.missing_credit_count !== null || progress.required_credits !== null ||
        progress.credit_gap !== null || progress.window_start !== null ||
        progress.window_end !== null || progress.rule_version !== null) invalid();
      continue;
    }
    if (progress.known_credits === null || progress.missing_credit_count === null ||
      progress.required_credits === null || progress.window_start === null ||
      progress.window_end !== row.snapshot_date || progress.rule_version === null ||
      progress.rule_version !== row.rule_version ||
      canonicalStaffTrainingDecimal(progress.required_credits) !==
        canonicalStaffTrainingDecimal(row.required_credits!)) invalid();
    const known = staffTrainingDecimalToScaledInteger(progress.known_credits);
    const required = staffTrainingDecimalToScaledInteger(progress.required_credits);
    if (progress.missing_credit_count > 0) {
      if (progress.progress_status !== "indeterminate" || progress.credit_gap !== null) invalid();
    } else if (known >= required) {
      if (progress.progress_status !== "complete" ||
        staffTrainingDecimalToScaledInteger(progress.credit_gap ?? "-1") !== BigInt(0)) invalid();
    } else if (progress.progress_status !== "incomplete" || progress.credit_gap === null ||
      staffTrainingDecimalToScaledInteger(progress.credit_gap) !== required - known) invalid();
  }

  if (!row.records_truncated) {
    const active = row.records.filter((record) => record.record_status === "active");
    const hours = active.reduce((total, record) =>
      total + staffTrainingDecimalToScaledInteger(record.hours), BigInt(0));
    const credits = active.filter((record) => record.credits !== null).reduce((total, record) =>
      total + staffTrainingDecimalToScaledInteger(record.credits!), BigInt(0));
    if (staffTrainingDecimalToScaledInteger(row.hours_total) !== hours ||
      row.credited_record_total + row.missing_credit_total !== active.length ||
      (row.credits_total === null) !== (row.credited_record_total === 0) ||
      (row.credits_total !== null && staffTrainingDecimalToScaledInteger(row.credits_total) !== credits) ||
      row.missing_evidence_total !== row.records.filter((record) =>
        record.record_status === "active" && record.evidence_status === "missing").length ||
      (row.policy_status === "published" && row.expiring_total !== row.records.filter((record) =>
        record.record_status === "active" && record.is_expiring === true).length)) invalid();
  }

  return {
    organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at, snapshotDate: row.snapshot_date,
    staleAfter: new Date(Date.parse(row.generated_at) + 5 * 60_000).toISOString(),
    filters: input.filters, policyStatus: row.policy_status,
    ruleVersionId: row.rule_version_id, ruleVersion: row.rule_version,
    ruleEffectiveFrom: row.rule_effective_from, ruleEffectiveTo: row.rule_effective_to,
    windowYears: row.window_years,
    requiredCredits: row.required_credits === null ? null :
      canonicalStaffTrainingDecimal(row.required_credits),
    expiryNoticeDays: row.expiry_notice_days,
    records: row.records.map((record) => ({
      recordVersionId: record.record_version_id, trainingKey: record.training_key,
      version: record.version, previousVersionId: record.previous_version_id,
      recordStatus: record.record_status, correctionReason: record.correction_reason,
      staffMembershipId: record.staff_membership_id, staffUserId: record.staff_user_id,
      staffDisplayName: record.staff_display_name, staffEmployeeCode: record.staff_employee_code,
      courseTitle: record.course_title, trainingDate: record.training_date,
      startsAt: record.starts_at, endsAt: record.ends_at, courseType: record.course_type,
      hours: canonicalStaffTrainingDecimal(record.hours),
      credits: record.credits === null ? null : canonicalStaffTrainingDecimal(record.credits),
      providerName: record.provider_name, evidenceStatus: record.evidence_status,
      creditExpiresOn: record.credit_expires_on, isExpiring: record.is_expiring,
      recordedBy: record.recorded_by,
      recordedByDisplayName: record.recorded_by_display_name,
      recordedAt: record.recorded_at, contentHash: record.content_hash,
    })),
    recordTotal: row.record_total, recordsTruncated: row.records_truncated,
    hoursTotal: canonicalStaffTrainingDecimal(row.hours_total),
    creditsTotal: row.credits_total === null ? null :
      canonicalStaffTrainingDecimal(row.credits_total),
    creditedRecordTotal: row.credited_record_total,
    missingCreditTotal: row.missing_credit_total,
    missingEvidenceTotal: row.missing_evidence_total, expiringTotal: row.expiring_total,
    staffOptions: row.staff_options.map((staff) => ({
      staffMembershipId: staff.staff_membership_id, staffUserId: staff.staff_user_id,
      displayName: staff.display_name, employeeCode: staff.employee_code,
      isCurrent: staff.is_current,
    })),
    staffTotal: row.staff_total, staffTruncated: row.staff_truncated,
    courseTypeOptions: row.course_type_options.map((option) => ({
      courseType: option.course_type, recordCount: option.record_count,
    })),
    courseTypeTotal: row.course_type_total,
    courseTypesTruncated: row.course_types_truncated,
    staffProgress: row.staff_progress.map((progress) => ({
      staffMembershipId: progress.staff_membership_id, staffUserId: progress.staff_user_id,
      displayName: progress.display_name, employeeCode: progress.employee_code,
      activeRecordCount: progress.active_record_count,
      knownCredits: progress.known_credits === null ? null :
        canonicalStaffTrainingDecimal(progress.known_credits),
      missingCreditCount: progress.missing_credit_count,
      requiredCredits: progress.required_credits === null ? null :
        canonicalStaffTrainingDecimal(progress.required_credits),
      creditGap: progress.credit_gap === null ? null :
        canonicalStaffTrainingDecimal(progress.credit_gap),
      progressStatus: progress.progress_status, windowStart: progress.window_start,
      windowEnd: progress.window_end, ruleVersion: progress.rule_version,
    })),
    progressTotal: row.progress_total, progressTruncated: row.progress_truncated,
    gapStaffTotal: row.gap_staff_total,
    indeterminateStaffTotal: row.indeterminate_staff_total,
    pendingRuleProposals: row.pending_rule_proposals.map((proposal) => ({
      proposalId: proposal.proposal_id, effectiveFrom: proposal.effective_from,
      effectiveTo: proposal.effective_to, windowYears: proposal.window_years,
      requiredCredits: canonicalStaffTrainingDecimal(proposal.required_credits),
      expiryNoticeDays: proposal.expiry_notice_days,
      proposedBy: proposal.proposed_by,
      proposerDisplayName: proposal.proposer_display_name,
      proposedAt: proposal.proposed_at, contentHash: proposal.content_hash,
    })),
    pendingRuleProposalTotal: row.pending_rule_proposal_total,
    pendingRuleProposalsTruncated: row.pending_rule_proposals_truncated,
    attachmentPipelineStatus: row.attachment_pipeline_status,
    attachmentScanStatus: row.attachment_scan_status,
    externalReporting: row.external_reporting, progressScope: row.progress_scope,
    demo: input.demo,
  };
}
