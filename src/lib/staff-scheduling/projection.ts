import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { addStaffSchedulingDays, isStaffSchedulingDate } from "./date";
import type {
  StaffScheduleConflict,
  StaffScheduleHistory,
  StaffScheduleRecord,
  StaffSchedulingFilters,
  StaffSchedulingRuleVersion,
  StaffSchedulingSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().refine(isStaffSchedulingDate);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const count = z.preprocess((value) => typeof value === "string" && /^\d+$/u.test(value)
  ? Number(value) : value, z.number().int().nonnegative().safe());
const positive = z.preprocess((value) => typeof value === "string" && /^\d+$/u.test(value)
  ? Number(value) : value, z.number().int().positive().safe());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const code = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u);
const status = z.enum(["draft_ready", "draft_conflicted", "published", "voided"]);
const reviewMode = z.enum(["standard", "override", "rejected"]).nullable();
const ruleStatus = z.enum(["configured_manual_unstandardized", "not_configured"]);

const shiftConflict = z.object({
  domain: z.literal("work_time"), code: z.literal("shift_duration_exceeded"),
  message: clean(300, true), observed_minutes: positive, rule_minutes: positive,
}).strict();
const overlapConflict = z.object({
  domain: z.literal("work_time"), code: z.literal("staff_time_overlap"),
  message: clean(300, true), overlapping_schedule_count: positive,
}).strict();
const restConflict = z.object({
  domain: z.literal("rest"), code: z.literal("minimum_rest_not_met"),
  message: clean(300, true), nearby_schedule_count: positive,
  rule_minutes: count,
}).strict();
const qualificationConflict = z.object({
  domain: z.literal("qualification"),
  code: z.literal("terminal_certificate_evidence_missing"),
  message: clean(300, true), required_certificate_type: clean(160),
  source_page: z.literal(72),
}).strict();
const capacityConflict = z.discriminatedUnion("domain", [
  z.object({ domain: z.literal("facility"),
    code: z.literal("facility_capacity_exceeded"), message: clean(300, true),
    existing_clients: count, planned_clients: positive, rule_capacity: positive }).strict(),
  z.object({ domain: z.literal("vehicle"),
    code: z.literal("vehicle_capacity_exceeded"), message: clean(300, true),
    existing_clients: count, planned_clients: positive, rule_capacity: positive }).strict(),
  z.object({ domain: z.literal("branch_capacity"),
    code: z.literal("branch_capacity_exceeded"), message: clean(300, true),
    existing_clients: count, planned_clients: positive, rule_capacity: positive }).strict(),
]);
const conflict = z.union([
  shiftConflict, overlapConflict, restConflict, qualificationConflict, capacityConflict,
]);

const evidence = z.object({
  source_page: z.literal(72), record_version_id: uuid, certificate_key: uuid,
  version: positive, certificate_type: clean(160),
  validity_status: z.enum(["active", "upcoming", "expired", "pending_verification",
    "registration_not_active", "voided"]),
  has_active_exception: z.boolean(), snapshot_date: date,
}).strict();

const record = z.object({
  schedule_version_id: uuid, schedule_key: uuid, version: positive,
  previous_version_id: uuid.nullable(), status, review_mode: reviewMode,
  rule_version_id: uuid, staff_membership_id: uuid, staff_user_id: uuid,
  staff_display_name: clean(120), staff_employee_code: clean(80).nullable(),
  starts_at: timestamp, ends_at: timestamp, role_text: clean(160),
  service_need_text: clean(500, true), facility_code: code, vehicle_code: code,
  planned_clients: positive, conflict_count: count,
  conflicts: z.array(conflict).max(20), qualification_evidence: z.array(evidence).max(20),
  qualification_projection: z.literal("page72_terminal"),
  revision_reason: clean(1_000, true), created_by: uuid,
  creator_display_name: clean(120), created_at: timestamp,
  reviewed_by: uuid.nullable(), reviewer_display_name: clean(120).nullable(),
  reviewed_at: timestamp.nullable(), review_reason: clean(1_000, true).nullable(),
  content_hash: hash,
}).strict();

const history = z.object({
  schedule_version_id: uuid, schedule_key: uuid, version: positive,
  previous_version_id: uuid.nullable(), status, review_mode: reviewMode,
  rule_version_id: uuid, conflict_count: count, content_hash: hash,
  created_at: timestamp, creator_display_name: clean(120),
  reviewed_at: timestamp.nullable(), reviewer_display_name: clean(120).nullable(),
}).strict();

