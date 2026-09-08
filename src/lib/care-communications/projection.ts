import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import type {
  CareCommunicationItem,
  CareCommunicationSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) =>
    isStrictOffsetDateTime(value) &&
    Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const text = (max: number) => z.string().trim().min(1).max(max);

const recipientSchema = z.object({
  display_name: text(120),
  profile_kind: z.literal("family"),
  relationship: text(80),
  consent_document_version: text(120),
  consent_scopes: z.array(text(80)).min(1).max(20),
  consented_at: timestamp,
  consent_expires_at: timestamp.nullable(),
}).strict();

const deliveryEventSchema = z.object({
  event_kind: z.literal("queued"),
  channel: z.literal("family_pwa"),
  provider_worker_status: z.literal("not_configured"),
  family_consumer_status: z.literal("not_configured"),
  offline_consumer_status: z.literal("not_configured"),
  occurred_at: timestamp,
}).strict();

const itemSchema = z.object({
  version_id: uuid,
  communication_key: uuid,
  version: count.pipe(z.number().int().positive().max(1_000_001)),
  previous_version_id: uuid.nullable(),
  record_kind: z.enum(["original", "correction"]),
  category: z.literal("care_communication"),
  direction: z.literal("staff_to_family"),
  client_id: uuid,
  client_display_name: text(120),
  client_code: text(120),
  subject: text(200),
  body: text(10_000),
  occurred_at: timestamp,
  submitted_at: timestamp,
  author_display_name: text(120),
  author_profile_kind: z.literal("staff"),
  correction_reason: text(500).nullable(),
  attachment_state: z.literal("none"),
  recipient_count: count.pipe(z.number().int().positive().max(20)),
  delivery_status: z.literal("queued"),
  read_status: z.literal("not_configured"),
  family_confirmation_status: z.literal("not_configured"),
  is_current: z.boolean(),
  recipients: z.array(recipientSchema).min(1).max(20),
  delivery_events: z.array(deliveryEventSchema).min(1).max(20),
}).strict();

const clientOptionSchema = z.object({
  client_id: uuid,
  display_name: text(120),
  client_code: text(120),
  authorized_family_count: count.pipe(z.number().int().max(20)),
}).strict();
const authorOptionSchema = z.object({
  user_id: uuid,
  display_name: text(120),
}).strict();

const snapshotSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  items: z.array(itemSchema).max(100),
  matching_total: count,
  thread_total: count,
  correction_total: count,
  queued_total: count,
  today_total: count,
  attachment_total: count,
  items_truncated: z.boolean(),
  client_options: z.array(clientOptionSchema).max(500),
  author_options: z.array(authorOptionSchema).max(500),
  can_manage: z.boolean(),
  can_correct: z.boolean(),
  category_boundary: z.literal("care_communication_only"),
  family_recipient_boundary: z.literal("active_messages_read_consent"),
  attachment_pipeline_status: z.literal("not_configured"),
  provider_worker_status: z.literal("not_configured"),
  family_consumer_status: z.literal("not_configured"),
  offline_consumer_status: z.literal("not_configured"),
}).strict();

export type CareCommunicationSnapshotSource = z.input<typeof snapshotSchema>;

