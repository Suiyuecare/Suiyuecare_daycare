import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  ABNORMAL_AFFECTED_TARGET_KINDS,
  ABNORMAL_DUE_DATE_ACTIONS,
  ABNORMAL_HANDLING_STATUSES,
  ABNORMAL_MAJOR_STATES,
  ABNORMAL_TIMELINE_ENTRY_TYPES,
  type AbnormalEventSnapshot,
  type AbnormalIncidentItem,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const safeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrativeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const positive = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe()),
]);

const timelineSchema = z.object({
  entry_id: uuid,
  sequence_number: positive,
  entry_type: z.enum(ABNORMAL_TIMELINE_ENTRY_TYPES),
  occurred_at: timestamp,
  entry_text: narrativeText(2000).nullable(),
  notification_target: safeText(240).nullable(),
  notification_method: safeText(120).nullable(),
  notification_result: narrativeText(1000).nullable(),
  responsible_membership_id: uuid.nullable(),
  responsible_user_id: uuid.nullable(),
  responsible_display_name: safeText(120).nullable(),
  due_date_action: z.enum(ABNORMAL_DUE_DATE_ACTIONS).nullable(),
  due_date_value: calendarDate.nullable(),
  effective_due_date: calendarDate,
  closure_outcome: narrativeText(2000).nullable(),
  closure_reason: narrativeText(1000).nullable(),
  committer_display_name: safeText(120),
  committed_at: timestamp,
}).strict();

const itemSchema = z.object({
  incident_id: uuid,
  affected_target_kind: z.enum(ABNORMAL_AFFECTED_TARGET_KINDS),
  affected_client_id: uuid.nullable(),
  affected_target_label: safeText(240),
  occurred_at: timestamp,
  reported_at: timestamp,
  location: safeText(240),
  event_type: safeText(240),
  event_summary: narrativeText(2000),
  immediate_action: narrativeText(2000),
  major_state: z.enum(ABNORMAL_MAJOR_STATES),
  late_entry_reason: narrativeText(1000).nullable(),
  initial_responsible_membership_id: uuid,
  initial_responsible_user_id: uuid,
  initial_responsible_display_name: safeText(120),
  current_responsible_membership_id: uuid,
  current_responsible_user_id: uuid,
  current_responsible_display_name: safeText(120),
  initial_improvement_due_date: calendarDate,
  current_improvement_due_date: calendarDate,
  reporter_display_name: safeText(120),
  handling_status: z.enum(ABNORMAL_HANDLING_STATUSES),
  chain_version: count,
  last_activity_at: timestamp,
  timeline_total: count,
  timeline_truncated: z.boolean(),
  timeline: z.array(timelineSchema).max(100),
}).strict();

const clientOptionSchema = z.object({
  client_id: uuid,
  display_name: safeText(120),
  client_status: z.enum(["active", "suspended", "transferred", "closed", "deceased"]),
  admitted_on: calendarDate.nullable(),
  ended_on: calendarDate.nullable(),
  can_report: z.boolean(),
}).strict();
const responsibleOptionSchema = z.object({
  membership_id: uuid,
  user_id: uuid,
  display_name: safeText(120),
  membership_scope: z.enum(["organization", "branch"]),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  items: z.array(itemSchema).max(200),
  item_total: count,
  matching_total: count,
  major_total: count,
  awaiting_improvement_total: count,
  overdue_total: count,
  closed_total: count,
  items_truncated: z.boolean(),
  client_options: z.array(clientOptionSchema).max(200),
  client_options_available_total: count,
  client_options_truncated: z.boolean(),
  responsible_options: z.array(responsibleOptionSchema).max(200),
  responsible_options_available_total: count,
  responsible_options_truncated: z.boolean(),
  event_type_options: z.array(safeText(240)).max(200),
  event_type_options_available_total: count,
  event_type_options_truncated: z.boolean(),
  event_taxonomy_status: z.literal("not_configured"),
  major_criteria_status: z.literal("not_configured"),
  legal_reporting_status: z.literal("not_configured"),
  delivery_integration_status: z.literal("not_implemented"),
}).strict();

