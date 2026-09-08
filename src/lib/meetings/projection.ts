import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  MEETING_ACTION_STATUSES,
  type MeetingFilters,
  type MeetingManagementSnapshot,
  type MeetingMinute,
} from "./types";
import { isMeetingCalendarDate } from "./date";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
  "timestamp",
).transform((value) => new Date(value).toISOString());
const date = z.string().refine(isMeetingCalendarDate, "date");
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const positive = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe()),
]);
const cleanText = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));

const staffOptionSchema = z.object({
  user_id: uuid,
  display_name: cleanText(120),
  employee_code: z.string().trim().max(120).nullable(),
  profile_kind: z.enum(["staff", "professional", "driver", "finance"]),
  membership_scope: z.enum(["branch", "organization"]),
}).strict();

const staffAttendeeSchema = z.object({
  attendee_kind: z.literal("staff"),
  user_id: uuid,
  display_name: cleanText(120),
  profile_kind: z.enum(["staff", "professional", "driver", "finance"]),
  membership_scope: z.enum(["branch", "organization"]),
}).strict();
const externalAttendeeSchema = z.object({
  attendee_kind: z.literal("external"),
  name: cleanText(120),
}).strict();
const agendaSchema = z.object({
  item_id: uuid,
  item_order: positive,
  topic: cleanText(1_000, true),
}).strict();
const decisionSchema = z.object({
  decision_id: uuid,
  item_order: positive,
  decision: cleanText(2_000, true),
}).strict();
const actionSchema = z.object({
  action_id: uuid,
  item_order: positive,
  action: cleanText(2_000, true),
  responsible_user_id: uuid,
  responsible_display_name: cleanText(120),
  due_date: date,
  progress_status: z.enum(MEETING_ACTION_STATUSES),
  latest_update_id: uuid.nullable(),
  update_sequence: count,
  progress_note: cleanText(1_000, true).nullable(),
  progress_recorded_at: timestamp.nullable(),
  is_overdue: z.boolean(),
  local_work_item: z.boolean(),
  external_notification_sent: z.literal(false),
}).strict();
const meetingSchema = z.object({
  minute_version_id: uuid,
  meeting_key: uuid,
  minute_version: positive,
  previous_version_id: uuid.nullable(),
  correction_reason: cleanText(1_000).nullable(),
  meeting_type: cleanText(120),
  title: cleanText(200),
  starts_at: timestamp,
  ends_at: timestamp,
  staff_attendees: z.array(staffAttendeeSchema).min(1).max(100),
  external_attendees: z.array(externalAttendeeSchema).max(50),
  agenda_items: z.array(agendaSchema).min(1).max(50),
  decisions: z.array(decisionSchema).max(50),
  action_items: z.array(actionSchema).max(50),
  signed_at: timestamp,
  signer_display_name: cleanText(120),
  signer_role_keys: z.array(cleanText(120)).min(1).max(50),
  signature_purpose: z.literal("會議紀錄簽署"),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  snapshot_date: date,
  staff_options: z.array(staffOptionSchema).max(500),
  staff_total: count,
  staff_truncated: z.boolean(),
  meetings: z.array(meetingSchema).max(100),
  meeting_total: count,
  meeting_available_total: count,
  meetings_truncated: z.boolean(),
  correction_total: count,
  action_total: count,
  open_action_total: count,
  overdue_action_total: count,
  meeting_type_policy: z.literal("institution_owned_unconfigured"),
  retention_policy: z.literal("institution_owned_unconfigured"),
  escalation_policy: z.literal("institution_owned_unconfigured"),
  notification_delivery: z.literal("none_not_sent"),
}).strict();

export type MeetingSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_MEETING_MANAGEMENT_PROJECTION");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function taipeiDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function orderedItems<T extends { item_order: number }>(items: readonly T[]) {
  return items.every((item, index) => item.item_order === index + 1);
}