const staff = z.object({
  staff_membership_id: uuid, staff_user_id: uuid, display_name: clean(120),
  employee_code: clean(80).nullable(),
}).strict();

const qualificationRule = z.object({
  role_text: clean(160), required_certificate_type: clean(160),
  taxonomy_status: z.literal("manual_unstandardized"),
}).strict();
const facilityRule = z.object({
  facility_code: code, name: clean(160), capacity: positive,
  taxonomy_status: z.literal("manual_unstandardized"),
}).strict();
const vehicleRule = z.object({
  vehicle_code: code, name: clean(160), capacity: positive,
  taxonomy_status: z.literal("manual_unstandardized"),
}).strict();
const rulePayload = z.object({
  qualification_rules: z.array(qualificationRule).min(1).max(50),
  work_rules: z.object({ max_shift_minutes: positive, min_rest_minutes: count,
    source_status: z.literal("manual_unstandardized") }).strict(),
  facilities: z.array(facilityRule).min(1).max(100),
  vehicles: z.array(vehicleRule).min(1).max(100),
  branch_capacity: positive, source_status: z.literal("manual_unstandardized"),
}).strict();
const ruleVersion = z.object({
  rule_version_id: uuid, rule_set_key: uuid, version: positive,
  effective_from: date, effective_to: date.nullable(),
  source_status: z.literal("manual_unstandardized"),
  rule_payload: rulePayload, content_hash: hash,
}).strict();

const source = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  period_start: date, period_end: date,
  records: z.array(record).max(200), record_total: count,
  records_truncated: z.boolean(), ready_total: count, conflicted_total: count,
  published_total: count, overridden_total: count, rejected_total: count,
  history: z.array(history).max(500), history_total: count,
  history_truncated: z.boolean(), staff_options: z.array(staff).max(200),
  staff_total: count, staff_truncated: z.boolean(),
  rule_configuration_status: ruleStatus, rule_version: ruleVersion.nullable(),
  qualification_rule_status: ruleStatus, work_time_rule_status: ruleStatus,
  rest_rule_status: ruleStatus, facility_rule_status: ruleStatus,
  vehicle_rule_status: ruleStatus, capacity_rule_status: ruleStatus,
  qualification_projection: z.literal("page72_terminal"),
  decision_engine: z.literal("deterministic_rule_assisted"),
  ai_status: z.literal("not_used"), automatic_publish_status: z.literal("disabled"),
  export_status: z.literal("disabled"), offline_status: z.literal("disabled"),
}).strict();

export type StaffSchedulingSnapshotSourceRow = z.input<typeof source>;

function invalid(): never {
  throw new Error("STAFF_SCHEDULING_SNAPSHOT_INVALID");
}

function mapConflict(value: z.output<typeof conflict>): StaffScheduleConflict {
  if (value.code === "shift_duration_exceeded") return { domain: value.domain,
    code: value.code, message: value.message, observedMinutes: value.observed_minutes,
    ruleMinutes: value.rule_minutes };
  if (value.code === "staff_time_overlap") return { domain: value.domain,
    code: value.code, message: value.message,
    overlappingScheduleCount: value.overlapping_schedule_count };
  if (value.code === "minimum_rest_not_met") return { domain: value.domain,
    code: value.code, message: value.message,
    nearbyScheduleCount: value.nearby_schedule_count, ruleMinutes: value.rule_minutes };
  if (value.code === "terminal_certificate_evidence_missing") return {
    domain: value.domain, code: value.code, message: value.message,
    requiredCertificateType: value.required_certificate_type, sourcePage: 72,
  };
  return { domain: value.domain, code: value.code, message: value.message,
    existingClients: value.existing_clients, plannedClients: value.planned_clients,
    ruleCapacity: value.rule_capacity };
}

