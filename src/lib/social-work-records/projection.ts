import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  SOCIAL_WORK_FOLLOW_UP_STATUSES,
  SOCIAL_WORK_RECORD_STATES,
  type SocialWorkRecordFilters,
  type SocialWorkRecordSnapshot,
  type SocialWorkServiceRecord,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const positiveInteger = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe()),
]);

const versionHistorySchema = z.object({
  version_id: uuid,
  record_version: positiveInteger,
  record_state: z.enum(SOCIAL_WORK_RECORD_STATES),
  occurred_at: timestamp,
  service_type: z.string().trim().min(1).max(120),
  service_content: z.string().trim().min(1).max(5000),
  service_result: z.string().trim().min(1).max(3000),
  correction_reason: z.string().trim().min(1).max(1000).nullable(),
  author_display_name: z.string().trim().min(1).max(120),
  signed_at: timestamp.nullable(),
  signer_display_name: z.string().trim().min(1).max(120).nullable(),
  created_at: timestamp,
}).strict();

const followUpHistorySchema = z.object({
  event_id: uuid,
  sequence: positiveInteger,
  follow_up_status: z.enum(SOCIAL_WORK_FOLLOW_UP_STATUSES),
  due_on: date.nullable(),
  follow_up_plan: z.string().trim().min(1).max(2000).nullable(),
  follow_up_outcome: z.string().trim().min(1).max(2000).nullable(),
  transition_reason: z.string().trim().min(1).max(1000).nullable(),
  committer_display_name: z.string().trim().min(1).max(120),
  committed_at: timestamp,
}).strict();

const recordSchema = z.object({
  record_key: uuid,
  version_id: uuid,
  record_version: positiveInteger,
  record_state: z.enum(SOCIAL_WORK_RECORD_STATES),
  client_id: uuid,
  client_display_name: z.string().trim().min(1).max(120),
  occurred_at: timestamp,
  service_type: z.string().trim().min(1).max(120),
  service_content: z.string().trim().min(1).max(5000),
  service_result: z.string().trim().min(1).max(3000),
  author_user_id: uuid,
  author_display_name: z.string().trim().min(1).max(120),
  correction_reason: z.string().trim().min(1).max(1000).nullable(),
  signed_at: timestamp.nullable(),
  signer_display_name: z.string().trim().min(1).max(120).nullable(),
  created_at: timestamp,
  follow_up_event_id: uuid.nullable(),
  follow_up_sequence: count,
  follow_up_status: z.enum(SOCIAL_WORK_FOLLOW_UP_STATUSES).nullable(),
  follow_up_due_on: date.nullable(),
  follow_up_plan: z.string().trim().min(1).max(2000).nullable(),
  follow_up_outcome: z.string().trim().min(1).max(2000).nullable(),
  follow_up_transition_reason: z.string().trim().min(1).max(1000).nullable(),
  follow_up_committer_display_name: z.string().trim().min(1).max(120).nullable(),
  follow_up_committed_at: timestamp.nullable(),
  follow_up_overdue: z.boolean(),
  version_history: z.array(versionHistorySchema).max(50),
  version_history_total: count,
  follow_up_history: z.array(followUpHistorySchema).max(50),
  follow_up_history_total: count,
}).strict();

const clientOptionSchema = z.object({
  client_id: uuid,
  display_name: z.string().trim().min(1).max(120),
  client_status: z.enum(["active", "suspended", "transferred", "closed", "deceased"]),
  admitted_on: date.nullable(),
  ended_on: date.nullable(),
}).strict();
const authorOptionSchema = z.object({
  user_id: uuid,
  display_name: z.string().trim().min(1).max(120),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  records: z.array(recordSchema).max(200),
  record_total: count,
  matching_total: count,
  records_truncated: z.boolean(),
  current_month_total: count,
  pending_follow_up_total: count,
  overdue_follow_up_total: count,
  draft_total: count,
  signed_total: count,
  client_options: z.array(clientOptionSchema).max(200),
  client_total: count,
  client_options_truncated: z.boolean(),
  service_type_options: z.array(z.string().trim().min(1).max(120)).max(200),
  service_type_total: count,
  service_type_options_truncated: z.boolean(),
  author_options: z.array(authorOptionSchema).max(200),
  author_total: count,
  author_options_truncated: z.boolean(),
  offline_sync_status: z.literal("not_configured"),
  follow_up_notification_status: z.literal("none_not_sent"),
}).strict();

