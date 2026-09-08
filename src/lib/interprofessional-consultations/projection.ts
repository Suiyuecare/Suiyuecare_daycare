import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  CONSULTATION_STATUSES,
  CONSULTATION_URGENCIES,
  type InterprofessionalConsultationItem,
  type InterprofessionalConsultationSnapshot,
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
const recipientCount = count.pipe(z.number().int().min(1).max(3));
const text = (max: number) => z.string().trim().min(1).max(max);
const narrative = (max: number) => z.string().trim().min(2).max(max);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const eventKind = z.enum([
  "created", "assigned", "reassigned", "reply", "supplement", "closed", "reopened", "corrected",
]);
const deadlineState = z.enum(["dated", "missing", "not_applicable"]);
const history = z.object({
  event_id: uuid, sequence: positive, event_kind: eventKind,
  corrects_event_id: uuid.nullable(), entry_content: narrative(4000).nullable(),
  status: z.enum(CONSULTATION_STATUSES), assignee_display_name: text(120).nullable(),
  occurred_at: timestamp, actor_display_name: text(120), content_hash: hash,
  notification_recipient_count: recipientCount,
}).strict();
const notification = z.object({
  queue_status: z.literal("queued"),
  delivery_claim: z.literal("queued_not_delivered"),
  external_provider_status: z.literal("not_configured"),
  recipient_count: recipientCount,
}).strict();
const item = z.object({
  event_id: uuid, consultation_key: uuid, sequence: positive,
  previous_event_id: uuid.nullable(), corrects_event_id: uuid.nullable(),
  event_kind: eventKind, client_id: uuid, client_display_name: text(120),
  client_code: text(80), requester_user_id: uuid, requester_display_name: text(120),
  assignee_user_id: uuid.nullable(), assignee_display_name: text(120).nullable(),
  assignment_state: z.enum(["assigned", "unassigned"]),
  discipline_code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u),
  discipline_label: text(100), discipline_taxonomy_status: z.literal("manual_unstandardized"),
  urgency: z.enum(CONSULTATION_URGENCIES), urgency_source: z.literal("manual"),
  requested_at: timestamp, deadline_state: deadlineState, due_at: timestamp.nullable(),
  problem_summary: narrative(2000), entry_content: narrative(4000).nullable(),
  status: z.enum(CONSULTATION_STATUSES), occurred_at: timestamp,
  actor_display_name: text(120), content_hash: hash, notification,
  history: z.array(history).min(1).max(10_000),
}).strict();
const person = z.object({ user_id: uuid, display_name: text(120) }).strict();
const source = z.object({
  organization_id: uuid, organization_name: text(160), branch_id: uuid,
  branch_name: text(160), generated_at: timestamp, snapshot_token: hash,
  items: z.array(item).max(200), matching_total: count, unassigned_total: count,
  in_progress_total: count, overdue_total: count, closed_total: count,
  deadline_missing_total: count, deadline_not_applicable_total: count,
  items_truncated: z.boolean(),
  client_options: z.array(z.object({
    client_id: uuid, display_name: text(120), client_code: text(80),
  }).strict()).max(200),
  requester_options: z.array(person).max(200), assignee_options: z.array(person).max(200),
  discipline_options: z.array(z.object({
    code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u),
    label: text(100), taxonomy_status: z.literal("manual_unstandardized"),
  }).strict()).max(100),
  can_create: z.boolean(), can_assign: z.boolean(), can_respond: z.boolean(),
  can_correct: z.boolean(), can_close: z.boolean(),
  taxonomy_status: z.literal("manual_unstandardized"),
  notification_queue_status: z.literal("queued"),
  notification_delivery_claim: z.literal("queued_not_delivered"),
  external_provider_status: z.literal("not_configured"),
}).strict();

export type InterprofessionalConsultationSnapshotSource = z.input<typeof source>;
function invalid(): never { throw new Error("INVALID_INTERPROFESSIONAL_CONSULTATION_SNAPSHOT"); }
function unique(values: readonly string[]) { return new Set(values).size === values.length; }