function mapRecord(value: z.output<typeof record>): StaffScheduleRecord {
  return {
    scheduleVersionId: value.schedule_version_id, scheduleKey: value.schedule_key,
    version: value.version, previousVersionId: value.previous_version_id,
    status: value.status, reviewMode: value.review_mode,
    ruleVersionId: value.rule_version_id,
    staffMembershipId: value.staff_membership_id, staffUserId: value.staff_user_id,
    staffDisplayName: value.staff_display_name,
    staffEmployeeCode: value.staff_employee_code, startsAt: value.starts_at,
    endsAt: value.ends_at, roleText: value.role_text,
    serviceNeedText: value.service_need_text, facilityCode: value.facility_code,
    vehicleCode: value.vehicle_code, plannedClients: value.planned_clients,
    conflictCount: value.conflict_count, conflicts: value.conflicts.map(mapConflict),
    qualificationEvidence: value.qualification_evidence.map((item) => ({
      sourcePage: 72, recordVersionId: item.record_version_id,
      certificateKey: item.certificate_key, version: item.version,
      certificateType: item.certificate_type, validityStatus: item.validity_status,
      hasActiveException: item.has_active_exception, snapshotDate: item.snapshot_date,
    })), qualificationProjection: "page72_terminal",
    revisionReason: value.revision_reason, createdBy: value.created_by,
    creatorDisplayName: value.creator_display_name, createdAt: value.created_at,
    reviewedBy: value.reviewed_by, reviewerDisplayName: value.reviewer_display_name,
    reviewedAt: value.reviewed_at, reviewReason: value.review_reason,
    contentHash: value.content_hash,
  };
}

function mapHistory(value: z.output<typeof history>): StaffScheduleHistory {
  return {
    scheduleVersionId: value.schedule_version_id, scheduleKey: value.schedule_key,
    version: value.version, previousVersionId: value.previous_version_id,
    status: value.status, reviewMode: value.review_mode,
    ruleVersionId: value.rule_version_id, conflictCount: value.conflict_count,
    contentHash: value.content_hash, createdAt: value.created_at,
    creatorDisplayName: value.creator_display_name,
    reviewedAt: value.reviewed_at, reviewerDisplayName: value.reviewer_display_name,
  };
}

function mapRule(value: z.output<typeof ruleVersion>): StaffSchedulingRuleVersion {
  return {
    ruleVersionId: value.rule_version_id, ruleSetKey: value.rule_set_key,
    version: value.version, effectiveFrom: value.effective_from,
    effectiveTo: value.effective_to, sourceStatus: value.source_status,
    qualificationRules: value.rule_payload.qualification_rules.map((item) => ({
      roleText: item.role_text, requiredCertificateType: item.required_certificate_type,
      taxonomyStatus: item.taxonomy_status,
    })), maxShiftMinutes: value.rule_payload.work_rules.max_shift_minutes,
    minRestMinutes: value.rule_payload.work_rules.min_rest_minutes,
    facilities: value.rule_payload.facilities.map((item) => ({ code: item.facility_code,
      name: item.name, capacity: item.capacity, taxonomyStatus: item.taxonomy_status })),
    vehicles: value.rule_payload.vehicles.map((item) => ({ code: item.vehicle_code,
      name: item.name, capacity: item.capacity, taxonomyStatus: item.taxonomy_status })),
    branchCapacity: value.rule_payload.branch_capacity, contentHash: value.content_hash,
  };
}

function validateRecord(item: z.output<typeof record>, filters: StaffSchedulingFilters) {
  const pending = item.status === "draft_ready" || item.status === "draft_conflicted";
  const published = item.status === "published";
  const rejected = item.status === "voided";
  const reviewEmpty = item.review_mode === null && item.reviewed_by === null &&
    item.reviewer_display_name === null && item.reviewed_at === null &&
    item.review_reason === null;
  const reviewed = item.reviewed_by !== null && item.reviewer_display_name !== null &&
    item.reviewed_at !== null && item.review_reason !== null;
  const filterMatches = filters.status === "all" ||
    filters.status === "ready" && item.status === "draft_ready" ||
    filters.status === "conflicted" && item.status === "draft_conflicted" ||
    filters.status === "published" && published && item.review_mode === "standard" ||
    filters.status === "overridden" && published && item.review_mode === "override" ||
    filters.status === "rejected" && rejected;
  const startBoundary = Date.parse(`${filters.periodStart}T00:00:00+08:00`);
  const endBoundary = Date.parse(`${addStaffSchedulingDays(filters.periodEnd, 1)}T00:00:00+08:00`);
  const evidenceValid = item.qualification_evidence.every((evidenceItem) =>
    evidenceItem.source_page === 72 &&
    (evidenceItem.validity_status === "active" || evidenceItem.has_active_exception));
  if ((item.version === 1) !== (item.previous_version_id === null) ||
    Date.parse(item.ends_at) <= Date.parse(item.starts_at) ||
    Date.parse(item.ends_at) - Date.parse(item.starts_at) > 7 * 86_400_000 ||
    Date.parse(item.starts_at) >= endBoundary || Date.parse(item.ends_at) < startBoundary ||
    filters.staffMembershipId !== null &&
      item.staff_membership_id !== filters.staffMembershipId || !filterMatches ||
    item.conflict_count !== item.conflicts.length || !evidenceValid ||
    (item.status === "draft_ready") !== (pending && item.conflict_count === 0) ||
    (item.status === "draft_conflicted") !== (pending && item.conflict_count > 0) ||
    pending && !reviewEmpty || published && (!reviewed ||
      !["standard", "override"].includes(item.review_mode ?? "")) ||
    rejected && (!reviewed || item.review_mode !== "rejected") ||
    item.review_mode === "standard" && item.conflict_count !== 0 ||
    item.review_mode === "override" && item.conflict_count === 0) invalid();
}

