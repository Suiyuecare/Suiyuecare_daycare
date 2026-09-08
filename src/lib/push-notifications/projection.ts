import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { NOTIFICATION_DELIVERY_STATUSES } from "@/lib/notification-center/types";

import {
  PUSH_NOTIFICATION_STAFF_KINDS,
  type PushNotificationHistoryItem,
  type PushNotificationFilters,
  type PushNotificationManagementSnapshot,
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
const nonNegativeInteger = z.union([
  z.number().int().nonnegative().safe(),
  z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const text = (max: number) => z.string().trim().min(1).max(max);

const recipientSchema = z
  .object({
    user_id: uuid,
    display_name: text(120),
    employee_code: z.string().trim().max(120).nullable(),
    profile_kind: z.enum(PUSH_NOTIFICATION_STAFF_KINDS),
    membership_scope: z.enum(["branch", "organization"]),
    role_names: z.array(text(120)).max(50),
  })
  .strict();

const historySchema = z
  .object({
    notification_id: uuid,
    category: text(80),
    priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    title: text(80),
    body: text(240),
    notification_status: z.enum([
      "draft",
      "scheduled",
      "sending",
      "sent",
      "cancelled",
    ]),
    scheduled_for: timestamp,
    created_at: timestamp,
    created_by_label: text(120),
    delivery_total: nonNegativeInteger,
    queued_count: nonNegativeInteger,
    sent_count: nonNegativeInteger,
    delivered_count: nonNegativeInteger,
    read_count: nonNegativeInteger,
    confirmed_count: nonNegativeInteger,
    failed_count: nonNegativeInteger,
    suppressed_count: nonNegativeInteger,
  })
  .strict();

const sourceSchema = z
  .object({
    organization_id: uuid,
    branch_id: uuid,
    generated_at: timestamp,
    recipients: z.array(recipientSchema).max(500),
    recipient_total: nonNegativeInteger,
    recipients_truncated: z.boolean(),
    notifications: z.array(historySchema).max(100),
    notification_total: nonNegativeInteger,
    notifications_truncated: z.boolean(),
    scheduled_total: nonNegativeInteger,
    queued_delivery_total: nonNegativeInteger,
    read_or_confirmed_total: nonNegativeInteger,
    failed_delivery_total: nonNegativeInteger,
    provider_boundary: z.literal("in_app_only_no_delivery_worker"),
    family_boundary: z.literal("relationship_consent_not_available"),
    retry_boundary: z.literal("partial_retry_worker_not_available"),
  })
  .strict();

export type PushNotificationSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_PUSH_NOTIFICATION_MANAGEMENT_PROJECTION");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

export function projectPushNotificationManagementSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): PushNotificationManagementSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const expectedOrganizationId = uuid.safeParse(input.expectedOrganizationId);
  const expectedBranchId = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !expectedOrganizationId.success || !expectedBranchId.success) {
    invalid();
  }
  const row = parsed.data;
  if (
    row.organization_id !== expectedOrganizationId.data ||
    row.branch_id !== expectedBranchId.data ||
    row.recipient_total < row.recipients.length ||
    row.notification_total < row.notifications.length ||
    row.recipients_truncated !== (row.recipient_total > row.recipients.length) ||
    row.notifications_truncated !==
      (row.notification_total > row.notifications.length) ||
    !unique(row.recipients.map((recipient) => recipient.user_id)) ||
    !unique(row.notifications.map((notification) => notification.notification_id))
  ) {
    invalid();
  }

  for (const recipient of row.recipients) {
    if (!unique(recipient.role_names)) invalid();
  }

  let previousCreatedAt: string | null = null;
  const notifications: PushNotificationHistoryItem[] = row.notifications.map(
    (notification) => {
      const counts = {
        queued: notification.queued_count,
        sent: notification.sent_count,
        delivered: notification.delivered_count,
        read: notification.read_count,
        confirmed: notification.confirmed_count,
        failed: notification.failed_count,
        suppressed: notification.suppressed_count,
      };
      if (
        Object.values(counts).reduce((sum, count) => sum + count, 0) !==
          notification.delivery_total ||
        (previousCreatedAt !== null && notification.created_at > previousCreatedAt)
      ) {
        invalid();
      }
      previousCreatedAt = notification.created_at;
      return {
        notificationId: notification.notification_id,
        category: notification.category,
        priority: notification.priority,
        title: notification.title,
        body: notification.body,
        notificationStatus: notification.notification_status,
        scheduledFor: notification.scheduled_for,
        createdAt: notification.created_at,
        createdByLabel: notification.created_by_label,
        deliveryTotal: notification.delivery_total,
        deliveryCounts: counts,
      };
    },
  );

  const loadedQueued = notifications.reduce(
    (sum, notification) => sum + notification.deliveryCounts.queued,
    0,
  );
  const loadedReadOrConfirmed = notifications.reduce(
    (sum, notification) =>
      sum + notification.deliveryCounts.read + notification.deliveryCounts.confirmed,
    0,
  );
  const loadedFailed = notifications.reduce(
    (sum, notification) => sum + notification.deliveryCounts.failed,
    0,
  );
  const generatedAt = new Date(row.generated_at);
  const loadedScheduled = notifications.filter(
    (notification) =>
      notification.notificationStatus === "scheduled" &&
      new Date(notification.scheduledFor) > generatedAt,
  ).length;
  if (
    row.scheduled_total > row.notification_total ||
    row.scheduled_total < loadedScheduled ||
    row.queued_delivery_total < loadedQueued ||
    row.read_or_confirmed_total < loadedReadOrConfirmed ||
    row.failed_delivery_total < loadedFailed ||
    (!row.notifications_truncated &&
      (row.scheduled_total !== loadedScheduled ||
        row.queued_delivery_total !== loadedQueued ||
        row.read_or_confirmed_total !== loadedReadOrConfirmed ||
        row.failed_delivery_total !== loadedFailed))
  ) {
    invalid();
  }

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(new Date(row.generated_at).getTime() + 60_000).toISOString(),
    recipients: row.recipients.map((recipient) => ({
      userId: recipient.user_id,
      displayName: recipient.display_name,
      employeeCode: recipient.employee_code,
      profileKind: recipient.profile_kind,
      membershipScope: recipient.membership_scope,
      roleNames: recipient.role_names,
    })),
    recipientTotal: row.recipient_total,
    recipientsTruncated: row.recipients_truncated,
    notifications,
    notificationTotal: row.notification_total,
    notificationsTruncated: row.notifications_truncated,
    scheduledTotal: row.scheduled_total,
    queuedDeliveryTotal: row.queued_delivery_total,
    readOrConfirmedTotal: row.read_or_confirmed_total,
    failedDeliveryTotal: row.failed_delivery_total,
    providerBoundary: row.provider_boundary,
    familyBoundary: row.family_boundary,
    retryBoundary: row.retry_boundary,
    demo: input.demo,
  };
}

