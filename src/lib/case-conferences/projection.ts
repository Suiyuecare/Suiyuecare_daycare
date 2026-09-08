import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  CASE_CONFERENCE_ACTION_STATUSES,
  CASE_CONFERENCE_ATTENDANCE_STATUSES,
  CASE_CONFERENCE_DEADLINE_STATES,
  CASE_CONFERENCE_STATUSES,
  CASE_CONFERENCE_VERSION_KINDS,
  type CaseConferenceActionItem,
  type CaseConferenceHistoryEntry,
  type CaseConferenceItem,
  type CaseConferenceSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const positive = count.pipe(z.number().int().positive().max(10_000));
const text = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrative = (max: number) => z.string().trim().min(2).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const calendarDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const roleKeys = z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/u)).min(1).max(50);
const attendee = z.object({
  user_id: uuid,
  membership_id: uuid,
  display_name: text(120),
  role_keys: roleKeys,
  attendance_status: z.enum(CASE_CONFERENCE_ATTENDANCE_STATUSES),
}).strict();
const actionItem = z.object({
  action_id: uuid,
  item_order: positive.pipe(z.number().max(50)),
  action_text: narrative(2_000),
  responsible_user_id: uuid,
  responsible_membership_id: uuid,
  responsible_display_name: text(120),
  deadline_state: z.enum(CASE_CONFERENCE_DEADLINE_STATES),
  due_date: calendarDate.nullable(),
  action_status: z.enum(CASE_CONFERENCE_ACTION_STATUSES),
  is_overdue: z.boolean(),
}).strict();
const history = z.object({
  version_id: uuid,
  version: positive,
  previous_version_id: uuid.nullable(),
  corrects_version_id: uuid.nullable(),
  version_kind: z.enum(CASE_CONFERENCE_VERSION_KINDS),
  status: z.enum(CASE_CONFERENCE_STATUSES),
  meeting_starts_at: timestamp,
  meeting_ends_at: timestamp,
  problem_statement: narrative(4_000),
  decision_summary: narrative(4_000),
  attendees: z.array(attendee).min(1).max(50),
  action_items: z.array(actionItem).min(1).max(50),
  correction_reason: narrative(1_000).nullable(),
  occurred_at: timestamp,
  author_display_name: text(120),
  signed_at: timestamp.nullable(),
  signer_display_name: text(120).nullable(),
  signer_role_keys: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/u)).max(50),
  signature_purpose: z.literal("個案研討會議紀錄簽署").nullable(),
  content_hash: hash,
}).strict();
const item = history.extend({
  meeting_key: uuid,
  client_id: uuid,
  client_display_name: text(120),
  client_code: text(80),
  history: z.array(history).min(1).max(10_000),
}).strict();
const source = z.object({
  organization_id: uuid,
  organization_name: text(160),
  branch_id: uuid,
  branch_name: text(160),
  generated_at: timestamp,
  snapshot_date: calendarDate,
  snapshot_token: hash,
  items: z.array(item).max(200),
  matching_total: count,
  draft_total: count,
  signed_total: count,
  corrected_total: count,
  action_total: count,
  open_action_total: count,
  overdue_action_total: count,
  deadline_missing_total: count,
  deadline_not_applicable_total: count,
  items_truncated: z.boolean(),
  client_options: z.array(z.object({
    client_id: uuid, display_name: text(120), client_code: text(80),
  }).strict()).max(200),
  staff_options: z.array(z.object({
    user_id: uuid, display_name: text(120), role_keys: roleKeys,
  }).strict()).max(500),
  can_manage: z.boolean(),
  can_sign: z.boolean(),
  can_correct: z.boolean(),
  attachment_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"),
  notification_status: z.literal("not_configured"),
  external_delivery_status: z.literal("not_configured"),
  delivery_claim: z.literal("no_external_delivery_claim"),
  offline_status: z.literal("not_configured"),
}).strict();

export type CaseConferenceSnapshotSource = z.input<typeof source>;