export type SocialWorkSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_SOCIAL_WORK_RECORD_PROJECTION");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function taipeiMonth(value: string) {
  return taipeiDate(value).slice(0, 7);
}

function validVersionState(item: z.output<typeof versionHistorySchema>) {
  return item.record_state === "draft"
    ? item.correction_reason === null && item.signed_at === null && item.signer_display_name === null
    : item.record_state === "signed"
      ? item.correction_reason === null && item.signed_at !== null && item.signer_display_name !== null
      : item.correction_reason !== null && item.signed_at !== null && item.signer_display_name !== null;
}

function validFollowUpState(item: z.output<typeof followUpHistorySchema>) {
  return item.follow_up_status === "pending"
    ? item.due_on !== null && item.follow_up_plan !== null && item.follow_up_outcome === null && item.transition_reason === null
    : item.follow_up_status === "completed"
      ? item.due_on === null && item.follow_up_plan === null && item.follow_up_outcome !== null && item.transition_reason === null
      : item.due_on === null && item.follow_up_plan === null && item.follow_up_outcome === null && item.transition_reason !== null;
}

function normalizeRecord(
  row: z.output<typeof recordSchema>,
  generatedDate: string,
): SocialWorkServiceRecord {
  if (
    !validVersionState({
      version_id: row.version_id,
      record_version: row.record_version,
      record_state: row.record_state,
      occurred_at: row.occurred_at,
      service_type: row.service_type,
      service_content: row.service_content,
      service_result: row.service_result,
      correction_reason: row.correction_reason,
      author_display_name: row.author_display_name,
      signed_at: row.signed_at,
      signer_display_name: row.signer_display_name,
      created_at: row.created_at,
    }) ||
    row.version_history_total < row.version_history.length ||
    (row.version_history_total > row.version_history.length && row.version_history.length !== 50) ||
    !unique(row.version_history.map((item) => item.version_id)) ||
    row.version_history.some((item, index) =>
      item.record_version !== index + 1 || !validVersionState(item) ||
      new Date(item.created_at).getTime() + 5 * 60_000 < new Date(item.occurred_at).getTime(),
    ) ||
    row.follow_up_history_total < row.follow_up_history.length ||
    (row.follow_up_history_total > row.follow_up_history.length && row.follow_up_history.length !== 50) ||
    !unique(row.follow_up_history.map((item) => item.event_id)) ||
    row.follow_up_history.some((item, index) =>
      item.sequence !== index + 1 || !validFollowUpState(item),
    )
  ) invalid();

  const versionHistoryTruncated = row.version_history_total > row.version_history.length;
  const lastVersion = row.version_history.at(-1);
  if (!versionHistoryTruncated && (
    lastVersion?.version_id !== row.version_id ||
    lastVersion.record_version !== row.record_version ||
    lastVersion.record_state !== row.record_state ||
    lastVersion.occurred_at !== row.occurred_at ||
    lastVersion.service_type !== row.service_type ||
    lastVersion.service_content !== row.service_content ||
    lastVersion.service_result !== row.service_result
  )) invalid();

  const followUpHistoryTruncated = row.follow_up_history_total > row.follow_up_history.length;
  const latestFollowUp = row.follow_up_history.at(-1);
  if (row.follow_up_event_id === null) {
    if (
      row.follow_up_sequence !== 0 || row.follow_up_status !== null ||
      row.follow_up_due_on !== null || row.follow_up_plan !== null ||
      row.follow_up_outcome !== null || row.follow_up_transition_reason !== null ||
      row.follow_up_committer_display_name !== null || row.follow_up_committed_at !== null ||
      row.follow_up_overdue || row.follow_up_history_total !== 0
    ) invalid();
  } else {
    const expectedOverdue = row.follow_up_status === "pending" &&
      row.follow_up_due_on !== null && row.follow_up_due_on < generatedDate;
    const latestShapeValid = row.follow_up_status === "pending"
      ? row.follow_up_due_on !== null && row.follow_up_plan !== null &&
        row.follow_up_outcome === null && row.follow_up_transition_reason === null
      : row.follow_up_status === "completed"
        ? row.follow_up_due_on === null && row.follow_up_plan === null &&
          row.follow_up_outcome !== null && row.follow_up_transition_reason === null
        : row.follow_up_status === "cancelled" && row.follow_up_due_on === null &&
          row.follow_up_plan === null && row.follow_up_outcome === null &&
          row.follow_up_transition_reason !== null;
    if (
      row.follow_up_sequence < 1 || row.follow_up_status === null ||
      row.follow_up_committer_display_name === null || row.follow_up_committed_at === null ||
      !latestShapeValid || row.follow_up_overdue !== expectedOverdue ||
      (!followUpHistoryTruncated && (
        latestFollowUp?.event_id !== row.follow_up_event_id ||
        latestFollowUp.sequence !== row.follow_up_sequence ||
        latestFollowUp.follow_up_status !== row.follow_up_status
      ))
    ) invalid();
  }

  return {
    recordKey: row.record_key,
    versionId: row.version_id,
    recordVersion: row.record_version,
    recordState: row.record_state,
    clientId: row.client_id,
    clientDisplayName: row.client_display_name,
    occurredAt: row.occurred_at,
    serviceType: row.service_type,
    serviceContent: row.service_content,
    serviceResult: row.service_result,
    authorUserId: row.author_user_id,
    authorDisplayName: row.author_display_name,
    correctionReason: row.correction_reason,
    signedAt: row.signed_at,
    signerDisplayName: row.signer_display_name,
    createdAt: row.created_at,
    followUpEventId: row.follow_up_event_id,
    followUpSequence: row.follow_up_sequence,
    followUpStatus: row.follow_up_status,
    followUpDueOn: row.follow_up_due_on,
    followUpPlan: row.follow_up_plan,
    followUpOutcome: row.follow_up_outcome,
    followUpTransitionReason: row.follow_up_transition_reason,
    followUpCommitterDisplayName: row.follow_up_committer_display_name,
    followUpCommittedAt: row.follow_up_committed_at,
    followUpOverdue: row.follow_up_overdue,
    versionHistory: row.version_history.map((item) => ({
      versionId: item.version_id,
      recordVersion: item.record_version,
      recordState: item.record_state,
      occurredAt: item.occurred_at,
      serviceType: item.service_type,
      serviceContent: item.service_content,
      serviceResult: item.service_result,
      correctionReason: item.correction_reason,
      authorDisplayName: item.author_display_name,
      signedAt: item.signed_at,
      signerDisplayName: item.signer_display_name,
      createdAt: item.created_at,
    })),
    versionHistoryTotal: row.version_history_total,
    versionHistoryTruncated,
    followUpHistory: row.follow_up_history.map((item) => ({
      eventId: item.event_id,
      sequence: item.sequence,
      status: item.follow_up_status,
      dueOn: item.due_on,
      plan: item.follow_up_plan,
      outcome: item.follow_up_outcome,
      transitionReason: item.transition_reason,
      committerDisplayName: item.committer_display_name,
      committedAt: item.committed_at,
    })),
    followUpHistoryTotal: row.follow_up_history_total,
    followUpHistoryTruncated,
  };
}

