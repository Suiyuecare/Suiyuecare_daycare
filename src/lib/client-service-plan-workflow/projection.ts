import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  CLIENT_SERVICE_PLAN_STATUSES,
  type ClientServicePlan,
  type ClientServicePlanFilters,
  type ClientServicePlanGoal,
  type ClientServicePlanMeasure,
  type ClientServicePlanSnapshot,
  type ClientServicePlanVersion,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const count = z.union([z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe())]);
const positive = z.union([z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe())]);
const clean = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const goal = z.object({ goal_id: uuid, item_order: positive, goal: clean(1_000),
  target_outcome: clean(1_000) }).strict();
const measure = z.object({ measure_id: uuid, item_order: positive, goal_id: uuid,
  measure: clean(2_000), frequency: clean(500), responsible_user_id: uuid,
  responsible_display_name: clean(120),
  qualification_status: z.literal("active_membership_only") }).strict();
const authorizationStatus = z.enum(["current", "outdated", "voided", "period_mismatch"]);
const operationalStatus = z.enum(["signed_current", "not_executable"]);

const version = z.object({ schema_version: z.literal(1), plan_id: uuid, plan_key: uuid,
  version: positive, previous_version_id: uuid.nullable(), status: z.enum(CLIENT_SERVICE_PLAN_STATUSES),
  payload_hash: hash, client_id: uuid, authorized_care_plan_id: uuid,
  authorized_content_hash: hash, authorized_plan_key: uuid, authorized_version: positive,
  authorized_source_system: clean(80), authorized_source_record_id: clean(240).nullable(),
  authorization_status: authorizationStatus, operational_status: operationalStatus,
  effective_from: date, effective_to: date, review_due_on: date,
  responsible_user_id: uuid, responsible_display_name: clean(120).nullable(),
  source_system: clean(80), source_record_id: clean(240).nullable(), source_provenance: z.unknown(),
  goals: z.unknown(), planned_services: z.unknown(),
  content_mapping_status: z.enum(["configured", "needs_mapping"]),
  unmapped_content: z.object({ goals: z.unknown(), planned_services: z.unknown() }).strict().nullable(),
  reason: clean(1_000, 8).nullable(), created_by: uuid, created_by_display_name: clean(120),
  created_at: timestamp, approved_by: uuid.nullable(), approved_by_display_name: clean(120).nullable(),
  approved_at: timestamp.nullable(), signed_by: uuid.nullable(),
  signed_by_display_name: clean(120).nullable(), signed_at: timestamp.nullable(),
  signature_purpose: clean(240).nullable(), reauth_challenge_id: uuid.nullable(),
}).strict();
const plan = version.extend({ client_display_name: clean(120), client_code: clean(160),
  published_plan_id: uuid.nullable(), published_version: positive.nullable(),
  published_payload_hash: hash.nullable(), published_status: z.enum(["signed", "voided"]).nullable(),
  stream_operational_status: operationalStatus,
  history: z.array(version).max(5), history_total: count }).strict();
const client = z.object({ client_id: uuid, display_name: clean(120), client_code: clean(160),
  service_status: z.enum(["active", "suspended", "transferred", "closed", "deceased"]),
  can_manage: z.boolean() }).strict();
const staff = z.object({ user_id: uuid, display_name: clean(120),
  qualification_status: z.literal("active_membership_only") }).strict();
const authorization = z.object({ authorized_care_plan_id: uuid, client_id: uuid,
  plan_key: uuid, version: positive, content_hash: hash, effective_from: date,
  effective_to: date, source_system: clean(80), source_record_id: clean(240).nullable(),
  status: z.literal("current") }).strict();
