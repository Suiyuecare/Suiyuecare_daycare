import type { DeliveryStatus } from "@/lib/domain/types";

export const NOTIFICATION_DELIVERY_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "read",
  "confirmed",
  "failed",
  "suppressed",
] as const satisfies readonly DeliveryStatus[];

export const NOTIFICATION_CENTER_STATUS_FILTERS = [
  "all",
  "unread",
  "confirmation_pending",
  "confirmed",
] as const;

export type NotificationCenterStatusFilter =
  (typeof NOTIFICATION_CENTER_STATUS_FILTERS)[number];
export type NotificationCenterPriorityFilter = "all" | "0" | "1" | "2" | "3";

export type NotificationCenterItem = {
  deliveryId: string;
  notificationId: string;
  category: string;
  priority: 0 | 1 | 2 | 3;
  title: string;
  body: string;
  sourceType: string | null;
  sourceId: string | null;
  sourceHref: string | null;
  availableAt: string;
  status: DeliveryStatus;
  readAt: string | null;
  confirmedAt: string | null;
  requiresConfirmation: boolean;
};

export type NotificationCenterSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly NotificationCenterItem[];
  itemTotal: number;
  unreadTotal: number;
  confirmationPendingTotal: number;
  todayTotal: number;
  overdueTotal: null;
  itemsTruncated: boolean;
  confirmationRuleStatus: "technical_priority_3_only";
  demo: boolean;
};

export type NotificationCenterFilters = {
  query: string;
  status: NotificationCenterStatusFilter;
  category: string;
  priority: NotificationCenterPriorityFilter;
  date: string | null;
};

export type NotificationAcknowledgementTarget = "read" | "confirmed";

export type NotificationAcknowledgementInput = {
  deliveryId: string;
  targetStatus: NotificationAcknowledgementTarget;
  idempotencyKey: string;
};

export type NotificationAcknowledgementResult = {
  operationId: string;
  deliveryId: string;
  notificationId: string;
  status: NotificationAcknowledgementTarget;
  readAt: string;
  confirmedAt: string | null;
  acknowledgedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
