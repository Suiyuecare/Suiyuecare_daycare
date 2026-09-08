export const INSULIN_STATES = [
  "scheduled", "late_authorized", "pending_review", "completed",
] as const;
export const INSULIN_ACTIONS = ["authorize_late", "execute", "review"] as const;
export const INSULIN_SHIFTS = ["all", "morning", "afternoon", "evening"] as const;
export const INSULIN_STATE_FILTERS = [...INSULIN_STATES, "all", "late"] as const;

export type InsulinState = (typeof INSULIN_STATES)[number];
export type InsulinAction = (typeof INSULIN_ACTIONS)[number];
export type InsulinShift = (typeof INSULIN_SHIFTS)[number];
export type InsulinStateFilter = (typeof INSULIN_STATE_FILTERS)[number];

export type InsulinFilters = {
  serviceDate: string;
  shift: InsulinShift;
  clientId: string | null;
  state: InsulinStateFilter;
};

export type InsulinClientOption = {
  clientId: string;
  clientCode: string;
  displayName: string;
};

export type InsulinHistoryEntry = {
  eventId: string;
  eventSequence: number;
  previousEventId: string | null;
  eventKind: "late_authorized" | "executed" | "reviewed";
  state: Exclude<InsulinState, "scheduled">;
  occurredAt: string;
  actorDisplayName: string;
  contentHash: string;
};

export type InsulinAdministrationItem = {
  medicationPlanId: string;
  medicationPlanVersion: number;
  medicationPlanContentHash: string;
  clientId: string;
  clientCode: string;
  clientDisplayName: string;
  medicationName: string;
  orderedDoseText: string;
  doseUnit: string;
  medicationRoute: string;
  scheduledFor: string;
  eventId: string | null;
  administrationKey: string | null;
  eventSequence: number;
  previousEventId: string | null;
  state: InsulinState;
  eventKind: InsulinHistoryEntry["eventKind"] | null;
  actualDoseText: string | null;
  actualDoseUnit: string | null;
  siteCode: string | null;
  siteText: string | null;
  executedAt: string | null;
  executorUserId: string | null;
  executorDisplayName: string | null;
  lateEntry: boolean;
  lateReason: string | null;
  lateAuthorizedAt: string | null;
  lateAuthorizerUserId: string | null;
  lateAuthorizerDisplayName: string | null;
  reviewedAt: string | null;
  reviewerUserId: string | null;
  reviewerDisplayName: string | null;
  contentHash: string | null;
  isLate: boolean;
  history: readonly InsulinHistoryEntry[];
};

export type InsulinAdministrationSnapshot = {
  organizationId: string;
  organizationName: string;
  branchId: string;
  branchName: string;
  generatedAt: string;
  staleAfter: string;
  serviceDate: string;
  snapshotToken: string;
  items: readonly InsulinAdministrationItem[];
  metrics: {
    matching: number;
    scheduled: number;
    lateAuthorized: number;
    pendingReview: number;
    completed: number;
    lateException: number;
  };
  itemsTruncated: boolean;
  clientOptions: readonly InsulinClientOption[];
  governanceStatus: "not_configured" | "published";
  planDesignationStatus: "not_configured" | "published";
  qualificationStatus: "not_configured" | "published";
  doseRuleStatus: "not_configured" | "published";
  lateEntryRuleStatus: "not_configured" | "published";
  canExecute: boolean;
  canReview: boolean;
  canAuthorizeLate: boolean;
  offlineStatus: "not_configured";
  attachmentStatus: "not_configured";
  externalDeliveryStatus: "not_configured";
  deliveryClaim: "no_external_delivery_claim";
  demo: boolean;
};

type InsulinMutationBase = { idempotencyKey: string };
export type InsulinLateAuthorizationInput = InsulinMutationBase & {
  action: "authorize_late";
  administrationKey: null;
  previousEventId: null;
  expectedSequence: 0;
  medicationPlanId: string;
  scheduledFor: string;
  lateReason: string;
};
export type InsulinExecutionInput = InsulinMutationBase & {
  action: "execute";
  administrationKey: string | null;
  previousEventId: string | null;
  expectedSequence: 0 | 1;
  medicationPlanId: string;
  scheduledFor: string;
  doseText: string;
  doseUnit: string;
  siteCode: string;
  siteText: string;
};
export type InsulinReviewInput = InsulinMutationBase & {
  action: "review";
  administrationKey: string;
  previousEventId: string;
  expectedSequence: number;
};
export type InsulinMutationInput =
  | InsulinLateAuthorizationInput | InsulinExecutionInput | InsulinReviewInput;

export type InsulinOperationResult = {
  organizationId: string;
  branchId: string;
  operationId: string;
  operationKind: InsulinAction;
  administrationKey: string;
  eventId: string;
  eventSequence: number;
  previousEventId: string | null;
  state: Exclude<InsulinState, "scheduled">;
  medicationPlanId: string;
  governanceVersionId: string;
  scheduledFor: string;
  executedAt: string | null;
  reviewedAt: string | null;
  contentHash: string;
  qualificationStatus: "published";
  doseRuleStatus: "published";
  lateEntryRuleStatus: "published";
  completionStatus: "pending_independent_review" | "completed";
  offlineStatus: "not_configured";
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