export const PUSH_NOTIFICATION_DELIVERY_STATUSES = NOTIFICATION_DELIVERY_STATUSES;

function taipeiDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function filterPushNotificationHistory(
  snapshot: PushNotificationManagementSnapshot,
  filters: PushNotificationFilters,
  now = new Date(),
) {
  const query = filters.query.trim().toLocaleLowerCase("zh-TW");
  return snapshot.notifications.filter((notification) => {
    const counts = notification.deliveryCounts;
    const matchesStatus =
      filters.status === "all" ||
      (filters.status === "scheduled" &&
        notification.notificationStatus === "scheduled" &&
        new Date(notification.scheduledFor) > now) ||
      (filters.status === "queued" && counts.queued > 0) ||
      (filters.status === "activity" &&
        counts.sent + counts.delivered + counts.read + counts.confirmed > 0) ||
      (filters.status === "failed" && counts.failed > 0) ||
      (filters.status === "cancelled" &&
        notification.notificationStatus === "cancelled");
    return (
      matchesStatus &&
      (filters.category === "all" ||
        notification.category === filters.category) &&
      (filters.date === null || taipeiDate(notification.scheduledFor) === filters.date) &&
      (!query ||
        `${notification.title} ${notification.category} ${notification.createdByLabel}`
          .toLocaleLowerCase("zh-TW")
          .includes(query))
    );
  });
}