export function projectStaffSchedulingSnapshot({
  row: value, expectedOrganizationId, expectedBranchId, filters, demo,
}: {
  row: StaffSchedulingSnapshotSourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: StaffSchedulingFilters;
  demo: boolean;
}): StaffSchedulingSnapshot {
  const parsed = source.safeParse(value);
  if (!parsed.success) invalid();
  const row = parsed.data;
  const ruleStatuses = [row.qualification_rule_status, row.work_time_rule_status,
    row.rest_rule_status, row.facility_rule_status, row.vehicle_rule_status,
    row.capacity_rule_status];
  if (row.organization_id !== expectedOrganizationId ||
    row.branch_id !== expectedBranchId || row.period_start !== filters.periodStart ||
    row.period_end !== filters.periodEnd ||
    row.records_truncated !== (row.record_total > 200) ||
    row.history_truncated !== (row.history_total > 500) ||
    row.staff_truncated !== (row.staff_total > 200) ||
    row.records.length > row.record_total || row.history.length > row.history_total ||
    row.staff_options.length > row.staff_total ||
    row.ready_total + row.conflicted_total + row.published_total +
      row.rejected_total !== row.record_total ||
    row.overridden_total > row.published_total ||
    (row.rule_configuration_status === "not_configured") !== (row.rule_version === null) ||
    ruleStatuses.some((item) => item !== row.rule_configuration_status)) invalid();

  if (row.rule_version) {
    const payload = row.rule_version.rule_payload;
    const roleKeys = payload.qualification_rules.map((item) =>
      item.role_text.trim().toLocaleLowerCase("en-US"));
    const facilityKeys = payload.facilities.map((item) =>
      item.facility_code.toLocaleLowerCase("en-US"));
    const vehicleKeys = payload.vehicles.map((item) =>
      item.vehicle_code.toLocaleLowerCase("en-US"));
    if (row.rule_version.effective_from > filters.periodStart ||
      row.rule_version.effective_to !== null &&
        row.rule_version.effective_to < filters.periodEnd ||
      payload.work_rules.max_shift_minutes > 10_080 ||
      payload.work_rules.min_rest_minutes > 10_080 || payload.branch_capacity > 10_000 ||
      new Set(roleKeys).size !== roleKeys.length ||
      new Set(facilityKeys).size !== facilityKeys.length ||
      new Set(vehicleKeys).size !== vehicleKeys.length ||
      payload.facilities.some((item) => item.capacity > 10_000) ||
      payload.vehicles.some((item) => item.capacity > 10_000)) invalid();
  }

  const recordIds = new Set<string>();
  const scheduleKeys = new Set<string>();
  for (const item of row.records) {
    validateRecord(item, filters);
    if (recordIds.has(item.schedule_version_id) || scheduleKeys.has(item.schedule_key)) invalid();
    recordIds.add(item.schedule_version_id); scheduleKeys.add(item.schedule_key);
  }
  if (!row.records_truncated && (row.records.length !== row.record_total ||
    row.ready_total !== row.records.filter((item) => item.status === "draft_ready").length ||
    row.conflicted_total !== row.records.filter((item) =>
      item.status === "draft_conflicted").length ||
    row.published_total !== row.records.filter((item) => item.status === "published").length ||
    row.overridden_total !== row.records.filter((item) =>
      item.status === "published" && item.review_mode === "override").length ||
    row.rejected_total !== row.records.filter((item) => item.status === "voided").length)) {
    invalid();
  }

  const historyIds = new Set<string>();
  const chains = new Map<string, z.output<typeof history>[] >();
  for (const item of row.history) {
    const pending = item.status === "draft_ready" || item.status === "draft_conflicted";
    const reviewed = item.status === "published" || item.status === "voided";
    if (historyIds.has(item.schedule_version_id) ||
      (item.version === 1) !== (item.previous_version_id === null) ||
      pending && (item.review_mode !== null || item.reviewed_at !== null ||
        item.reviewer_display_name !== null) ||
      reviewed && (item.review_mode === null || item.reviewed_at === null ||
        item.reviewer_display_name === null) ||
      item.review_mode === "standard" && item.conflict_count !== 0 ||
      item.review_mode === "override" && item.conflict_count === 0) invalid();
    historyIds.add(item.schedule_version_id);
    chains.set(item.schedule_key, [...(chains.get(item.schedule_key) ?? []), item]);
  }
  if (!row.history_truncated) {
    if (row.history.length !== row.history_total) invalid();
    for (const chain of chains.values()) {
      chain.sort((a, b) => a.version - b.version);
      chain.forEach((item, index) => {
        if (item.version !== index + 1 || (index === 0 ? item.previous_version_id !== null :
          item.previous_version_id !== chain[index - 1]!.schedule_version_id)) invalid();
      });
    }
    for (const item of row.records) {
      const matched = row.history.find((candidate) =>
        candidate.schedule_version_id === item.schedule_version_id &&
        candidate.schedule_key === item.schedule_key && candidate.version === item.version &&
        candidate.previous_version_id === item.previous_version_id &&
        candidate.status === item.status && candidate.review_mode === item.review_mode &&
        candidate.rule_version_id === item.rule_version_id &&
        candidate.conflict_count === item.conflict_count &&
        candidate.content_hash === item.content_hash);
      const chain = chains.get(item.schedule_key);
      if (!matched || !chain || chain.at(-1)?.schedule_version_id !== item.schedule_version_id) {
        invalid();
      }
    }
  }

  const membershipIds = new Set<string>();
  const userIds = new Set<string>();
  for (const item of row.staff_options) {
    if (membershipIds.has(item.staff_membership_id) || userIds.has(item.staff_user_id)) invalid();
    membershipIds.add(item.staff_membership_id); userIds.add(item.staff_user_id);
  }
  if (!row.staff_truncated && row.staff_options.length !== row.staff_total) invalid();
  return {
    organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(), filters,
    records: row.records.map(mapRecord), recordTotal: row.record_total,
    recordsTruncated: row.records_truncated, readyTotal: row.ready_total,
    conflictedTotal: row.conflicted_total, publishedTotal: row.published_total,
    overriddenTotal: row.overridden_total, rejectedTotal: row.rejected_total,
    history: row.history.map(mapHistory), historyTotal: row.history_total,
    historyTruncated: row.history_truncated,
    staffOptions: row.staff_options.map((item) => ({
      staffMembershipId: item.staff_membership_id, staffUserId: item.staff_user_id,
      displayName: item.display_name, employeeCode: item.employee_code,
    })), staffTotal: row.staff_total, staffTruncated: row.staff_truncated,
    ruleConfigurationStatus: row.rule_configuration_status,
    ruleVersion: row.rule_version ? mapRule(row.rule_version) : null,
    qualificationRuleStatus: row.qualification_rule_status,
    workTimeRuleStatus: row.work_time_rule_status, restRuleStatus: row.rest_rule_status,
    facilityRuleStatus: row.facility_rule_status,
    vehicleRuleStatus: row.vehicle_rule_status,
    capacityRuleStatus: row.capacity_rule_status,
    qualificationProjection: "page72_terminal",
    decisionEngine: "deterministic_rule_assisted", aiStatus: "not_used",
    automaticPublishStatus: "disabled", exportStatus: "disabled",
    offlineStatus: "disabled", recentAal2MaxAgeMinutes: 15, demo,
  };
}