export type AbnormalEventSnapshotSourceRow = z.input<typeof sourceSchema>;
function invalid(): never { throw new Error("INVALID_ABNORMAL_EVENT_PROJECTION"); }
function unique(values: readonly string[]) { return new Set(values).size === values.length; }
function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function normalizeItem(row: z.output<typeof itemSchema>): AbnormalIncidentItem {
  const occurred = new Date(row.occurred_at).getTime();
  const reported = new Date(row.reported_at).getTime();
  const late = reported - occurred > 24 * 60 * 60 * 1000;
  if (
    reported < occurred ||
    (row.affected_target_kind === "client") !== (row.affected_client_id !== null) ||
    late !== (row.late_entry_reason !== null) ||
    row.initial_improvement_due_date < taipeiDate(row.occurred_at) ||
    row.chain_version !== row.timeline_total ||
    row.timeline_truncated !== (row.timeline_total > row.timeline.length) ||
    (!row.timeline_truncated && row.timeline_total !== row.timeline.length) ||
    (row.timeline_truncated && row.timeline.length !== 100) ||
    !unique(row.timeline.map((entry) => entry.entry_id))
  ) invalid();

  let priorSequence = row.timeline.length ? row.timeline[0]!.sequence_number - 1 : 0;
  let priorTime = row.timeline_truncated ? Number.NEGATIVE_INFINITY : occurred;
  let responsibleKnown = !row.timeline_truncated;
  let currentResponsibleMembershipId = row.initial_responsible_membership_id;
  let currentResponsibleUserId = row.initial_responsible_user_id;
  let currentResponsibleDisplayName = row.initial_responsible_display_name;
  let dueKnown = !row.timeline_truncated;
  let currentDueDate = row.initial_improvement_due_date;

  for (const entry of row.timeline) {
    const entryTime = new Date(entry.occurred_at).getTime();
    const improvement = entry.entry_type === "improvement" || entry.entry_type === "follow_up";
    const notification = entry.entry_type === "manual_notification";
    const closure = entry.entry_type === "closure";
    const responsibilityAligned = improvement
      ? entry.responsible_membership_id !== null && entry.responsible_user_id !== null &&
        entry.responsible_display_name !== null && entry.due_date_action !== null &&
        ((entry.due_date_action === "replace") === (entry.due_date_value !== null))
      : entry.responsible_membership_id === null && entry.responsible_user_id === null &&
        entry.responsible_display_name === null && entry.due_date_action === null && entry.due_date_value === null;
    const contentAligned = notification
      ? entry.entry_text === null && entry.notification_target !== null && entry.notification_method !== null &&
        entry.notification_result !== null && entry.closure_outcome === null && entry.closure_reason === null
      : improvement
        ? entry.entry_text !== null && entry.notification_target === null && entry.notification_method === null &&
          entry.notification_result === null && entry.closure_outcome === null && entry.closure_reason === null
        : closure && entry.entry_text === null && entry.notification_target === null &&
          entry.notification_method === null && entry.notification_result === null &&
          entry.closure_outcome !== null && entry.closure_reason !== null;
    if (
      entry.sequence_number !== priorSequence + 1 || entryTime < priorTime ||
      new Date(entry.committed_at).getTime() < entryTime || !responsibilityAligned || !contentAligned
    ) invalid();

    if (improvement) {
      currentResponsibleMembershipId = entry.responsible_membership_id!;
      currentResponsibleUserId = entry.responsible_user_id!;
      currentResponsibleDisplayName = entry.responsible_display_name!;
      responsibleKnown = true;
      if (entry.due_date_action === "replace") currentDueDate = entry.due_date_value!;
    }
    if (dueKnown) {
      if (entry.effective_due_date !== currentDueDate) invalid();
    } else {
      currentDueDate = entry.effective_due_date;
      dueKnown = true;
    }
    if (entry.effective_due_date < taipeiDate(row.occurred_at)) invalid();
    priorSequence = entry.sequence_number;
    priorTime = entryTime;
  }

  const last = row.timeline.at(-1);
  const expectedStatus = row.chain_version === 0 ? "reported"
    : last?.entry_type === "closure" ? "closed" : "in_progress";
  if (
    row.handling_status !== expectedStatus ||
    (row.chain_version > 0 && last?.sequence_number !== row.chain_version) ||
    (row.chain_version === 0 ? row.last_activity_at !== row.reported_at : last?.committed_at !== row.last_activity_at) ||
    (responsibleKnown && (
      currentResponsibleMembershipId !== row.current_responsible_membership_id ||
      currentResponsibleUserId !== row.current_responsible_user_id ||
      currentResponsibleDisplayName !== row.current_responsible_display_name
    )) ||
    (dueKnown && currentDueDate !== row.current_improvement_due_date)
  ) invalid();

  return {
    id: row.incident_id,
    affectedTargetKind: row.affected_target_kind,
    affectedClientId: row.affected_client_id,
    affectedTargetLabel: row.affected_target_label,
    occurredAt: row.occurred_at,
    reportedAt: row.reported_at,
    location: row.location,
    eventType: row.event_type,
    eventSummary: row.event_summary,
    immediateAction: row.immediate_action,
    majorState: row.major_state,
    lateEntryReason: row.late_entry_reason,
    initialResponsibleMembershipId: row.initial_responsible_membership_id,
    initialResponsibleUserId: row.initial_responsible_user_id,
    initialResponsibleDisplayName: row.initial_responsible_display_name,
    currentResponsibleMembershipId: row.current_responsible_membership_id,
    currentResponsibleUserId: row.current_responsible_user_id,
    currentResponsibleDisplayName: row.current_responsible_display_name,
    initialImprovementDueDate: row.initial_improvement_due_date,
    currentImprovementDueDate: row.current_improvement_due_date,
    reporterDisplayName: row.reporter_display_name,
    handlingStatus: row.handling_status,
    chainVersion: row.chain_version,
    lastActivityAt: row.last_activity_at,
    timelineTotal: row.timeline_total,
    timelineTruncated: row.timeline_truncated,
    timeline: row.timeline.map((entry) => ({
      id: entry.entry_id,
      sequenceNumber: entry.sequence_number,
      entryType: entry.entry_type,
      occurredAt: entry.occurred_at,
      entryText: entry.entry_text,
      notificationTarget: entry.notification_target,
      notificationMethod: entry.notification_method,
      notificationResult: entry.notification_result,
      responsibleMembershipId: entry.responsible_membership_id,
      responsibleUserId: entry.responsible_user_id,
      responsibleDisplayName: entry.responsible_display_name,
      dueDateAction: entry.due_date_action,
      dueDateValue: entry.due_date_value,
      effectiveDueDate: entry.effective_due_date,
      closureOutcome: entry.closure_outcome,
      closureReason: entry.closure_reason,
      committerDisplayName: entry.committer_display_name,
      committedAt: entry.committed_at,
    })),
  };
}

