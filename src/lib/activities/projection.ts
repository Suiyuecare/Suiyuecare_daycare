import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { ACTIVITY_STATUSES, type ActivityManagementSnapshot } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const positive = count.refine((value) => value > 0);
const single = z.string().trim().min(1).refine((value) => !/[\u0000-\u001F\u007F]/u.test(value));
const narrative = z.string().trim().min(1).refine((value) =>
  !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value),
);

const participant = z.object({
  client_id: uuid,
  display_name: single.max(120),
  client_status: z.string().min(1).max(40),
}).strict();
const scheduleHistory = z.object({
  schedule_version_id: uuid, version: positive,
  previous_schedule_version_id: uuid.nullable(), revision_reason: narrative.max(1000).nullable(),
  starts_at: timestamp, ends_at: timestamp, created_at: timestamp,
  creator_display_name: single.max(120),
}).strict();
const statusHistory = z.object({
  status_event_id: uuid, sequence: positive, previous_status_event_id: uuid.nullable(),
  from_status: z.enum(ACTIVITY_STATUSES).nullable(), to_status: z.enum(ACTIVITY_STATUSES),
  transition_note: narrative.max(1000).nullable(), changer_display_name: single.max(120),
  changed_at: timestamp, reauthenticated: z.boolean(),
}).strict();
const item = z.object({
  activity_id: uuid, schedule_version_id: uuid, schedule_version: positive,
  previous_schedule_version_id: uuid.nullable(), revision_reason: narrative.max(1000).nullable(),
  activity_type: single.max(120), title: single.max(200), search_summary: narrative.max(1000),
  location: single.max(200), starts_at: timestamp, ends_at: timestamp,
  responsible_user_id: uuid, responsible_display_name: single.max(120),
  capacity: z.number().int().min(1).max(500), participants: z.array(participant).max(200),
  participant_count: count, status_event_id: uuid, status_sequence: positive,
  previous_status_event_id: uuid.nullable(), status: z.enum(ACTIVITY_STATUSES),
  cancellation_reason: narrative.max(1000).nullable(), created_at: timestamp,
  schedule_history_total: count, schedule_history: z.array(scheduleHistory).max(50),
  status_history_total: count, status_history: z.array(statusHistory).max(50),
}).strict();
const source = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  items: z.array(item).max(200), matching_total: count, items_truncated: z.boolean(),
  upcoming_total: count, scheduled_total: count, in_progress_total: count,
  completed_total: count, cancelled_total: count,
  staff_options: z.array(z.object({
    user_id: uuid, display_name: single.max(120), employee_code: z.string().max(80).nullable(),
    membership_scope: z.enum(["branch", "organization"]),
  }).strict()).max(200), staff_total: count, staff_truncated: z.boolean(),
  client_options: z.array(z.object({
    client_id: uuid, display_name: single.max(120), client_code: z.string().min(1).max(120),
  }).strict()).max(200), client_total: count, client_truncated: z.boolean(),
  type_options: z.array(single.max(120)).max(200), type_total: count, type_truncated: z.boolean(),
  past_change_policy_status: z.literal("not_configured"),
  cancellation_notification_policy: z.literal("institution_owned_not_configured"),
  notification_delivery: z.literal("none_not_sent"),
}).strict();

export type ActivitySnapshotSourceRow = z.input<typeof source>;

function invalid(): never { throw new Error("INVALID_ACTIVITY_PROJECTION"); }
function unique(values: readonly string[]) { return new Set(values).size === values.length; }