function projectMeeting(
  row: z.output<typeof meetingSchema>,
  snapshotDate: string,
  generatedAt: string,
): MeetingMinute {
  if (
    Date.parse(row.ends_at) <= Date.parse(row.starts_at) ||
    Date.parse(row.signed_at) < Date.parse(row.ends_at) ||
    Date.parse(row.signed_at) > Date.parse(generatedAt) ||
    (row.minute_version === 1) !== (row.previous_version_id === null) ||
    (row.minute_version === 1) !== (row.correction_reason === null) ||
    !unique(row.staff_attendees.map((item) => item.user_id)) ||
    !unique(row.external_attendees.map((item) => item.name.toLocaleLowerCase("zh-TW"))) ||
    !unique(row.agenda_items.map((item) => item.item_id)) ||
    !unique(row.decisions.map((item) => item.decision_id)) ||
    !unique(row.action_items.map((item) => item.action_id)) ||
    !unique(row.signer_role_keys) ||
    [...row.signer_role_keys].sort().some((value, index) => value !== row.signer_role_keys[index]) ||
    !orderedItems(row.agenda_items) || !orderedItems(row.decisions) ||
    !orderedItems(row.action_items)
  ) invalid();

  const actionItems = row.action_items.map((item) => {
    const expectedOverdue = item.due_date < snapshotDate &&
      !["completed", "cancelled"].includes(item.progress_status);
    const hasUpdate = item.latest_update_id !== null;
    if (
      item.is_overdue !== expectedOverdue || item.local_work_item !== expectedOverdue ||
      hasUpdate !== (item.update_sequence > 0) ||
      hasUpdate !== (item.progress_recorded_at !== null) ||
      (item.progress_recorded_at !== null && (
        Date.parse(item.progress_recorded_at) < Date.parse(row.signed_at) ||
        Date.parse(item.progress_recorded_at) > Date.parse(generatedAt)
      )) ||
      (!hasUpdate && (
        item.progress_status !== "not_started" || item.progress_note !== null
      ))
    ) invalid();
    return {
      actionId: item.action_id, itemOrder: item.item_order, action: item.action,
      responsibleUserId: item.responsible_user_id,
      responsibleDisplayName: item.responsible_display_name,
      dueDate: item.due_date, progressStatus: item.progress_status,
      latestUpdateId: item.latest_update_id, updateSequence: item.update_sequence,
      progressNote: item.progress_note, progressRecordedAt: item.progress_recorded_at,
      isOverdue: item.is_overdue, localWorkItem: item.local_work_item,
      externalNotificationSent: false as const,
    };
  });

  return {
    minuteVersionId: row.minute_version_id, meetingKey: row.meeting_key,
    minuteVersion: row.minute_version, previousVersionId: row.previous_version_id,
    correctionReason: row.correction_reason, meetingType: row.meeting_type,
    title: row.title, startsAt: row.starts_at, endsAt: row.ends_at,
    staffAttendees: row.staff_attendees.map((item) => ({
      attendeeKind: "staff", userId: item.user_id, displayName: item.display_name,
      profileKind: item.profile_kind, membershipScope: item.membership_scope,
    })),
    externalAttendees: row.external_attendees.map((item) => ({
      attendeeKind: "external", name: item.name,
    })),
    agendaItems: row.agenda_items.map((item) => ({
      itemId: item.item_id, itemOrder: item.item_order, topic: item.topic,
    })),
    decisions: row.decisions.map((item) => ({
      decisionId: item.decision_id, itemOrder: item.item_order,
      decision: item.decision,
    })),
    actionItems, signedAt: row.signed_at, signerDisplayName: row.signer_display_name,
    signerRoleKeys: row.signer_role_keys, signaturePurpose: row.signature_purpose,
  };
}