function invalid(): never {
  throw new Error("INVALID_CASE_CONFERENCE_SNAPSHOT");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function taipeiDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function projectActions(
  values: readonly z.output<typeof actionItem>[], snapshotDate: string,
  meetingStartsAt: string,
): CaseConferenceActionItem[] {
  if (!unique(values.map((value) => value.action_id)) ||
      values.some((value, index) => value.item_order !== index + 1)) invalid();
  return values.map((value) => {
    const expectedOverdue = value.deadline_state === "dated" &&
      value.due_date !== null && value.due_date < snapshotDate && value.action_status === "open";
    if ((value.deadline_state === "dated") !== (value.due_date !== null) ||
        (value.due_date !== null && value.due_date < taipeiDate(meetingStartsAt)) ||
        value.is_overdue !== expectedOverdue) invalid();
    return {
      actionId: value.action_id,
      itemOrder: value.item_order,
      actionText: value.action_text,
      responsibleUserId: value.responsible_user_id,
      responsibleMembershipId: value.responsible_membership_id,
      responsibleDisplayName: value.responsible_display_name,
      deadlineState: value.deadline_state,
      dueDate: value.due_date,
      actionStatus: value.action_status,
      isOverdue: value.is_overdue,
    };
  });
}

function projectHistory(
  value: z.output<typeof history>, snapshotDate: string, generatedAt: string,
): CaseConferenceHistoryEntry {
  const signed = value.status === "signed";
  const corrected = value.version_kind === "corrected";
  if (Date.parse(value.meeting_ends_at) <= Date.parse(value.meeting_starts_at) ||
      Date.parse(value.occurred_at) > Date.parse(generatedAt) ||
      (value.version === 1) !== (value.previous_version_id === null) ||
      (value.version === 1) !== (value.version_kind === "created") ||
      corrected !== (value.corrects_version_id !== null) ||
      corrected !== (value.correction_reason !== null) ||
      signed !== (["signed", "corrected"].includes(value.version_kind)) ||
      signed !== (value.signed_at !== null) ||
      signed !== (value.signer_display_name !== null) ||
      signed !== (value.signature_purpose !== null) ||
      signed !== (value.signer_role_keys.length > 0) ||
      (value.signed_at !== null && (
        Date.parse(value.signed_at) < Date.parse(value.meeting_ends_at) ||
        Date.parse(value.signed_at) > Date.parse(generatedAt)
      )) ||
      !unique(value.attendees.map((entry) => entry.user_id)) ||
      value.attendees.some((entry) => !unique(entry.role_keys) ||
        [...entry.role_keys].sort().some((role, index) => role !== entry.role_keys[index])) ||
      !unique(value.signer_role_keys) ||
      [...value.signer_role_keys].sort().some((role, index) => role !== value.signer_role_keys[index])) {
    invalid();
  }
  return {
    versionId: value.version_id,
    version: value.version,
    previousVersionId: value.previous_version_id,
    correctsVersionId: value.corrects_version_id,
    versionKind: value.version_kind,
    status: value.status,
    meetingStartsAt: value.meeting_starts_at,
    meetingEndsAt: value.meeting_ends_at,
    problemStatement: value.problem_statement,
    decisionSummary: value.decision_summary,
    attendees: value.attendees.map((entry) => ({
      userId: entry.user_id,
      membershipId: entry.membership_id,
      displayName: entry.display_name,
      roleKeys: entry.role_keys,
      attendanceStatus: entry.attendance_status,
    })),
    actionItems: projectActions(value.action_items, snapshotDate, value.meeting_starts_at),
    correctionReason: value.correction_reason,
    occurredAt: value.occurred_at,
    authorDisplayName: value.author_display_name,
    signedAt: value.signed_at,
    signerDisplayName: value.signer_display_name,
    signerRoleKeys: value.signer_role_keys,
    signaturePurpose: value.signature_purpose,
    contentHash: value.content_hash,
  };
}

function projectItem(
  value: z.output<typeof item>, snapshotDate: string, generatedAt: string,
): CaseConferenceItem {
  const current = projectHistory(value, snapshotDate, generatedAt);
  const entries = value.history.map((entry) => projectHistory(entry, snapshotDate, generatedAt));
  if (entries[0]?.versionId !== current.versionId ||
      entries[0]?.contentHash !== current.contentHash ||
      entries[0]?.status !== current.status ||
      entries.length !== current.version ||
      entries.some((entry, index) => entry.version !== current.version - index) ||
      entries.some((entry, index) => index < entries.length - 1 &&
        entry.previousVersionId !== entries[index + 1]!.versionId) ||
      entries.at(-1)?.previousVersionId !== null) invalid();
  return {
    ...current,
    meetingKey: value.meeting_key,
    clientId: value.client_id,
    clientDisplayName: value.client_display_name,
    clientCode: value.client_code,
    history: entries,
  };
}

export function projectCaseConferenceSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  expectedCanManage: boolean;
  expectedCanSign: boolean;
  expectedCanCorrect: boolean;
  demo: boolean;
}): CaseConferenceSnapshot {
  const parsed = source.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  const items = row.items.map((value) =>
    projectItem(value, row.snapshot_date, row.generated_at));
  const actions = items.flatMap((value) => value.actionItems);
  if (row.organization_id !== organization.data || row.branch_id !== branch.data ||
      row.snapshot_date !== taipeiDate(row.generated_at) ||
      row.can_manage !== input.expectedCanManage || row.can_sign !== input.expectedCanSign ||
      row.can_correct !== input.expectedCanCorrect ||
      row.matching_total < items.length ||
      row.items_truncated !== (row.matching_total > items.length) ||
      row.draft_total + row.signed_total !== row.matching_total ||
      row.corrected_total > row.signed_total ||
      row.open_action_total > row.action_total ||
      row.overdue_action_total > row.open_action_total ||
      row.deadline_missing_total + row.deadline_not_applicable_total > row.action_total ||
      !unique(items.map((value) => value.meetingKey)) ||
      !unique(row.client_options.map((value) => value.client_id)) ||
      !unique(row.staff_options.map((value) => value.user_id)) ||
      row.staff_options.some((value) => !unique(value.role_keys) ||
        [...value.role_keys].sort().some((role, index) => role !== value.role_keys[index])) ||
      items.some((value, index) => index > 0 &&
        Date.parse(value.meetingStartsAt) > Date.parse(items[index - 1]!.meetingStartsAt))) invalid();
  if (!row.items_truncated && (
    items.filter((value) => value.status === "draft").length !== row.draft_total ||
    items.filter((value) => value.status === "signed").length !== row.signed_total ||
    items.filter((value) => value.versionKind === "corrected").length !== row.corrected_total ||
    actions.length !== row.action_total ||
    actions.filter((value) => value.actionStatus === "open").length !== row.open_action_total ||
    actions.filter((value) => value.isOverdue).length !== row.overdue_action_total ||
    actions.filter((value) => value.deadlineState === "missing").length !== row.deadline_missing_total ||
    actions.filter((value) => value.deadlineState === "not_applicable").length !== row.deadline_not_applicable_total
  )) invalid();
  return {
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    branchId: row.branch_id,
    branchName: row.branch_name,
    generatedAt: row.generated_at,
    snapshotDate: row.snapshot_date,
    staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    snapshotToken: row.snapshot_token,
    items,
    metrics: {
      matching: row.matching_total,
      draft: row.draft_total,
      signed: row.signed_total,
      corrected: row.corrected_total,
      actionTotal: row.action_total,
      openAction: row.open_action_total,
      overdueAction: row.overdue_action_total,
      deadlineMissing: row.deadline_missing_total,
      deadlineNotApplicable: row.deadline_not_applicable_total,
    },
    itemsTruncated: row.items_truncated,
    clientOptions: row.client_options.map((value) => ({
      clientId: value.client_id, displayName: value.display_name, clientCode: value.client_code,
    })),
    staffOptions: row.staff_options.map((value) => ({
      userId: value.user_id, displayName: value.display_name, roleKeys: value.role_keys,
    })),
    canManage: row.can_manage,
    canSign: row.can_sign,
    canCorrect: row.can_correct,
    attachmentStatus: row.attachment_status,
    exportStatus: row.export_status,
    notificationStatus: row.notification_status,
    externalDeliveryStatus: row.external_delivery_status,
    deliveryClaim: row.delivery_claim,
    offlineStatus: row.offline_status,
    demo: input.demo,
  };
}
