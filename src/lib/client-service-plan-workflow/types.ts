export const CLIENT_SERVICE_PLAN_ACTIONS = [
  "create_draft", "revise_draft", "approve", "sign", "void",
] as const;
export const CLIENT_SERVICE_PLAN_STATUSES = ["draft", "approved", "signed", "voided"] as const;
export const CLIENT_SERVICE_PLAN_STATUS_FILTERS = [
  "all", ...CLIENT_SERVICE_PLAN_STATUSES, "needs_mapping", "authorization_outdated", "review_due",
] as const;

export type ClientServicePlanAction = (typeof CLIENT_SERVICE_PLAN_ACTIONS)[number];
export type ClientServicePlanStatus = (typeof CLIENT_SERVICE_PLAN_STATUSES)[number];
export type ClientServicePlanStatusFilter = (typeof CLIENT_SERVICE_PLAN_STATUS_FILTERS)[number];

export type ClientServicePlanGoalInput = {
  goalId: string;
  itemOrder: number;
  goal: string;
  targetOutcome: string;
};

export type ClientServicePlanMeasureInput = {
  measureId: string;
  itemOrder: number;
  goalId: string;
  measure: string;
  frequency: string;
  responsibleUserId: string;
};

export type ClientServicePlanGoal = ClientServicePlanGoalInput;
export type ClientServicePlanMeasure = ClientServicePlanMeasureInput & {
  responsibleDisplayName: string;
  qualificationStatus: "active_membership_only";
};

export type ClientServicePlanFilters = {
  clientId: string | null;
  status: ClientServicePlanStatusFilter;
  asOf: string;
  query: string | null;
};

export type ClientServicePlanContentInput = {
  effectiveFrom: string;
  effectiveTo: string;
  reviewDueOn: string;
  responsibleUserId: string;
  goals: readonly ClientServicePlanGoalInput[];
  plannedServices: readonly ClientServicePlanMeasureInput[];
};

type ClientServicePlanMutationBase = {
  action: ClientServicePlanAction;
  clientId: string;
  planKey: string;
  expectedTerminalId: string | null;
  expectedTerminalVersion: number;
  expectedTerminalPayloadHash: string | null;
  expectedAuthorizedCarePlanId: string;
  expectedAuthorizedContentHash: string;
  reason: string;
  idempotencyKey: string;
};

export type ClientServicePlanContentMutationInput = ClientServicePlanMutationBase &
  ClientServicePlanContentInput & { action: "create_draft" | "revise_draft" };

export type ClientServicePlanStateMutationInput = ClientServicePlanMutationBase & {
  action: "approve" | "sign" | "void";
  effectiveFrom: null;
  effectiveTo: null;
  reviewDueOn: null;
  responsibleUserId: null;
  goals: null;
  plannedServices: null;
};

export type ClientServicePlanMutationInput =
  | ClientServicePlanContentMutationInput
  | ClientServicePlanStateMutationInput;

export type ClientServicePlanPersistedPayload = {
  schemaVersion: 1;
  organizationId: string;
  branchId: string;
  clientId: string;
  planKey: string;
  version: number;
  previousVersionId: string | null;
  status: ClientServicePlanStatus;
  authorizedCarePlanId: string;
  authorizedContentHash: string;
  effectiveFrom: string;
  effectiveTo: string;
  reviewDueOn: string;
  responsibleUserId: string;
  sourceSystem: "local";
  sourceRecordId: null;
  sourceProvenance: {
    schemaVersion: 1;
    sourceSystem: "local";
    captureMethod: "staff_entry";
    authority: "facility";
    workflow: "page52_client_service_plan_v1";
    legalRuleStatus: "not_configured";
    claimEligibilityStatus: "blocked_not_configured";
  };
  goals: readonly ClientServicePlanGoal[];
  plannedServices: readonly ClientServicePlanMeasure[];
  reason: string;
};