export function projectSocialWorkRecordSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): SocialWorkRecordSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data) invalid();

  const generatedDate = taipeiDate(row.generated_at);
  const generatedMonth = generatedDate.slice(0, 7);
  const records = row.records.map((item) => normalizeRecord(item, generatedDate));
  const sorted = [...records].sort((left, right) => {
    const time = new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();
    return time || left.recordKey.localeCompare(right.recordKey, "en");
  });
  if (
    records.some((item, index) => item.recordKey !== sorted[index]?.recordKey) ||
    !unique(records.map((item) => item.recordKey)) ||
    row.record_total !== records.length ||
    row.matching_total < row.record_total ||
    row.records_truncated !== (row.matching_total > row.record_total) ||
    (row.records_truncated && row.record_total !== 200) ||
    row.draft_total + row.signed_total !== row.matching_total ||
    [row.current_month_total, row.pending_follow_up_total, row.overdue_follow_up_total,
      row.draft_total, row.signed_total].some((value) => value > row.matching_total) ||
    row.overdue_follow_up_total > row.pending_follow_up_total ||
    !unique(row.client_options.map((item) => item.client_id)) ||
    !unique(row.service_type_options) ||
    !unique(row.author_options.map((item) => item.user_id)) ||
    row.client_total < row.client_options.length ||
    row.client_options_truncated !== (row.client_total > row.client_options.length) ||
    (row.client_options_truncated && row.client_options.length !== 200) ||
    row.service_type_total < row.service_type_options.length ||
    row.service_type_options_truncated !== (row.service_type_total > row.service_type_options.length) ||
    (row.service_type_options_truncated && row.service_type_options.length !== 200) ||
    row.author_total < row.author_options.length ||
    row.author_options_truncated !== (row.author_total > row.author_options.length) ||
    (row.author_options_truncated && row.author_options.length !== 200)
  ) invalid();

  if (!row.records_truncated && (
    records.filter((item) => taipeiMonth(item.occurredAt) === generatedMonth).length !== row.current_month_total ||
    records.filter((item) => item.followUpStatus === "pending").length !== row.pending_follow_up_total ||
    records.filter((item) => item.followUpOverdue).length !== row.overdue_follow_up_total ||
    records.filter((item) => item.recordState === "draft").length !== row.draft_total ||
    records.filter((item) => item.recordState !== "draft").length !== row.signed_total
  )) invalid();

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(new Date(row.generated_at).getTime() + 60_000).toISOString(),
    records,
    recordTotal: row.record_total,
    matchingTotal: row.matching_total,
    recordsTruncated: row.records_truncated,
    metrics: {
      currentMonth: row.current_month_total,
      pendingFollowUp: row.pending_follow_up_total,
      overdueFollowUp: row.overdue_follow_up_total,
      drafts: row.draft_total,
      signed: row.signed_total,
    },
    clientOptions: row.client_options.map((item) => ({
      clientId: item.client_id,
      displayName: item.display_name,
      clientStatus: item.client_status,
      admittedOn: item.admitted_on,
      endedOn: item.ended_on,
    })),
    clientOptionsTruncated: row.client_options_truncated,
    serviceTypeOptions: row.service_type_options,
    serviceTypeOptionsTruncated: row.service_type_options_truncated,
    authorOptions: row.author_options.map((item) => ({
      userId: item.user_id,
      displayName: item.display_name,
    })),
    authorOptionsTruncated: row.author_options_truncated,
    offlineSyncStatus: row.offline_sync_status,
    followUpNotificationStatus: row.follow_up_notification_status,
    demo: input.demo,
  };
}

