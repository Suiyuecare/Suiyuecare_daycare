import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { staffPages } from "@/lib/catalog";

import {
  NOTIFICATION_DELIVERY_STATUSES,
  type NotificationCenterFilters,
  type NotificationCenterItem,
  type NotificationCenterSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z
  .string()
  .refine(
    (value) =>
      isStrictOffsetDateTime(value) &&
      Number.isFinite(new Date(value).getTime()),
    "timestamp",
  )
  .transform((value) => new Date(value).toISOString());
const optionalTimestamp = timestamp.nullable();
const nonNegativeInteger = z.union([
  z.number().int().nonnegative().safe(),
  z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const itemSchema = z
  .object({
    delivery_id: uuid,
    notification_id: uuid,
    category: z.string().trim().min(1).max(80),
    priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(240),
    source_type: z.string().trim().min(1).max(80).nullable(),
    source_id: z.string().trim().min(1).max(200).nullable(),
    available_at: timestamp,
    status: z.enum(NOTIFICATION_DELIVERY_STATUSES),
    read_at: optionalTimestamp,
    confirmed_at: optionalTimestamp,
    requires_confirmation: z.boolean(),
  })
  .strict();
const sourceSchema = z
  .object({
    organization_id: uuid,
    branch_id: uuid,
    generated_at: timestamp,
    items: z.array(itemSchema).max(200),
    item_total: nonNegativeInteger,
    unread_total: nonNegativeInteger,
    confirmation_pending_total: nonNegativeInteger,
    today_total: nonNegativeInteger,
    items_truncated: z.boolean(),
    confirmation_rule_status: z.literal("technical_priority_3_only"),
  })
  .strict();

const sourcePageNumbers: Readonly<Record<string, number>> = Object.freeze({
  attendance: 46,
  attendance_event: 46,
  medication: 7,
  medication_administration: 7,
  client_tocc: 9,
  claim: 49,
  claim_batch: 49,
  service_event: 53,
  client: 60,
  client_transition: 61,
  calendar: 44,
});

export type NotificationCenterSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_NOTIFICATION_CENTER_PROJECTION");
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
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function notificationSourceHref(
  sourceType: string | null,
  sourceId: string | null,
) {
  if (!sourceType || !sourceId || !z.uuid().safeParse(sourceId).success) {
    return null;
  }
  const pageNumber = sourcePageNumbers[sourceType];
  const page = staffPages.find((candidate) => candidate.number === pageNumber);
  if (!page) return null;
  const params = new URLSearchParams({ source: sourceId.toLowerCase() });
  return `/app/${page.slug}?${params.toString()}`;
}

function isUnread(item: NotificationCenterItem) {
  return (
    item.readAt === null &&
    (item.status === "queued" ||
      item.status === "sent" ||
      item.status === "delivered")
  );
}

export function isConfirmationPending(item: NotificationCenterItem) {
  return (
    item.requiresConfirmation &&
    item.confirmedAt === null &&
    (item.status === "queued" ||
      item.status === "sent" ||
      item.status === "delivered" ||
      item.status === "read")
  );
}

function normalizeItem(value: z.output<typeof itemSchema>): NotificationCenterItem {
  const hasTerminalEvidence = value.read_at !== null || value.confirmed_at !== null;
  const deliveryStillPending = [
    "queued",
    "sent",
    "delivered",
    "failed",
    "suppressed",
  ].includes(value.status);
  if (
    value.requires_confirmation !== (value.priority === 3) ||
    (deliveryStillPending && hasTerminalEvidence) ||
    (value.status === "confirmed" &&
      (!value.requires_confirmation ||
        value.read_at === null ||
        value.confirmed_at === null)) ||
    (value.status === "read" &&
      (value.read_at === null || value.confirmed_at !== null)) ||
    (value.confirmed_at !== null && value.read_at === null) ||
    (value.read_at !== null && value.read_at > (value.confirmed_at ?? value.read_at))
  ) {
    invalid();
  }
  return {
    deliveryId: value.delivery_id,
    notificationId: value.notification_id,
    category: value.category,
    priority: value.priority,
    title: value.title,
    body: value.body,
    sourceType: value.source_type,
    sourceId: value.source_id,
    sourceHref: notificationSourceHref(value.source_type, value.source_id),
    availableAt: value.available_at,
    status: value.status,
    readAt: value.read_at,
    confirmedAt: value.confirmed_at,
    requiresConfirmation: value.requires_confirmation,
  };
}

export function projectNotificationCenterSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): NotificationCenterSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const expectedOrganization = uuid.safeParse(input.expectedOrganizationId);
  const expectedBranch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !expectedOrganization.success || !expectedBranch.success) {
    invalid();
  }
  const row = parsed.data;
  if (
    row.organization_id !== expectedOrganization.data ||
    row.branch_id !== expectedBranch.data
  ) {
    invalid();
  }
  const items = row.items.map(normalizeItem);
  if (
    !unique(items.map((item) => item.deliveryId)) ||
    !unique(items.map((item) => item.notificationId)) ||
    row.item_total < items.length ||
    row.unread_total > row.item_total ||
    row.confirmation_pending_total > row.item_total ||
    row.today_total > row.item_total ||
    row.items_truncated !== (row.item_total > items.length) ||
    (!row.items_truncated && row.item_total !== items.length) ||
    items.some((item) => item.availableAt > row.generated_at) ||
    items.filter(isConfirmationPending).length !==
      Math.min(row.confirmation_pending_total, items.length)
  ) {
    invalid();
  }
  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(
      new Date(row.generated_at).getTime() + 60_000,
    ).toISOString(),
    items,
    itemTotal: row.item_total,
    unreadTotal: row.unread_total,
    confirmationPendingTotal: row.confirmation_pending_total,
    todayTotal: row.today_total,
    overdueTotal: null,
    itemsTruncated: row.items_truncated,
    confirmationRuleStatus: row.confirmation_rule_status,
    demo: input.demo,
  };
}

export function filterNotificationCenterSnapshot(
  snapshot: NotificationCenterSnapshot,
  filters: NotificationCenterFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase("zh-TW");
  return {
    ...snapshot,
    items: snapshot.items.filter((item) => {
      const matchesQuery =
        !query ||
        `${item.title} ${item.category}`
          .toLocaleLowerCase("zh-TW")
          .includes(query);
      const matchesStatus =
        filters.status === "all" ||
        (filters.status === "unread" && isUnread(item)) ||
        (filters.status === "confirmation_pending" &&
          isConfirmationPending(item)) ||
        (filters.status === "confirmed" && item.status === "confirmed");
      const matchesCategory =
        filters.category === "all" || item.category === filters.category;
      const matchesPriority =
        filters.priority === "all" ||
        item.priority === Number(filters.priority);
      const matchesDate =
        filters.date === null || taipeiDate(item.availableAt) === filters.date;
      return (
        matchesQuery &&
        matchesStatus &&
        matchesCategory &&
        matchesPriority &&
        matchesDate
      );
    }),
  };
}
