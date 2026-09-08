export const AUTHORIZED_CARE_PLAN_EFFECTIVE_STATES = [
  "all",
  "current",
  "future",
  "expired",
  "voided",
  "not_published",
] as const;

export const AUTHORIZED_CARE_PLAN_STATUSES = [
  "draft",
  "approved",
  "signed",
  "voided",
] as const;

export const AUTHORIZED_CARE_PLAN_CHANGED_FIELDS = [
  "status",
  "effective_from",
  "effective_to",
  "source_system",
  "source_record_id",
  "source_provenance",
  "authorized_on",
  "authorization_reference",
  "service_limits",
  "plan_data",
  "correction_reason",
  "approved_at",
  "signed_at",
  "content_hash",
] as const;

export type AuthorizedCarePlanEffectiveState =
  (typeof AUTHORIZED_CARE_PLAN_EFFECTIVE_STATES)[number];
export type AuthorizedCarePlanStatus =
  (typeof AUTHORIZED_CARE_PLAN_STATUSES)[number];
export type AuthorizedCarePlanChangedField =
  (typeof AUTHORIZED_CARE_PLAN_CHANGED_FIELDS)[number];

export type AuthorizedCarePlanFilters = {
  asOf: string;
  clientId: string | null;
  authorizedFrom: string | null;
  authorizedTo: string | null;
  effectiveState: AuthorizedCarePlanEffectiveState;
  sourceSystem: string | null;
  page: number;
  pageSize: number;
};

export type CanonicalJsonScalar = string | number | boolean | null;
export type CanonicalJsonValue =
  | CanonicalJsonScalar
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };
export type CanonicalJsonObject = {
  readonly [key: string]: CanonicalJsonValue;
};

export type AuthorizedCarePlanContentEnvelope = {
  valueState: "missing" | "unknown";
  mappingStatus: "missing" | "needs_mapping";
  needsMapping: boolean;
  canonicalJson: string;
  contentHash: string;
  byteSize: number;
  nodeCount: number;
  topLevelFieldCount: number;
};

export type AuthorizedCarePlanProvenanceEnvelope = {
  valueState: "missing" | "recorded";
  canonicalJson: string;
  contentHash: string;
  byteSize: number;
  nodeCount: number;
  topLevelFieldCount: number;
};

export type AuthorizedCarePlanVersionDifference = {
  changedFields: readonly AuthorizedCarePlanChangedField[];
  previousPlanDataHash: string | null;
  previousServiceLimitsHash: string | null;
  previousSourceProvenanceHash: string | null;
};

export type AuthorizedCarePlanVersion = {
  versionId: string;
  planKey: string;
  version: number;
  previousVersionId: string | null;
  nextVersionId: string | null;
  status: AuthorizedCarePlanStatus;
  effectiveFrom: string;
  effectiveTo: string;
  sourceSystem: string;
  sourceRecordId: string | null;
  sourceProvenance: AuthorizedCarePlanProvenanceEnvelope;
  authorizedOn: string | null;
  authorizationReference: string | null;
  serviceLimits: AuthorizedCarePlanContentEnvelope;
  planData: AuthorizedCarePlanContentEnvelope;
  correctionReason: string | null;
  createdAt: string;
  approvedAt: string | null;
  signedAt: string | null;
  contentHash: string | null;
  isWorkflowHead: boolean;
  isPublishedHead: boolean;
  isCurrentPublished: boolean;
  differencesFromPrevious: AuthorizedCarePlanVersionDifference;
};

export type AuthorizedCarePlanHead = {
  versionId: string;
  version: number;
  status: AuthorizedCarePlanStatus;
};

export type AuthorizedCarePlanStream = {
  planKey: string;
  clientId: string;
  clientCode: string;
  displayName: string;
  effectiveState: Exclude<AuthorizedCarePlanEffectiveState, "all">;
  clientCurrentStreamCount: number;
  effectiveConflict: boolean;
  workflowHead: AuthorizedCarePlanHead;
  publishedHead: AuthorizedCarePlanHead | null;
  currentPublishedId: string | null;
  dateTerminalId: string | null;
  dateTerminalStatus: "signed" | "voided" | null;
  displayVersionId: string;
  displayAuthorizedOn: string | null;
  displaySourceSystem: string;
  displaySourceRecordId: string | null;
  displayEffectiveFrom: string;
  displayEffectiveTo: string;
  displayAuthorizationReference: string | null;
  displayNeedsMapping: boolean;
  historyCount: number;
  history: readonly AuthorizedCarePlanVersion[];
};

export type AuthorizedCarePlanClientOption = {
  clientId: string;
  clientCode: string;
  displayName: string;
};

export type AuthorizedCarePlanSourceOption = {
  sourceSystem: string;
  recordCount: number;
};

export type AuthorizedCarePlanViewSnapshot = {
  snapshotId: string;
  snapshotHash: string;
  generatedAt: string;
  expiresAt: string;
  organizationId: string;
  branchId: string;
  filters: AuthorizedCarePlanFilters;
  metrics: {
    matchingStreamTotal: number;
    pageStreamCount: number;
    historyVersionCount: number;
    currentTotal: number;
    futureTotal: number;
    expiredTotal: number;
    voidedTotal: number;
    notPublishedTotal: number;
    needsMappingTotal: number;
    effectiveConflictTotal: number;
  };
  plans: readonly AuthorizedCarePlanStream[];
  clientOptions: readonly AuthorizedCarePlanClientOption[];
  clientOptionTotal: number;
  clientOptionsTruncated: boolean;
  sourceOptions: readonly AuthorizedCarePlanSourceOption[];
  sourceOptionTotal: number;
  sourceOptionsTruncated: boolean;
  bounds: {
    maxPageSize: 25;
    maxHistoryVersionsPerStream: 50;
    maxContentBytes: 65_536;
    maxProvenanceBytes: 16_384;
    maxJsonNodes: 1_024;
    maxSnapshotBytes: 2_097_152;
  };
  mappingRegistryStatus: "not_configured";
  centralPromotionStatus: "not_configured";
  officialLimitRulesStatus: "not_configured";
  claimEligibilityStatus: "not_asserted";
  mutationStatus: "read_only";
  consistencyStatus: "single_database_statement_snapshot";
  demo: boolean;
};
