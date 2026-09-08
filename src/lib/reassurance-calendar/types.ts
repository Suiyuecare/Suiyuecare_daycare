export const REASSURANCE_CALENDAR_CATEGORIES = [
  "care", "activity", "transport", "appointment", "reminder",
] as const;
export const REASSURANCE_CALENDAR_STATUSES = ["scheduled", "cancelled"] as const;

export type ReassuranceCalendarCategory =
  (typeof REASSURANCE_CALENDAR_CATEGORIES)[number];
export type ReassuranceCalendarStatus =
  (typeof REASSURANCE_CALENDAR_STATUSES)[number];
export type ReassuranceCalendarStatusFilter = "all" | ReassuranceCalendarStatus;

export type ReassuranceCalendarFilters = {
  month: string;
  organizationId: string;
  category: ReassuranceCalendarCategory | null;
  status: ReassuranceCalendarStatusFilter;
  todayOnly: boolean;
  query: string;
};

export type ReassuranceCalendarAudience = {
  targetKind: "branch" | "client";
  targetId: string;
  displayName: string;
  clientCode: string | null;
};

export type ReassuranceCalendarHistory = {
  versionId: string;
  version: number;
  previousVersionId: string | null;
  recordKind: "original" | "revision" | "cancellation";
  reason: string | null;
  status: ReassuranceCalendarStatus;
  publishedAt: string;
  publisherDisplayName: string;
  contentHash: string;
};

export type ReassuranceCalendarItem = {
  versionId: string;
  eventKey: string;
  version: number;
  previousVersionId: string | null;
  recordKind: "original" | "revision" | "cancellation";
  revisionReason: string | null;
  category: ReassuranceCalendarCategory;
  title: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  location: string;
  audienceKind: "all_branch_clients" | "selected_clients";
  audience: readonly ReassuranceCalendarAudience[];
  responsibleUserId: string;
  responsibleDisplayName: string;
  status: ReassuranceCalendarStatus;
  cancellationReason: string | null;
  publicationState: "published";
  publisherDisplayName: string;
  publishedAt: string;
  signatureStatus: "not_configured";
  notificationStatus: "not_configured";
  notificationDelivery: "none_not_sent";
  history: readonly ReassuranceCalendarHistory[];
};

export type ReassuranceCalendarDay = {
  date: string;
  day: number;
  inMonth: true;
  events: readonly ReassuranceCalendarItem[];
};

export type ReassuranceCalendarStaffOption = {
  userId: string;
  displayName: string;
};
export type ReassuranceCalendarClientOption = {
  clientId: string;
  displayName: string;
  clientCode: string;
};

export type ReassuranceCalendarSnapshot = {
  organizationId: string;
  organizationName: string;
  branchId: string;
  branchName: string;
  generatedAt: string;
  staleAfter: string;
  snapshotToken: string;
  monthStart: string;
  items: readonly ReassuranceCalendarItem[];
  calendarDays: readonly ReassuranceCalendarDay[];
  matchingTotal: number;
  metrics: {
    scheduled: number;
    cancelled: number;
    today: number;
    upcoming: number;
  };
  itemsTruncated: boolean;
  categoryOptions: readonly ReassuranceCalendarCategory[];
  staffOptions: readonly ReassuranceCalendarStaffOption[];
  clientOptions: readonly ReassuranceCalendarClientOption[];
  canManage: boolean;
  canCancel: boolean;
  publicationBoundary: "published_versions_only";
  signatureStatus: "not_configured";
  notificationStatus: "not_configured";
  notificationDelivery: "none_not_sent";
  demo: boolean;
};

type MutationChain = {
  eventKey: string | null;
  previousVersionId: string | null;
  expectedVersion: number | null;
};

export type ReassuranceCalendarMutationInput = MutationChain & {
  action: "create" | "revise" | "cancel";
  category: ReassuranceCalendarCategory | null;
  title: string | null;
  summary: string | null;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  audienceKind: "all_branch_clients" | "selected_clients" | null;
  targetClientIds: readonly string[];
  responsibleUserId: string | null;
  reason: string | null;
  idempotencyKey: string;
};

export type ReassuranceCalendarOperationResult = {
  operationId: string;
  operationKind: "create" | "revise" | "cancel";
  eventKey: string;
  versionId: string;
  eventVersion: number;
  previousVersionId: string | null;
  recordKind: "original" | "revision" | "cancellation";
  eventStatus: ReassuranceCalendarStatus;
  eventCategory: ReassuranceCalendarCategory;
  audienceCount: number;
  publicationState: "published";
  signatureStatus: "not_configured";
  notificationStatus: "not_configured";
  notificationDelivery: "none_not_sent";
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
