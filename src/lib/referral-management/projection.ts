import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  REFERRAL_RECEIVING_UNIT_STATES,
  REFERRAL_STATUSES,
  type ReferralManagementItem,
  type ReferralManagementSnapshot,
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
const recipientCount = count.pipe(z.number().int().min(1).max(2));
const text = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrative = (max: number) => z.string().trim().min(2).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const unitCode = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u);
const eventKind = z.enum([
  "created", "submitted", "receipt_registered", "response_recorded", "closed", "corrected",
]);
const history = z.object({
  event_id: uuid,
  sequence: positive,
  event_kind: eventKind,
  corrects_event_id: uuid.nullable(),
  entry_content: narrative(4000).nullable(),
  correction_reason: narrative(500).nullable(),
  status: z.enum(REFERRAL_STATUSES),
  occurred_at: timestamp,
  actor_display_name: text(120),
  content_hash: hash,
  notification_recipient_count: recipientCount,
}).strict();
const notification = z.object({
  queue_status: z.literal("queued"),
  delivery_claim: z.literal("no_external_delivery_claim"),
  provider_status: z.literal("not_configured"),
  recipient_count: recipientCount,
}).strict();
const item = z.object({
  event_id: uuid,
  referral_key: uuid,
  sequence: positive,
  previous_event_id: uuid.nullable(),
  corrects_event_id: uuid.nullable(),
  event_kind: eventKind,
  client_id: uuid,
  client_display_name: text(120),
  client_code: text(80),
  owner_user_id: uuid,
  owner_display_name: text(120),
  receiving_unit_state: z.enum(REFERRAL_RECEIVING_UNIT_STATES),
  receiving_unit_code: unitCode.nullable(),
  receiving_unit_name: text(160).nullable(),
  receiving_unit_directory_status: z.literal("not_configured"),
  referral_date: timestamp,
  referral_reason: narrative(2000),
  entry_content: narrative(4000).nullable(),
  correction_reason: narrative(500).nullable(),
  status: z.enum(REFERRAL_STATUSES),
  occurred_at: timestamp,
  actor_display_name: text(120),
  content_hash: hash,
  notification,
  history: z.array(history).min(1).max(10_000),
}).strict();
const source = z.object({
  organization_id: uuid,
  organization_name: text(160),
  branch_id: uuid,
  branch_name: text(160),
  generated_at: timestamp,
  snapshot_token: hash,
  items: z.array(item).max(200),
  matching_total: count,
  draft_total: count,
  submitted_total: count,
  received_total: count,
  responded_total: count,
  closed_total: count,
  unit_missing_total: count,
  unit_not_applicable_total: count,
  items_truncated: z.boolean(),
  client_options: z.array(z.object({
    client_id: uuid, display_name: text(120), client_code: text(80),
  }).strict()).max(200),
  receiving_unit_options: z.array(z.object({
    code: unitCode, name: text(160), directory_status: z.literal("not_configured"),
  }).strict()).max(100),
  can_create: z.boolean(),
  can_submit: z.boolean(),
  can_register_receipt: z.boolean(),
  can_respond: z.boolean(),
  can_close: z.boolean(),
  can_correct: z.boolean(),
  receiving_unit_directory_status: z.literal("not_configured"),
  attachment_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"),
  notification_queue_status: z.literal("queued"),
  notification_provider_status: z.literal("not_configured"),
  external_delivery_status: z.literal("not_configured"),
  delivery_claim: z.literal("no_external_delivery_claim"),
}).strict();

export type ReferralManagementSnapshotSource = z.input<typeof source>;

