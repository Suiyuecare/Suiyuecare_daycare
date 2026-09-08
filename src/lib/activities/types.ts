export const ACTIVITY_STATUSES = [
  "scheduled", "in_progress", "completed", "cancelled",
] as const;

export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export type ActivityStatusFilter = "all" | ActivityStatus;

export type ActivityParticipant = {
  clientId: string;
  displayName: string;
  clientStatus: string;
};

export type ActivityStaffOption = {
  userId: string;
  displayName: string;
  employeeCode: string | null;
  membershipScope: "branch" | "organization";
};

export type ActivityClientOption = {
  clientId: string;
  displayName: string;
  clientCode: string;
};

export type ActivityScheduleHistory = {
  scheduleVersionId: string;
  version: number;
  previousScheduleVersionId: string | null;
  revisionReason: string | null;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  creatorDisplayName: string;
};

export type ActivityStatusHistory = {
  statusEventId: string;
  sequence: number;
  previousStatusEventId: string | null;
  fromStatus: ActivityStatus | null;
  toStatus: ActivityStatus;
  transitionNote: string | null;
  changerDisplayName: string;
  changedAt: string;
  reauthenticated: boolean;
};

export type ActivityItem = {
  activityId: string;
  scheduleVersionId: string;
  scheduleVersion: number;
  previousScheduleVersionId: string | null;
  revisionReason: string | null;
  activityType: string;
  title: string;
  searchSummary: string;
  location: string;
  startsAt: string;
  endsAt: string;
  responsibleUserId: string;
  responsibleDisplayName: string;
  capacity: number;
  participants: readonly ActivityParticipant[];
  participantCount: number;
  statusEventId: string;
  statusSequence: number;
  previousStatusEventId: string | null;
  status: ActivityStatus;
  cancellationReason: string | null;
  createdAt: string;
  scheduleHistoryTotal: number;
  scheduleHistory: readonly ActivityScheduleHistory[];
  statusHistoryTotal: number;
  statusHistory: readonly ActivityStatusHistory[];
};

export type ActivityManagementSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly ActivityItem[];
  matchingTotal: number;
  itemsTruncated: boolean;
  metrics: {
    upcoming: number;
    scheduled: number;
    inProgress: number;
    completed: number;
    cancelled: number;
  };
  staffOptions: readonly ActivityStaffOption[];
  staffTotal: number;
  staffTruncated: boolean;
  clientOptions: readonly ActivityClientOption[];
  clientTotal: number;
  clientTruncated: boolean;
  typeOptions: readonly string[];
  typeTotal: number;
  typeTruncated: boolean;
  pastChangePolicyStatus: "not_configured";
  cancellationNotificationPolicy: "institution_owned_not_configured";
  notificationDelivery: "none_not_sent";
  demo: boolean;
};

export type ActivityFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  activityType: string | null;
  status: ActivityStatusFilter;
  query: string;
  quickClientId: string | null;
};

export type ActivityMutationAction = "create" | "revise" | "start" | "complete" | "cancel";

export type ActivityMutationInput = {
  action: ActivityMutationAction;
  activityId: string | null;
  expectedScheduleVersionId: string | null;
  expectedScheduleVersion: number | null;
  expectedStatusEventId: string | null;
  expectedStatusSequence: number | null;
  activityType: string | null;
  title: string | null;
  searchSummary: string | null;
  location: string | null;
  startsAt: string | null;
  endsAt: string | null;
  responsibleUserId: string | null;
  participantClientIds: readonly string[];
  capacity: number | null;
  reason: string | null;
  idempotencyKey: string;
};

export type ActivityOperationResult = {
  operationId: string;
  operationKind: "create" | "revise" | "transition" | "cancel";
  activityId: string;
  scheduleVersionId: string;
  scheduleVersion: number;
  previousScheduleVersionId: string | null;
  statusEventId: string;
  statusSequence: number;
  previousStatusEventId: string | null;
  status: ActivityStatus;
  responsibleUserId: string;
  participantClientIds: readonly string[];
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