function projectItem(value: z.output<typeof item>): InterprofessionalConsultationItem {
  if ((value.sequence === 1) !== (value.previous_event_id === null) ||
      (value.event_kind === "created") !== (value.sequence === 1) ||
      (value.event_kind === "corrected") !== (value.corrects_event_id !== null) ||
      (value.assignment_state === "unassigned") !== (value.assignee_user_id === null) ||
      (value.assignee_user_id === null) !== (value.assignee_display_name === null) ||
      (value.deadline_state === "dated") !== (value.due_at !== null) ||
      value.history[0]?.event_id !== value.event_id ||
      value.history[0]?.sequence !== value.sequence ||
      value.history[0]?.status !== value.status ||
      value.history.at(-1)?.sequence !== 1 ||
      value.history.some((entry, index, all) =>
        index > 0 && entry.sequence >= all[index - 1]!.sequence) ||
      value.history.some((entry) =>
        (entry.event_kind === "corrected") !== (entry.corrects_event_id !== null))) invalid();
  return {
    eventId: value.event_id, consultationKey: value.consultation_key,
    sequence: value.sequence, previousEventId: value.previous_event_id,
    correctsEventId: value.corrects_event_id, eventKind: value.event_kind,
    clientId: value.client_id, clientDisplayName: value.client_display_name,
    clientCode: value.client_code, requesterUserId: value.requester_user_id,
    requesterDisplayName: value.requester_display_name,
    assigneeUserId: value.assignee_user_id,
    assigneeDisplayName: value.assignee_display_name,
    assignmentState: value.assignment_state, disciplineCode: value.discipline_code,
    disciplineLabel: value.discipline_label,
    disciplineTaxonomyStatus: value.discipline_taxonomy_status,
    urgency: value.urgency, urgencySource: value.urgency_source,
    requestedAt: value.requested_at, deadlineState: value.deadline_state,
    dueAt: value.due_at, problemSummary: value.problem_summary,
    entryContent: value.entry_content, status: value.status,
    occurredAt: value.occurred_at, actorDisplayName: value.actor_display_name,
    contentHash: value.content_hash,
    notification: {
      queueStatus: value.notification.queue_status,
      deliveryClaim: value.notification.delivery_claim,
      externalProviderStatus: value.notification.external_provider_status,
      recipientCount: value.notification.recipient_count,
    },
    history: value.history.map((entry) => ({
      eventId: entry.event_id, sequence: entry.sequence,
      eventKind: entry.event_kind, correctsEventId: entry.corrects_event_id,
      entryContent: entry.entry_content, status: entry.status,
      assigneeDisplayName: entry.assignee_display_name,
      occurredAt: entry.occurred_at, actorDisplayName: entry.actor_display_name,
      contentHash: entry.content_hash,
      notificationRecipientCount: entry.notification_recipient_count,
    })),
  };
}

export function projectInterprofessionalConsultationSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  expectedCanCreate: boolean;
  expectedCanAssign: boolean;
  expectedCanRespond: boolean;
  expectedCanCorrect: boolean;
  expectedCanClose: boolean;
  demo: boolean;
}): InterprofessionalConsultationSnapshot {
  const parsed = source.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data ||
      row.can_create !== input.expectedCanCreate || row.can_assign !== input.expectedCanAssign ||
      row.can_respond !== input.expectedCanRespond ||
      row.can_correct !== input.expectedCanCorrect || row.can_close !== input.expectedCanClose ||
      row.matching_total < row.items.length ||
      row.items_truncated !== (row.matching_total > row.items.length) ||
      row.unassigned_total > row.matching_total || row.in_progress_total > row.matching_total ||
      row.overdue_total > row.matching_total || row.closed_total > row.matching_total ||
      row.deadline_missing_total + row.deadline_not_applicable_total > row.matching_total ||
      !unique(row.items.map((value) => value.consultation_key)) ||
      !unique(row.client_options.map((value) => value.client_id)) ||
      !unique(row.requester_options.map((value) => value.user_id)) ||
      !unique(row.assignee_options.map((value) => value.user_id)) ||
      !unique(row.discipline_options.map((value) => value.code))) invalid();
  const items = row.items.map(projectItem);
  if (!row.items_truncated && (
    items.filter((value) => value.assignmentState === "unassigned").length !== row.unassigned_total ||
    items.filter((value) => ["assigned", "answered"].includes(value.status)).length !== row.in_progress_total ||
    items.filter((value) => value.deadlineState === "dated" &&
      value.dueAt! < row.generated_at && value.status !== "closed").length !== row.overdue_total ||
    items.filter((value) => value.status === "closed").length !== row.closed_total ||
    items.filter((value) => value.deadlineState === "missing").length !== row.deadline_missing_total ||
    items.filter((value) => value.deadlineState === "not_applicable").length !== row.deadline_not_applicable_total
  )) invalid();
  return {
    organizationId: row.organization_id, organizationName: row.organization_name,
    branchId: row.branch_id, branchName: row.branch_name,
    generatedAt: row.generated_at,
    staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    snapshotToken: row.snapshot_token, items,
    metrics: {
      matching: row.matching_total, unassigned: row.unassigned_total,
      inProgress: row.in_progress_total, overdue: row.overdue_total,
      closed: row.closed_total, deadlineMissing: row.deadline_missing_total,
      deadlineNotApplicable: row.deadline_not_applicable_total,
    },
    itemsTruncated: row.items_truncated,
    clientOptions: row.client_options.map((value) => ({
      clientId: value.client_id, displayName: value.display_name, clientCode: value.client_code,
    })),
    requesterOptions: row.requester_options.map((value) => ({
      userId: value.user_id, displayName: value.display_name,
    })),
    assigneeOptions: row.assignee_options.map((value) => ({
      userId: value.user_id, displayName: value.display_name,
    })),
    disciplineOptions: row.discipline_options.map((value) => ({
      code: value.code, label: value.label, taxonomyStatus: value.taxonomy_status,
    })),
    canCreate: row.can_create, canAssign: row.can_assign,
    canRespond: row.can_respond, canCorrect: row.can_correct, canClose: row.can_close,
    taxonomyStatus: row.taxonomy_status,
    notificationQueueStatus: row.notification_queue_status,
    notificationDeliveryClaim: row.notification_delivery_claim,
    externalProviderStatus: row.external_provider_status,
    demo: input.demo,
  };
}