const source = z.object({ organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  as_of: date, plans: z.array(plan).max(100), matching_total: count,
  plans_truncated: z.boolean(), history_returned_total: count,
  history_maximum: z.literal(500), history_truncated: z.boolean(), plan_total: count,
  draft_total: count, approved_total: count, signed_total: count, voided_total: count,
  review_due_total: count, needs_mapping_total: count, outdated_authorization_total: count,
  executable_total: count, clients: z.array(client).max(200), client_total: count,
  clients_truncated: z.boolean(), staff: z.array(staff).max(200), staff_total: count,
  staff_truncated: z.boolean(), authorizations: z.array(authorization).max(200),
  authorization_total: count, authorizations_truncated: z.boolean(),
  official_qualification_rule_status: z.literal("not_configured"),
  legal_rule_status: z.literal("not_configured"),
  claim_eligibility_status: z.literal("blocked_not_configured"),
  claim_eligibility_reason: z.literal("official_service_codes_rates_and_qualification_rules_not_configured"),
  offline_status: z.literal("not_configured"), export_status: z.literal("not_configured"),
}).strict();

export type ClientServicePlanSnapshotSourceRow = z.input<typeof source>;

function invalid(): never { throw new Error("INVALID_CLIENT_SERVICE_PLAN_SNAPSHOT"); }
function unique(values: readonly string[]) { return new Set(values).size === values.length; }
function ordered(values: readonly number[]) { return [...values].sort((a, b) => a - b)
  .every((value, index) => value === index + 1); }

function canonicalContent(row: z.output<typeof version>): {
  goals: readonly ClientServicePlanGoal[];
  plannedServices: readonly ClientServicePlanMeasure[];
} {
  const goals = z.array(goal).min(1).max(50).safeParse(row.goals);
  const services = z.array(measure).min(1).max(100).safeParse(row.planned_services);
  if (row.content_mapping_status === "needs_mapping") {
    if (row.unmapped_content === null || (goals.success && services.success)) invalid();
    return { goals: [], plannedServices: [] };
  }
  if (!goals.success || !services.success || row.unmapped_content !== null) invalid();
  const goalIds = goals.data.map((item) => item.goal_id);
  if (!unique(goalIds) || !ordered(goals.data.map((item) => item.item_order)) ||
    !unique(services.data.map((item) => item.measure_id)) ||
    !ordered(services.data.map((item) => item.item_order)) ||
    services.data.some((item) => !goalIds.includes(item.goal_id))) invalid();
  return { goals: goals.data.map((item) => ({ goalId: item.goal_id,
    itemOrder: item.item_order, goal: item.goal, targetOutcome: item.target_outcome })),
  plannedServices: services.data.map((item) => ({ measureId: item.measure_id,
    itemOrder: item.item_order, goalId: item.goal_id, measure: item.measure,
    frequency: item.frequency, responsibleUserId: item.responsible_user_id,
    responsibleDisplayName: item.responsible_display_name,
    qualificationStatus: item.qualification_status })) };
}

function normalize(row: z.output<typeof version>): ClientServicePlanVersion {
  const content = canonicalContent(row);
  const signed = row.status === "signed" || row.status === "voided";
  const approved = row.status === "approved" || signed;
  if ((row.version === 1) !== (row.previous_version_id === null) ||
    row.effective_from > row.effective_to || row.review_due_on < row.effective_from ||
    row.review_due_on > row.effective_to ||
    approved !== (row.approved_by !== null && row.approved_by_display_name !== null &&
      row.approved_at !== null) ||
    signed !== (row.signed_by !== null && row.signed_by_display_name !== null &&
      row.signed_at !== null && row.signature_purpose !== null && row.reauth_challenge_id !== null) ||
    (!signed && (row.signed_by !== null || row.signed_by_display_name !== null ||
      row.signed_at !== null || row.signature_purpose !== null)) ||
    (row.operational_status === "signed_current" &&
      (row.status !== "signed" || row.authorization_status !== "current")) ||
    (row.content_mapping_status === "needs_mapping") !== (row.unmapped_content !== null)) invalid();
  return { schemaVersion: 1, planId: row.plan_id, planKey: row.plan_key,
    version: row.version, previousVersionId: row.previous_version_id, status: row.status,
    payloadHash: row.payload_hash, clientId: row.client_id,
    authorizedCarePlanId: row.authorized_care_plan_id,
    authorizedContentHash: row.authorized_content_hash, effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to, reviewDueOn: row.review_due_on,
    responsibleUserId: row.responsible_user_id, sourceSystem: row.source_system,
    sourceRecordId: row.source_record_id, sourceProvenance: row.source_provenance,
    goals: content.goals, plannedServices: content.plannedServices, reason: row.reason,
    contentMappingStatus: row.content_mapping_status,
    unmappedContent: row.unmapped_content === null ? null : {
      goals: row.unmapped_content.goals,
      plannedServices: row.unmapped_content.planned_services,
    },
    authorizedPlanKey: row.authorized_plan_key, authorizedVersion: row.authorized_version,
    authorizedSourceSystem: row.authorized_source_system,
    authorizedSourceRecordId: row.authorized_source_record_id,
    authorizationStatus: row.authorization_status, operationalStatus: row.operational_status,
    responsibleDisplayName: row.responsible_display_name, createdBy: row.created_by,
    createdByDisplayName: row.created_by_display_name, createdAt: row.created_at,
    approvedBy: row.approved_by, approvedByDisplayName: row.approved_by_display_name,
    approvedAt: row.approved_at, signedBy: row.signed_by,
    signedByDisplayName: row.signed_by_display_name, signedAt: row.signed_at,
    signaturePurpose: row.signature_purpose, reauthChallengeId: row.reauth_challenge_id };
}