export function projectMeetingManagementSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): MeetingManagementSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const expectedOrganization = uuid.safeParse(input.expectedOrganizationId);
  const expectedBranch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !expectedOrganization.success || !expectedBranch.success) invalid();
  const row = parsed.data;
  const meetings = row.meetings.map((item) =>
    projectMeeting(item, row.snapshot_date, row.generated_at));
  const loadedActions = meetings.flatMap((meeting) => meeting.actionItems);
  const loadedCorrections = meetings.filter((meeting) => meeting.minuteVersion > 1).length;
  const loadedOpen = loadedActions.filter((action) =>
    !["completed", "cancelled"].includes(action.progressStatus)).length;
  const loadedOverdue = loadedActions.filter((action) => action.isOverdue).length;
  if (
    row.organization_id !== expectedOrganization.data ||
    row.branch_id !== expectedBranch.data ||
    row.snapshot_date !== taipeiDate(row.generated_at) ||
    row.staff_total < row.staff_options.length ||
    row.staff_truncated !== (row.staff_total > row.staff_options.length) ||
    row.meeting_total !== meetings.length ||
    row.meeting_available_total < meetings.length ||
    row.meetings_truncated !== (row.meeting_available_total > meetings.length) ||
    !unique(row.staff_options.map((item) => item.user_id)) ||
    !unique(meetings.map((item) => item.minuteVersionId)) ||
    !unique(meetings.map((item) => item.meetingKey)) ||
    meetings.some((meeting, index) => index > 0 &&
      Date.parse(meeting.startsAt) > Date.parse(meetings[index - 1]!.startsAt)) ||
    row.correction_total < loadedCorrections ||
    row.action_total < loadedActions.length ||
    row.open_action_total < loadedOpen ||
    row.overdue_action_total < loadedOverdue ||
    row.open_action_total > row.action_total ||
    row.overdue_action_total > row.open_action_total ||
    (!row.meetings_truncated && (
      row.correction_total !== loadedCorrections ||
      row.action_total !== loadedActions.length ||
      row.open_action_total !== loadedOpen ||
      row.overdue_action_total !== loadedOverdue
    ))
  ) invalid();

  return {
    organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at, snapshotDate: row.snapshot_date,
    staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    staffOptions: row.staff_options.map((item) => ({
      userId: item.user_id, displayName: item.display_name,
      employeeCode: item.employee_code, profileKind: item.profile_kind,
      membershipScope: item.membership_scope,
    })),
    staffTotal: row.staff_total, staffTruncated: row.staff_truncated,
    meetings, meetingTotal: row.meeting_total,
    meetingAvailableTotal: row.meeting_available_total,
    meetingsTruncated: row.meetings_truncated,
    correctionTotal: row.correction_total, actionTotal: row.action_total,
    openActionTotal: row.open_action_total,
    overdueActionTotal: row.overdue_action_total,
    meetingTypePolicy: row.meeting_type_policy,
    retentionPolicy: row.retention_policy,
    escalationPolicy: row.escalation_policy,
    notificationDelivery: row.notification_delivery,
    demo: input.demo,
  };
}

export function filterMeetingManagementSnapshot(
  snapshot: MeetingManagementSnapshot,
  filters: MeetingFilters,
) {
  if (filters.date !== null && !isMeetingCalendarDate(filters.date)) invalid();
  const query = filters.query.trim().toLocaleLowerCase("zh-TW");
  const meetings = snapshot.meetings.filter((meeting) => {
    const matchesStatus = filters.status === "all" ||
      (filters.status === "open" && meeting.actionItems.some((action) =>
        !["completed", "cancelled"].includes(action.progressStatus))) ||
      (filters.status === "overdue" && meeting.actionItems.some((action) => action.isOverdue)) ||
      (filters.status === "completed" && meeting.actionItems.some((action) =>
        action.progressStatus === "completed")) ||
      (filters.status === "cancelled" && meeting.actionItems.some((action) =>
        action.progressStatus === "cancelled"));
    return matchesStatus &&
      (filters.meetingType === "all" || meeting.meetingType === filters.meetingType) &&
      (filters.date === null || taipeiDate(meeting.startsAt) === filters.date) &&
      (!query || `${meeting.title} ${meeting.meetingType} ${meeting.signerDisplayName} ${meeting.agendaItems.map((item) => item.topic).join(" ")}`
        .toLocaleLowerCase("zh-TW").includes(query));
  });
  return { ...snapshot, meetings };
}