export type ClientServicePlanReceipt = {
  operationId: string;
  action: ClientServicePlanAction;
  planId: string;
  planKey: string;
  version: number;
  previousVersionId: string | null;
  status: ClientServicePlanStatus;
  clientId: string;
  authorizedCarePlanId: string;
  authorizedContentHash: string;
  previousPayloadHash: string | null;
  payloadHash: string;
  persistedPayload: ClientServicePlanPersistedPayload;
  committedAt: string;
  replayed: boolean;
  legalRuleStatus: "not_configured";
  claimEligibilityStatus: "blocked_not_configured";
  persisted: true;
  demo: false;
};

export type ClientServicePlanVersion = Omit<ClientServicePlanPersistedPayload,
  "organizationId" | "branchId" | "sourceSystem" | "sourceRecordId" | "sourceProvenance" |
  "goals" | "plannedServices" | "reason"> & {
  planId: string;
  payloadHash: string;
  sourceSystem: string;
  sourceRecordId: string | null;
  sourceProvenance: unknown;
  goals: readonly ClientServicePlanGoal[];
  plannedServices: readonly ClientServicePlanMeasure[];
  reason: string | null;
  contentMappingStatus: "configured" | "needs_mapping";
  unmappedContent: { goals: unknown; plannedServices: unknown } | null;
  authorizedPlanKey: string;
  authorizedVersion: number;
  authorizedSourceSystem: string;
  authorizedSourceRecordId: string | null;
  authorizationStatus: "current" | "outdated" | "voided" | "period_mismatch";
  operationalStatus: "signed_current" | "not_executable";
  responsibleDisplayName: string | null;
  createdBy: string;
  createdByDisplayName: string;
  createdAt: string;
  approvedBy: string | null;
  approvedByDisplayName: string | null;
  approvedAt: string | null;
  signedBy: string | null;
  signedByDisplayName: string | null;
  signedAt: string | null;
  signaturePurpose: string | null;
  reauthChallengeId: string | null;
};

export type ClientServicePlan = ClientServicePlanVersion & {
  clientDisplayName: string;
  clientCode: string;
  publishedPlanId: string | null;
  publishedVersion: number | null;
  publishedPayloadHash: string | null;
  publishedStatus: "signed" | "voided" | null;
  streamOperationalStatus: "signed_current" | "not_executable";
  history: readonly ClientServicePlanVersion[];
  historyTotal: number;
  historyTruncated: boolean;
};

export type ClientServicePlanClientOption = {
  clientId: string;
  displayName: string;
  clientCode: string;
  serviceStatus: "active" | "suspended" | "transferred" | "closed" | "deceased";
  canManage: boolean;
};

export type ClientServicePlanStaffOption = {
  userId: string;
  displayName: string;
  qualificationStatus: "active_membership_only";
};

export type ClientServicePlanAuthorizationOption = {
  authorizedCarePlanId: string;
  clientId: string;
  planKey: string;
  version: number;
  contentHash: string;
  effectiveFrom: string;
  effectiveTo: string;
  sourceSystem: string;
  sourceRecordId: string | null;
  status: "current";
};

export type ClientServicePlanSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  asOf: string;
  filters: ClientServicePlanFilters;
  plans: readonly ClientServicePlan[];
  matchingTotal: number;
  plansTruncated: boolean;
  historyReturnedTotal: number;
  historyMaximum: 500;
  historyTruncated: boolean;
  metrics: {
    planTotal: number;
    draftTotal: number;
    approvedTotal: number;
    signedTotal: number;
    voidedTotal: number;
    reviewDueTotal: number;
    needsMappingTotal: number;
    outdatedAuthorizationTotal: number;
    executableTotal: number;
  };
  clients: readonly ClientServicePlanClientOption[];
  clientTotal: number;
  clientsTruncated: boolean;
  staff: readonly ClientServicePlanStaffOption[];
  staffTotal: number;
  staffTruncated: boolean;
  authorizations: readonly ClientServicePlanAuthorizationOption[];
  authorizationTotal: number;
  authorizationsTruncated: boolean;
  officialQualificationRuleStatus: "not_configured";
  legalRuleStatus: "not_configured";
  claimEligibilityStatus: "blocked_not_configured";
  claimEligibilityReason: "official_service_codes_rates_and_qualification_rules_not_configured";
  offlineStatus: "not_configured";
  exportStatus: "not_configured";
  demo: boolean;
};