function matches(plan: z.output<typeof version>, clientName: string, clientCode: string,
  filters: ClientServicePlanFilters) {
  const status = filters.status === "all" || plan.status === filters.status ||
    (filters.status === "needs_mapping" && plan.content_mapping_status === "needs_mapping") ||
    (filters.status === "authorization_outdated" && plan.authorization_status !== "current") ||
    (filters.status === "review_due" && plan.review_due_on <= filters.asOf && plan.status !== "voided");
  const query = filters.query?.toLocaleLowerCase("zh-Hant-TW") ?? null;
  return (!filters.clientId || plan.client_id === filters.clientId) && status && (!query ||
    clientName.toLocaleLowerCase("zh-Hant-TW").includes(query) ||
    clientCode.toLocaleLowerCase("zh-Hant-TW").includes(query) || plan.plan_key.includes(query));
}

export function projectClientServicePlanSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: ClientServicePlanFilters;
  demo: boolean;
}): ClientServicePlanSnapshot {
  const parsed = source.safeParse(input.row);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== input.expectedOrganizationId.toLowerCase() ||
    row.branch_id !== input.expectedBranchId.toLowerCase() || row.as_of !== input.filters.asOf ||
    row.matching_total < row.plans.length ||
    row.plans_truncated !== (row.matching_total > row.plans.length) ||
    (row.plans_truncated && row.plans.length !== 100) || row.plan_total !== row.matching_total ||
    row.history_returned_total > 500 || row.history_truncated !==
      row.plans.some((item) => item.history_total > item.history.length) ||
    row.client_total < row.clients.length || row.clients_truncated !== (row.client_total > row.clients.length) ||
    row.staff_total < row.staff.length || row.staff_truncated !== (row.staff_total > row.staff.length) ||
    row.authorization_total < row.authorizations.length ||
    row.authorizations_truncated !== (row.authorization_total > row.authorizations.length) ||
    !unique(row.plans.map((item) => item.plan_key)) || !unique(row.clients.map((item) => item.client_id)) ||
    !unique(row.staff.map((item) => item.user_id)) ||
    !unique(row.authorizations.map((item) => item.authorized_care_plan_id))) invalid();
  const plans: ClientServicePlan[] = row.plans.map((item) => {
    if (!matches(item, item.client_display_name, item.client_code, input.filters)) invalid();
    const current = normalize(item);
    const history = item.history.map(normalize);
    if (item.history_total < history.length || history.length === 0 ||
      !unique(history.map((entry) => entry.planId)) || history.some((entry, index) =>
        entry.planKey !== current.planKey || entry.clientId !== current.clientId ||
        (index > 0 && (entry.version !== history[index - 1]!.version + 1 ||
          entry.previousVersionId !== history[index - 1]!.planId))) ||
      history.at(-1)?.planId !== current.planId || history.at(-1)?.payloadHash !== current.payloadHash) invalid();
    const publishedFields = [item.published_plan_id, item.published_version,
      item.published_payload_hash, item.published_status];
    if (publishedFields.some((value) => value === null) !==
        publishedFields.every((value) => value === null) ||
      (item.stream_operational_status === "signed_current" && item.published_status !== "signed") ||
      (item.published_plan_id === null && item.stream_operational_status !== "not_executable") ||
      (item.published_plan_id === item.plan_id && (item.published_version !== item.version ||
        item.published_payload_hash !== item.payload_hash || item.published_status !== item.status))) invalid();
    return { ...current, clientDisplayName: item.client_display_name, clientCode: item.client_code,
      publishedPlanId: item.published_plan_id, publishedVersion: item.published_version,
      publishedPayloadHash: item.published_payload_hash, publishedStatus: item.published_status,
      streamOperationalStatus: item.stream_operational_status,
      history, historyTotal: item.history_total, historyTruncated: item.history_total > history.length };
  });
  const visible = {
    draft: plans.filter((item) => item.status === "draft").length,
    approved: plans.filter((item) => item.status === "approved").length,
    signed: plans.filter((item) => item.status === "signed").length,
    voided: plans.filter((item) => item.status === "voided").length,
    review: plans.filter((item) => item.status !== "voided" && item.reviewDueOn <= input.filters.asOf).length,
    mapping: plans.filter((item) => item.contentMappingStatus === "needs_mapping").length,
    outdated: plans.filter((item) => item.authorizationStatus !== "current").length,
    executable: plans.filter((item) => item.streamOperationalStatus === "signed_current").length,
  };
  const totals = [row.draft_total, row.approved_total, row.signed_total, row.voided_total,
    row.review_due_total, row.needs_mapping_total, row.outdated_authorization_total,
    row.executable_total];
  if (row.draft_total + row.approved_total + row.signed_total + row.voided_total !== row.plan_total ||
    (!row.plans_truncated && [visible.draft, visible.approved, visible.signed, visible.voided,
      visible.review, visible.mapping, visible.outdated, visible.executable]
      .some((value, index) => value !== totals[index]))) invalid();
  return { organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at, staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    asOf: row.as_of, filters: input.filters, plans, matchingTotal: row.matching_total,
    plansTruncated: row.plans_truncated, historyReturnedTotal: row.history_returned_total,
    historyMaximum: 500, historyTruncated: row.history_truncated,
    metrics: { planTotal: row.plan_total, draftTotal: row.draft_total,
      approvedTotal: row.approved_total, signedTotal: row.signed_total,
      voidedTotal: row.voided_total, reviewDueTotal: row.review_due_total,
      needsMappingTotal: row.needs_mapping_total,
      outdatedAuthorizationTotal: row.outdated_authorization_total,
      executableTotal: row.executable_total },
    clients: row.clients.map((item) => ({ clientId: item.client_id,
      displayName: item.display_name, clientCode: item.client_code,
      serviceStatus: item.service_status, canManage: item.can_manage })),
    clientTotal: row.client_total, clientsTruncated: row.clients_truncated,
    staff: row.staff.map((item) => ({ userId: item.user_id, displayName: item.display_name,
      qualificationStatus: item.qualification_status })), staffTotal: row.staff_total,
    staffTruncated: row.staff_truncated,
    authorizations: row.authorizations.map((item) => ({ authorizedCarePlanId: item.authorized_care_plan_id,
      clientId: item.client_id, planKey: item.plan_key, version: item.version,
      contentHash: item.content_hash, effectiveFrom: item.effective_from,
      effectiveTo: item.effective_to, sourceSystem: item.source_system,
      sourceRecordId: item.source_record_id, status: item.status })),
    authorizationTotal: row.authorization_total,
    authorizationsTruncated: row.authorizations_truncated,
    officialQualificationRuleStatus: row.official_qualification_rule_status,
    legalRuleStatus: row.legal_rule_status, claimEligibilityStatus: row.claim_eligibility_status,
    claimEligibilityReason: row.claim_eligibility_reason, offlineStatus: row.offline_status,
    exportStatus: row.export_status, demo: input.demo };
}
