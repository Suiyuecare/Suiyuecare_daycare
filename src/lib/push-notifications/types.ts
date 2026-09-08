import type { DeliveryStatus } from "@/lib/domain/types";

export const PUSH_NOTIFICATION_STAFF_KINDS = [
  "staff",
  "professional",
  "driver",
  "finance",
] as const;

export type PushNotificationStaffKind =
  (typeof PUSH_NOTIFICATION_STAFF_KINDS)[number];

export type PushNotificationRecipient = {
  userId: string;
  displayName: string;
  employeeCode: string | null;
  profileKind: PushNotificationStaffKind;
  membershipScope: "branch" | "organization";
  roleNames: readonly string[];
};

export type PushNotificationHistoryItem = {
  notificationId: string;
  category: string;
  priority: 0 | 1 | 2 | 3;
  title: string;
  body: string;
  notificationStatus: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  scheduledFor: string;
  createdAt: string;
  createdByLabel: string;
  deliveryTotal: number;
  deliveryCounts: Readonly<Record<DeliveryStatus, number>>;
};

export type PushNotificationManagementSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  recipients: readonly PushNotificationRecipient[];
  recipientTotal: number;
  recipientsTruncated: boolean;
  notifications: readonly PushNotificationHistoryItem[];
  notificationTotal: number;
  notificationsTruncated: boolean;
  scheduledTotal: number;
  queuedDeliveryTotal: number;
  readOrConfirmedTotal: number;
  failedDeliveryTotal: number;
  providerBoundary: "in_app_only_no_delivery_worker";
  familyBoundary: "relationship_consent_not_available";
  retryBoundary: "partial_retry_worker_not_available";
  demo: boolean;
};

export const PUSH_NOTIFICATION_HISTORY_STATUS_FILTERS = [
  "all",
  "scheduled",
  "queued",
  "activity",
  "failed",
  "cancelled",
] as const;

export type PushNotificationHistoryStatusFilter =
  (typeof PUSH_NOTIFICATION_HISTORY_STATUS_FILTERS)[number];

export type PushNotificationFilters = {
  query: string;
  category: string;
  status: PushNotificationHistoryStatusFilter;
  date: string | null;
};

export type PushNotificationMode = "preview" | "queue";

export type PushNotificationInput = {
  mode: PushNotificationMode;
  category: string;
  priority: 0 | 1 | 2 | 3;
  title: string;
  body: string;
  recipientUserIds: readonly string[];
  scheduledFor: string | null;
  idempotencyKey: string;
};

export type PushNotificationRecipientPreview = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  recipients: readonly Pick<
    PushNotificationRecipient,
    "userId" | "displayName" | "profileKind"
  >[];
  recipientCount: number;
  channel: "in_app";
  deliveryCount: number;
  scheduled: boolean;
  persisted: false;
  demo: boolean;
};

export type PushNotificationQueueReceipt = {
  notificationId: string;
  deliveryCount: number;
  notificationStatus: "scheduled";
  deliveryStatus: "queued";
  channel: "in_app";
  scheduledFor: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