function invalid(): never {
  throw new Error("INVALID_REFERRAL_MANAGEMENT_SNAPSHOT");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function projectItem(value: z.output<typeof item>): ReferralManagementItem {
  const hasUnit = value.receiving_unit_code !== null && value.receiving_unit_name !== null;
  if ((value.sequence === 1) !== (value.previous_event_id === null) ||
      (value.event_kind === "created") !== (value.sequence === 1) ||
      (value.event_kind === "corrected") !== (value.corrects_event_id !== null) ||
      (value.event_kind === "corrected") !== (value.correction_reason !== null) ||
      (value.receiving_unit_state === "manual_unstandardized") !== hasUnit ||
      (value.receiving_unit_code === null) !== (value.receiving_unit_name === null) ||
      value.history[0]?.event_id !== value.event_id ||
      value.history[0]?.sequence !== value.sequence ||
      value.history[0]?.status !== value.status ||
      value.history.at(-1)?.sequence !== 1 ||
      value.history.some((entry, index, all) =>
        index > 0 && entry.sequence >= all[index - 1]!.sequence) ||
      value.history.some((entry) =>
        (entry.event_kind === "corrected") !== (entry.corrects_event_id !== null) ||
        (entry.event_kind === "corrected") !== (entry.correction_reason !== null))) invalid();
  return {
    eventId: value.event_id,
    referralKey: value.referral_key,
    sequence: value.sequence,
    previousEventId: value.previous_event_id,
    correctsEventId: value.corrects_event_id,
    eventKind: value.event_kind,
    clientId: value.client_id,
    clientDisplayName: value.client_display_name,
    clientCode: value.client_code,
    ownerUserId: value.owner_user_id,
    ownerDisplayName: value.owner_display_name,
    receivingUnitState: value.receiving_unit_state,
    receivingUnitCode: value.receiving_unit_code,
    receivingUnitName: value.receiving_unit_name,
    receivingUnitDirectoryStatus: value.receiving_unit_directory_status,
    referralDate: value.referral_date,
    referralReason: value.referral_reason,
    entryContent: value.entry_content,
    correctionReason: value.correction_reason,
    status: value.status,
    occurredAt: value.occurred_at,
    actorDisplayName: value.actor_display_name,
    contentHash: value.content_hash,
    notification: {
      queueStatus: value.notification.queue_status,
      deliveryClaim: value.notification.delivery_claim,
      providerStatus: value.notification.provider_status,
      recipientCount: value.notification.recipient_count,
    },
    history: value.history.map((entry) => ({
      eventId: entry.event_id,
      sequence: entry.sequence,
      eventKind: entry.event_kind,
      correctsEventId: entry.corrects_event_id,
      entryContent: entry.entry_content,
      correctionReason: entry.correction_reason,
      status: entry.status,
      occurredAt: entry.occurred_at,
      actorDisplayName: entry.actor_display_name,
      contentHash: entry.content_hash,
      notificationRecipientCount: entry.notification_recipient_count,
    })),
  };
}

export function projectReferralManagementSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  expectedCanCreate: boolean;
  expectedCanSubmit: boolean;
  expectedCanRegisterReceipt: boolean;
  expectedCanRespond: boolean;
  expectedCanClose: boolean;
  expectedCanCorrect: boolean;
  demo: boolean;
}): ReferralManagementSnapshot {
  const parsed = source.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data ||
      row.can_create !== input.expectedCanCreate || row.can_submit !== input.expectedCanSubmit ||
      row.can_register_receipt !== input.expectedCanRegisterReceipt ||
      row.can_respond !== input.expectedCanRespond || row.can_close !== input.expectedCanClose ||
      row.can_correct !== input.expectedCanCorrect ||
      row.matching_total < row.items.length ||
      row.items_truncated !== (row.matching_total > row.items.length) ||
      [row.draft_total, row.submitted_total, row.received_total, row.responded_total,
        row.closed_total, row.unit_missing_total, row.unit_not_applicable_total]
        .some((value) => value > row.matching_total) ||
      row.draft_total + row.submitted_total + row.received_total +
        row.responded_total + row.closed_total !== row.matching_total ||
      row.unit_missing_total + row.unit_not_applicable_total > row.matching_total ||
      !unique(row.items.map((value) => value.referral_key)) ||
      !unique(row.client_options.map((value) => value.client_id)) ||
      !unique(row.receiving_unit_options.map((value) => value.code))) invalid();
  const items = row.items.map(projectItem);
  if (!row.items_truncated && (
    items.filter((value) => value.status === "draft").length !== row.draft_total ||
    items.filter((value) => value.status === "submitted").length !== row.submitted_total ||
    items.filter((value) => value.status === "received").length !== row.received_total ||
    items.filter((value) => value.status === "responded").length !== row.responded_total ||
    items.filter((value) => value.status === "closed").length !== row.closed_total ||
    items.filter((value) => value.receivingUnitState === "missing").length !== row.unit_missing_total ||
    items.filter((value) => value.receivingUnitState === "not_applicable").length !== row.unit_not_applicable_total
  )) invalid();
  return {
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    branchId: row.branch_id,
    branchName: row.branch_name,
    generatedAt: row.generated_at,
    staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    snapshotToken: row.snapshot_token,
    items,
    metrics: {
      matching: row.matching_total,
      draft: row.draft_total,
      submitted: row.submitted_total,
      received: row.received_total,
      responded: row.responded_total,
      closed: row.closed_total,
      unitMissing: row.unit_missing_total,
      unitNotApplicable: row.unit_not_applicable_total,
    },
    itemsTruncated: row.items_truncated,
    clientOptions: row.client_options.map((value) => ({
      clientId: value.client_id,
      displayName: value.display_name,
      clientCode: value.client_code,
    })),
    receivingUnitOptions: row.receiving_unit_options.map((value) => ({
      code: value.code,
      name: value.name,
      directoryStatus: value.directory_status,
    })),
    canCreate: row.can_create,
    canSubmit: row.can_submit,
    canRegisterReceipt: row.can_register_receipt,
    canRespond: row.can_respond,
    canClose: row.can_close,
    canCorrect: row.can_correct,
    receivingUnitDirectoryStatus: row.receiving_unit_directory_status,
    attachmentStatus: row.attachment_status,
    exportStatus: row.export_status,
    notificationQueueStatus: row.notification_queue_status,
    notificationProviderStatus: row.notification_provider_status,
    externalDeliveryStatus: row.external_delivery_status,
    deliveryClaim: row.delivery_claim,
    demo: input.demo,
  };
}