function invalid(): never {
  throw new Error("INVALID_CARE_COMMUNICATION_SNAPSHOT");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function taipeiDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function projectItem(item: z.output<typeof itemSchema>): CareCommunicationItem {
  const original = item.record_kind === "original";
  if (
    (original && (
      item.version !== 1 || item.previous_version_id !== null ||
      item.correction_reason !== null
    )) ||
    (!original && (
      item.version < 2 || item.previous_version_id === null ||
      item.correction_reason === null
    )) ||
    item.recipients.length !== item.recipient_count ||
    item.delivery_events.length !== item.recipient_count ||
    item.recipients.some((recipient) =>
      !unique(recipient.consent_scopes) ||
      !recipient.consent_scopes.includes("messages.read") ||
      (recipient.consent_expires_at !== null &&
        recipient.consent_expires_at <= recipient.consented_at)
    ) ||
    item.delivery_events.some((event) => event.occurred_at !== item.submitted_at)
  ) invalid();
  return {
    versionId: item.version_id,
    communicationKey: item.communication_key,
    version: item.version,
    previousVersionId: item.previous_version_id,
    recordKind: item.record_kind,
    category: item.category,
    direction: item.direction,
    clientId: item.client_id,
    clientDisplayName: item.client_display_name,
    clientCode: item.client_code,
    subject: item.subject,
    body: item.body,
    occurredAt: item.occurred_at,
    submittedAt: item.submitted_at,
    authorDisplayName: item.author_display_name,
    authorProfileKind: item.author_profile_kind,
    correctionReason: item.correction_reason,
    attachmentState: item.attachment_state,
    recipientCount: item.recipient_count,
    deliveryStatus: item.delivery_status,
    readStatus: item.read_status,
    familyConfirmationStatus: item.family_confirmation_status,
    current: item.is_current,
    recipients: item.recipients.map((recipient) => ({
      displayName: recipient.display_name,
      profileKind: recipient.profile_kind,
      relationship: recipient.relationship,
      consentDocumentVersion: recipient.consent_document_version,
      consentScopes: recipient.consent_scopes,
      consentedAt: recipient.consented_at,
      consentExpiresAt: recipient.consent_expires_at,
    })),
    deliveryEvents: item.delivery_events.map((event) => ({
      eventKind: event.event_kind,
      channel: event.channel,
      providerWorkerStatus: event.provider_worker_status,
      familyConsumerStatus: event.family_consumer_status,
      offlineConsumerStatus: event.offline_consumer_status,
      occurredAt: event.occurred_at,
    })),
  };
}

export function projectCareCommunicationSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  expectedCanManage: boolean;
  expectedCanCorrect: boolean;
  demo: boolean;
}): CareCommunicationSnapshot {
  const parsed = snapshotSchema.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success ||
      parsed.data.organization_id !== organization.data ||
      parsed.data.branch_id !== branch.data ||
      parsed.data.can_manage !== input.expectedCanManage ||
      parsed.data.can_correct !== input.expectedCanCorrect ||
      parsed.data.matching_total < parsed.data.items.length ||
      parsed.data.items_truncated !==
        (parsed.data.matching_total > parsed.data.items.length) ||
      parsed.data.thread_total > parsed.data.matching_total ||
      parsed.data.correction_total > parsed.data.matching_total ||
      parsed.data.queued_total > parsed.data.thread_total ||
      parsed.data.today_total > parsed.data.matching_total ||
      parsed.data.attachment_total !== 0 ||
      !unique(parsed.data.items.map((item) => item.version_id)) ||
      !unique(parsed.data.client_options.map((option) => option.client_id)) ||
      !unique(parsed.data.author_options.map((option) => option.user_id))) {
    invalid();
  }
  const items = parsed.data.items.map(projectItem);
  if (!parsed.data.items_truncated && (
    new Set(items.map((item) => item.communicationKey)).size !==
      parsed.data.thread_total ||
    items.filter((item) => item.recordKind === "correction").length !==
      parsed.data.correction_total ||
    items.filter((item) => item.current).length !== parsed.data.queued_total ||
    items.filter((item) =>
      taipeiDate(item.submittedAt) === taipeiDate(parsed.data.generated_at)
    ).length !== parsed.data.today_total
  )) invalid();
  return {
    organizationId: parsed.data.organization_id,
    branchId: parsed.data.branch_id,
    generatedAt: parsed.data.generated_at,
    staleAfter: new Date(
      new Date(parsed.data.generated_at).getTime() + 60_000,
    ).toISOString(),
    items,
    metrics: {
      matching: parsed.data.matching_total,
      threads: parsed.data.thread_total,
      corrections: parsed.data.correction_total,
      queued: parsed.data.queued_total,
      today: parsed.data.today_total,
      attachments: parsed.data.attachment_total,
    },
    itemsTruncated: parsed.data.items_truncated,
    clientOptions: parsed.data.client_options.map((option) => ({
      clientId: option.client_id,
      displayName: option.display_name,
      clientCode: option.client_code,
      authorizedFamilyCount: option.authorized_family_count,
    })),
    authorOptions: parsed.data.author_options.map((option) => ({
      userId: option.user_id,
      displayName: option.display_name,
    })),
    canManage: parsed.data.can_manage,
    canCorrect: parsed.data.can_correct,
    categoryBoundary: parsed.data.category_boundary,
    familyRecipientBoundary: parsed.data.family_recipient_boundary,
    attachmentPipelineStatus: parsed.data.attachment_pipeline_status,
    providerWorkerStatus: parsed.data.provider_worker_status,
    familyConsumerStatus: parsed.data.family_consumer_status,
    offlineConsumerStatus: parsed.data.offline_consumer_status,
    demo: input.demo,
  };
}