export function filterDemoSocialWorkRecordSnapshot(
  snapshot: SocialWorkRecordSnapshot,
  filters: SocialWorkRecordFilters,
): SocialWorkRecordSnapshot {
  const records = snapshot.records.filter((record) => {
    const dateValue = taipeiDate(record.occurredAt);
    return (filters.dateFrom === null || dateValue >= filters.dateFrom) &&
      (filters.dateTo === null || dateValue <= filters.dateTo) &&
      (filters.clientId === null || record.clientId === filters.clientId) &&
      (filters.serviceType === null || record.serviceType === filters.serviceType) &&
      (filters.authorUserId === null || record.authorUserId === filters.authorUserId);
  });
  const generatedMonth = taipeiMonth(snapshot.generatedAt);
  return {
    ...snapshot,
    records,
    recordTotal: records.length,
    matchingTotal: records.length,
    recordsTruncated: false,
    metrics: {
      currentMonth: records.filter((item) => taipeiMonth(item.occurredAt) === generatedMonth).length,
      pendingFollowUp: records.filter((item) => item.followUpStatus === "pending").length,
      overdueFollowUp: records.filter((item) => item.followUpOverdue).length,
      drafts: records.filter((item) => item.recordState === "draft").length,
      signed: records.filter((item) => item.recordState !== "draft").length,
    },
  };
}