export function projectAbnormalEventSnapshot(input: {
  row: unknown; expectedOrganizationId: string; expectedBranchId: string; demo: boolean;
}): AbnormalEventSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data) invalid();
  const items = row.items.map(normalizeItem);
  const generatedDate = taipeiDate(row.generated_at);
  if (
    !unique(items.map((item) => item.id)) ||
    !unique(row.client_options.map((option) => option.client_id)) ||
    !unique(row.responsible_options.map((option) => option.membership_id)) ||
    !unique(row.event_type_options) ||
    row.client_options.some((option) => option.can_report !== (
      option.client_status === "active" && option.admitted_on !== null &&
      option.admitted_on <= generatedDate &&
      (option.ended_on === null || option.ended_on >= generatedDate)
    )) ||
    row.item_total !== items.length || row.matching_total < row.item_total ||
    row.items_truncated !== (row.matching_total > row.item_total) ||
    row.client_options_available_total < row.client_options.length ||
    row.responsible_options_available_total < row.responsible_options.length ||
    row.event_type_options_available_total < row.event_type_options.length ||
    row.client_options_truncated !== (row.client_options_available_total > row.client_options.length) ||
    row.responsible_options_truncated !== (row.responsible_options_available_total > row.responsible_options.length) ||
    row.event_type_options_truncated !== (row.event_type_options_available_total > row.event_type_options.length) ||
    row.major_total > row.matching_total || row.overdue_total > row.awaiting_improvement_total ||
    row.awaiting_improvement_total + row.closed_total !== row.matching_total ||
    (!row.items_truncated && (
      items.filter((item) => item.majorState === "major").length !== row.major_total ||
      items.filter((item) => item.handlingStatus !== "closed").length !== row.awaiting_improvement_total ||
      items.filter((item) => item.handlingStatus !== "closed" && item.currentImprovementDueDate < generatedDate).length !== row.overdue_total ||
      items.filter((item) => item.handlingStatus === "closed").length !== row.closed_total
    ))
  ) invalid();

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(new Date(row.generated_at).getTime() + 60_000).toISOString(),
    items,
    itemTotal: row.item_total,
    matchingTotal: row.matching_total,
    metrics: {
      major: row.major_total,
      awaitingImprovement: row.awaiting_improvement_total,
      overdue: row.overdue_total,
      closed: row.closed_total,
    },
    itemsTruncated: row.items_truncated,
    clientOptions: row.client_options.map((option) => ({
      clientId: option.client_id,
      displayName: option.display_name,
      clientStatus: option.client_status,
      admittedOn: option.admitted_on,
      endedOn: option.ended_on,
      canReport: option.can_report,
    })),
    clientOptionsAvailableTotal: row.client_options_available_total,
    clientOptionsTruncated: row.client_options_truncated,
    responsibleOptions: row.responsible_options.map((option) => ({
      membershipId: option.membership_id,
      userId: option.user_id,
      displayName: option.display_name,
      scope: option.membership_scope,
    })),
    responsibleOptionsAvailableTotal: row.responsible_options_available_total,
    responsibleOptionsTruncated: row.responsible_options_truncated,
    eventTypeOptions: row.event_type_options,
    eventTypeOptionsAvailableTotal: row.event_type_options_available_total,
    eventTypeOptionsTruncated: row.event_type_options_truncated,
    eventTaxonomyStatus: row.event_taxonomy_status,
    majorCriteriaStatus: row.major_criteria_status,
    legalReportingStatus: row.legal_reporting_status,
    deliveryIntegrationStatus: row.delivery_integration_status,
    demo: input.demo,
  };
}
