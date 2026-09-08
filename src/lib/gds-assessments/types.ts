export const GDS_RULE_VERSION = "gds-15-strict-complete-v1" as const;

export const GDS_ITEM_IDS = [
  "gds_01", "gds_02", "gds_03", "gds_04", "gds_05",
  "gds_06", "gds_07", "gds_08", "gds_09", "gds_10",
  "gds_11", "gds_12", "gds_13", "gds_14", "gds_15",
] as const;

export const GDS_SCORED_YES_ITEM_IDS = [
  "gds_02", "gds_03", "gds_04", "gds_06", "gds_08",
  "gds_09", "gds_10", "gds_12", "gds_14", "gds_15",
] as const;
export const GDS_SCORED_NO_ITEM_IDS = [
  "gds_01", "gds_05", "gds_07", "gds_11", "gds_13",
] as const;

export const CLIENT_SERVICE_STATUSES = [
  "active", "suspended", "transferred", "closed", "deceased",
] as const;
export const GDS_PREVIEW_STATUSES = [
  "candidate_complete", "incomplete",
] as const;

export type GdsItemId = (typeof GDS_ITEM_IDS)[number];
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUSES)[number];
export type GdsPreviewStatus = (typeof GDS_PREVIEW_STATUSES)[number];

export type GdsAnswer =
  | { readonly state: "answered"; readonly value: "yes" | "no" }
  | { readonly state: "missing" }
  | { readonly state: "not_applicable"; readonly reason: string };
export type GdsAnswers = Readonly<Record<GdsItemId, GdsAnswer>>;

export type GdsRuleSnapshot = {
  version_id: typeof GDS_RULE_VERSION;
  instrument: "gds_15";
  rule_revision: 1;
  activation_status: "candidate_unactivated";
  activated_at: null;
  review_required: true;
  formal_use_permitted: false;
  item_ids: readonly GdsItemId[];
  answer_values: readonly ["yes", "no"];
  scored_yes_item_ids: readonly GdsItemId[];
  scored_no_item_ids: readonly GdsItemId[];
  missing_policy: "no_preview_and_never_zero";
  not_applicable_policy: "no_preview_and_never_zero";
  strict_complete_required: true;
  candidate_bands: readonly { key: string; min: number; max: number }[];
  disclaimer: string;
};

export type GdsTrialPreview = {
  status: GdsPreviewStatus;
  candidatePoints: number | null;
  bandKey: string | null;
};

export type GdsClientOption = {
  clientId: string;
  displayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
};

export type GdsVersionHistoryItem = {
  versionId: string;
  assessmentVersion: number;
  recordState: "draft_preview";
  assessedOn: string;
  authorUserId: string;
  authorDisplayName: string;
  serviceStatusAtAssessment: ClientServiceStatus;
  answers: GdsAnswers;
  ruleVersionId: typeof GDS_RULE_VERSION;
  ruleSnapshot: GdsRuleSnapshot;
  ruleSnapshotHash: string;
  governanceStatus: "candidate_unactivated";
  previewStatus: GdsPreviewStatus;
  previewCandidatePoints: number | null;
  previewBandKey: string | null;
  createdAt: string;
};

export type GdsAssessmentListItem = {
  clientId: string;
  clientDisplayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
  versionId: string | null;
  assessmentKey: string | null;
  assessmentVersion: number | null;
  recordState: "draft_preview" | null;
  assessedOn: string | null;
  authorUserId: string | null;
  authorDisplayName: string | null;
  serviceStatusAtAssessment: ClientServiceStatus | null;
  answers: GdsAnswers | null;
  ruleVersionId: typeof GDS_RULE_VERSION | null;
  ruleSnapshot: GdsRuleSnapshot | null;
  ruleSnapshotHash: string | null;
  governanceStatus: "candidate_unactivated" | null;
  previewStatus: GdsPreviewStatus | null;
  previewCandidatePoints: number | null;
  previewBandKey: string | null;
  createdAt: string | null;
  versionHistory: readonly GdsVersionHistoryItem[];
  versionHistoryTotal: number;
  versionHistoryTruncated: boolean;
};

export type GdsAssessmentFilters = {
  clientId: string | null;
  previewStatus: "all" | GdsPreviewStatus | "not_assessed";
  answerState: "all" | "all_answered" | "has_missing" |
    "has_not_applicable";
};

export type GdsAssessmentSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly GdsAssessmentListItem[];
  itemTotal: number;
  matchingTotal: number;
  itemsTruncated: boolean;
  metrics: {
    notAssessed: number;
    candidateComplete: number;
    incomplete: number;
    drafts: number;
  };
  clientOptions: readonly GdsClientOption[];
  clientOptionsTruncated: boolean;
  ruleVersionId: typeof GDS_RULE_VERSION;
  ruleActivationStatus: "candidate_unactivated";
  formalSignStatus: "blocked_rule_not_activated";
  formalScoreStatus: "not_available";
  formalRiskStatus: "not_available";
  careDecisionStatus: "blocked";
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  offlineSyncStatus: "not_configured";
  notificationStatus: "not_configured";
  demo: boolean;
};

export type GdsAssessmentFields = {
  clientId: string;
  assessedOn: string;
  answers: GdsAnswers;
  ruleVersionId: typeof GDS_RULE_VERSION;
};
export type CreateGdsDraftInput = GdsAssessmentFields & {
  action: "create_draft";
  idempotencyKey: string;
};
export type ReviseGdsDraftInput = GdsAssessmentFields & {
  action: "revise_draft";
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};
export type SignGdsAssessmentInput = {
  action: "sign";
  clientId: string;
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};
export type GdsAssessmentMutationInput =
  | ReviseGdsDraftInput
  | SignGdsAssessmentInput;

export type GdsAssessmentOperationResult = {
  action: "create_draft" | "revise_draft";
  operationId: string;
  clientId: string;
  assessmentKey: string;
  versionId: string;
  assessmentVersion: number;
  recordState: "draft_preview";
  assessedOn: string;
  authorUserId: string;
  serviceStatusAtAssessment: ClientServiceStatus;
  ruleVersionId: typeof GDS_RULE_VERSION;
  governanceStatus: "candidate_unactivated";
  previewStatus: GdsPreviewStatus;
  previewCandidatePoints: number | null;
  previewBandKey: string | null;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
