import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import type {
  ConsultantMessageItem,
  ConsultantMessageSnapshot,
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
const roleNames = z.array(text(120)).min(1).max(20);

const recipientSchema = z.object({
  user_id: uuid,
  display_name: text(120),
  employee_code: z.string().trim().min(1).max(120).nullable(),
  profile_kind: z.literal("professional"),
  role_names: roleNames,
  read_at: timestamp.nullable(),
  confirmed_at: timestamp.nullable(),
}).strict();

const recipientOptionSchema = z.object({
  user_id: uuid,
  display_name: text(120),
  employee_code: z.string().trim().min(1).max(120).nullable(),
  profile_kind: z.literal("professional"),
  role_names: roleNames,
}).strict();

const itemSchema = z.object({
  message_id: uuid,
  category: z.literal("consultant"),
  subject: text(200),
  body: text(10_000),
  occurred_at: timestamp,
  published_at: timestamp,
  author_display_name: text(120),
  author_profile_kind: z.literal("staff"),
  recipient_count: count.pipe(z.number().int().positive().max(100)),
  read_count: count,
  confirmed_count: count,
  actor_is_recipient: z.boolean(),
  actor_read_at: timestamp.nullable(),
  actor_confirmed_at: timestamp.nullable(),
  attachment_count: count,
  recipients: z.array(recipientSchema).max(100),
}).strict();

const snapshotSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  items: z.array(itemSchema).max(100),
  message_total: count,
  unread_total: count,
  today_total: count,
  attachment_total: count,
  confirmation_pending_total: count,
  items_truncated: z.boolean(),
  can_manage: z.boolean(),
  recipient_options: z.array(recipientOptionSchema).max(500),
  category_boundary: z.literal("consultant_only"),
  delivery_boundary: z.literal("in_app_only"),
  attachment_pipeline_status: z.literal("not_configured"),
  attachment_scan_status: z.literal("not_configured"),
}).strict();

export type ConsultantMessageSnapshotSource = z.input<typeof snapshotSchema>;

function invalid(): never {
  throw new Error("INVALID_CONSULTANT_MESSAGE_SNAPSHOT");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function projectItem(
  item: z.output<typeof itemSchema>,
  canManage: boolean,
): ConsultantMessageItem {
  const recipientIds = item.recipients.map((recipient) => recipient.user_id);
  const recipientReadCount = item.recipients.filter(
    (recipient) => recipient.read_at !== null,
  ).length;
  const recipientConfirmedCount = item.recipients.filter(
    (recipient) => recipient.confirmed_at !== null,
  ).length;
  if (
    item.read_count > item.recipient_count ||
    item.confirmed_count > item.read_count ||
    item.attachment_count !== 0 ||
    !unique(recipientIds) ||
    item.recipients.some((recipient) =>
      !unique(recipient.role_names) ||
      (recipient.confirmed_at !== null && recipient.read_at === null) ||
      (recipient.confirmed_at !== null && recipient.confirmed_at < recipient.read_at!)
    ) ||
    (item.actor_read_at !== null && !item.actor_is_recipient) ||
    (item.actor_confirmed_at !== null && item.actor_read_at === null) ||
    (item.actor_confirmed_at !== null &&
      item.actor_confirmed_at < item.actor_read_at!) ||
    (canManage && (
      item.recipients.length !== item.recipient_count ||
      recipientReadCount !== item.read_count ||
      recipientConfirmedCount !== item.confirmed_count
    )) ||
    (!canManage && (
      !item.actor_is_recipient ||
      item.recipients.length !== 1 ||
      item.recipients[0]?.read_at !== item.actor_read_at ||
      item.recipients[0]?.confirmed_at !== item.actor_confirmed_at
    ))
  ) invalid();
  return {
    messageId: item.message_id,
    category: item.category,
    subject: item.subject,
    body: item.body,
    occurredAt: item.occurred_at,
    publishedAt: item.published_at,
    authorDisplayName: item.author_display_name,
    authorProfileKind: item.author_profile_kind,
    recipientCount: item.recipient_count,
    readCount: item.read_count,
    confirmedCount: item.confirmed_count,
    actorIsRecipient: item.actor_is_recipient,
    actorReadAt: item.actor_read_at,
    actorConfirmedAt: item.actor_confirmed_at,
    attachmentCount: item.attachment_count,
    recipients: item.recipients.map((recipient) => ({
      userId: recipient.user_id,
      displayName: recipient.display_name,
      employeeCode: recipient.employee_code,
      profileKind: recipient.profile_kind,
      roleNames: recipient.role_names,
      readAt: recipient.read_at,
      confirmedAt: recipient.confirmed_at,
    })),
  };
}

export function projectConsultantMessageSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  expectedCanManage: boolean;
  demo: boolean;
}): ConsultantMessageSnapshot {
  const parsed = snapshotSchema.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success ||
      parsed.data.organization_id !== organization.data ||
      parsed.data.branch_id !== branch.data ||
      parsed.data.can_manage !== input.expectedCanManage ||
      parsed.data.message_total < parsed.data.items.length ||
      parsed.data.items_truncated !==
        (parsed.data.message_total > parsed.data.items.length) ||
      parsed.data.today_total > parsed.data.message_total ||
      parsed.data.attachment_total !== 0 ||
      (!parsed.data.can_manage && parsed.data.recipient_options.length > 0) ||
      !unique(parsed.data.items.map((item) => item.message_id)) ||
      !unique(parsed.data.recipient_options.map((option) => option.user_id)) ||
      parsed.data.recipient_options.some((option) =>
        !unique(option.role_names)
      )) invalid();
  const items = parsed.data.items.map((item) =>
    projectItem(item, parsed.data.can_manage)
  );
  return {
    organizationId: parsed.data.organization_id,
    branchId: parsed.data.branch_id,
    generatedAt: parsed.data.generated_at,
    staleAfter: new Date(
      new Date(parsed.data.generated_at).getTime() + 60_000,
    ).toISOString(),
    items,
    metrics: {
      messages: parsed.data.message_total,
      unread: parsed.data.unread_total,
      today: parsed.data.today_total,
      attachments: parsed.data.attachment_total,
      pendingConfirmations: parsed.data.confirmation_pending_total,
    },
    itemsTruncated: parsed.data.items_truncated,
    canManage: parsed.data.can_manage,
    recipientOptions: parsed.data.recipient_options.map((option) => ({
      userId: option.user_id,
      displayName: option.display_name,
      employeeCode: option.employee_code,
      profileKind: option.profile_kind,
      roleNames: option.role_names,
    })),
    categoryBoundary: parsed.data.category_boundary,
    deliveryBoundary: parsed.data.delivery_boundary,
    attachmentPipelineStatus: parsed.data.attachment_pipeline_status,
    attachmentScanStatus: parsed.data.attachment_scan_status,
    demo: input.demo,
  };
}