export function projectActivityManagementSnapshot(input: {
  row: unknown; expectedOrganizationId: string; expectedBranchId: string; demo: boolean;
}): ActivityManagementSnapshot {
  const parsed = source.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data) invalid();
  if (!unique(row.items.map((value) => value.activity_id)) ||
      !unique(row.staff_options.map((value) => value.user_id)) ||
      !unique(row.client_options.map((value) => value.client_id)) ||
      !unique(row.type_options) || row.matching_total < row.items.length ||
      row.items_truncated !== (row.matching_total > row.items.length) ||
      row.staff_truncated !== (row.staff_total > row.staff_options.length) ||
      row.client_truncated !== (row.client_total > row.client_options.length) ||
      row.type_truncated !== (row.type_total > row.type_options.length) ||
      row.scheduled_total + row.in_progress_total + row.completed_total + row.cancelled_total !== row.matching_total ||
      row.upcoming_total > row.scheduled_total + row.in_progress_total) invalid();

  const items = row.items.map((value) => {
    if (value.ends_at <= value.starts_at || value.participant_count !== value.participants.length ||
        value.participants.length > value.capacity || !unique(value.participants.map((p) => p.client_id)) ||
        value.schedule_history_total < value.schedule_history.length ||
        value.status_history_total < value.status_history.length ||
        value.schedule_history[0]?.schedule_version_id !== value.schedule_version_id ||
        value.status_history[0]?.status_event_id !== value.status_event_id ||
        value.status_history[0]?.to_status !== value.status ||
        (value.status === "cancelled") !== (value.cancellation_reason !== null) ||
        value.schedule_history.some((entry, index, all) => index > 0 && entry.version >= all[index - 1]!.version) ||
        value.status_history.some((entry, index, all) => index > 0 && entry.sequence >= all[index - 1]!.sequence)) invalid();
    return {
      activityId: value.activity_id, scheduleVersionId: value.schedule_version_id,
      scheduleVersion: value.schedule_version, previousScheduleVersionId: value.previous_schedule_version_id,
      revisionReason: value.revision_reason, activityType: value.activity_type, title: value.title,
      searchSummary: value.search_summary, location: value.location, startsAt: value.starts_at,
      endsAt: value.ends_at, responsibleUserId: value.responsible_user_id,
      responsibleDisplayName: value.responsible_display_name, capacity: value.capacity,
      participants: value.participants.map((p) => ({ clientId: p.client_id, displayName: p.display_name, clientStatus: p.client_status })),
      participantCount: value.participant_count, statusEventId: value.status_event_id,
      statusSequence: value.status_sequence, previousStatusEventId: value.previous_status_event_id,
      status: value.status, cancellationReason: value.cancellation_reason, createdAt: value.created_at,
      scheduleHistoryTotal: value.schedule_history_total,
      scheduleHistory: value.schedule_history.map((entry) => ({
        scheduleVersionId: entry.schedule_version_id, version: entry.version,
        previousScheduleVersionId: entry.previous_schedule_version_id, revisionReason: entry.revision_reason,
        startsAt: entry.starts_at, endsAt: entry.ends_at, createdAt: entry.created_at,
        creatorDisplayName: entry.creator_display_name,
      })),
      statusHistoryTotal: value.status_history_total,
      statusHistory: value.status_history.map((entry) => ({
        statusEventId: entry.status_event_id, sequence: entry.sequence,
        previousStatusEventId: entry.previous_status_event_id, fromStatus: entry.from_status,
        toStatus: entry.to_status, transitionNote: entry.transition_note,
        changerDisplayName: entry.changer_display_name, changedAt: entry.changed_at,
        reauthenticated: entry.reauthenticated,
      })),
    };
  });
  if (!row.items_truncated && (
    items.filter((value) => value.status === "scheduled").length !== row.scheduled_total ||
    items.filter((value) => value.status === "in_progress").length !== row.in_progress_total ||
    items.filter((value) => value.status === "completed").length !== row.completed_total ||
    items.filter((value) => value.status === "cancelled").length !== row.cancelled_total
  )) invalid();
  return {
    organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    items, matchingTotal: row.matching_total, itemsTruncated: row.items_truncated,
    metrics: { upcoming: row.upcoming_total, scheduled: row.scheduled_total,
      inProgress: row.in_progress_total, completed: row.completed_total, cancelled: row.cancelled_total },
    staffOptions: row.staff_options.map((value) => ({ userId: value.user_id, displayName: value.display_name, employeeCode: value.employee_code, membershipScope: value.membership_scope })),
    staffTotal: row.staff_total, staffTruncated: row.staff_truncated,
    clientOptions: row.client_options.map((value) => ({ clientId: value.client_id, displayName: value.display_name, clientCode: value.client_code })),
    clientTotal: row.client_total, clientTruncated: row.client_truncated,
    typeOptions: row.type_options, typeTotal: row.type_total, typeTruncated: row.type_truncated,
    pastChangePolicyStatus: row.past_change_policy_status,
    cancellationNotificationPolicy: row.cancellation_notification_policy,
    notificationDelivery: row.notification_delivery, demo: input.demo,
  };
}
