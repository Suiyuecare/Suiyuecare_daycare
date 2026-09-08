export const FALL_RISK_RULE_VERSION =
  "fall-risk-manual-factors-candidate-v1" as const;

export const FALL_RISK_ITEM_IDS = [
  "fall_factor_01", "fall_factor_02", "fall_factor_03",
  "fall_factor_04", "fall_factor_05", "fall_factor_06",
] as const;

export const FALL_RISK_FACTOR_LABELS = {
  fall_factor_01: "人工觀察：近期跌倒或近跌事件",
  fall_factor_02: "人工觀察：行走或移位穩定情形",
  fall_factor_03: "人工觀察：輔具或他人協助需求",
  fall_factor_04: "人工觀察：暈眩、嗜睡或姿勢改變反應",
  fall_factor_05: "人工觀察：環境或活動情境風險",
  fall_factor_06: "人工觀察：安全指令理解與遵循情形",
} as const satisfies Record<(typeof FALL_RISK_ITEM_IDS)[number], string>;

export const CLIENT_SERVICE_STATUSES = [
  "active", "suspended", "transferred", "closed", "deceased",
] as const;
export const FALL_RISK_PREVIEW_STATUSES = [
  "candidate_complete", "incomplete",
] as const;

export type FallRiskItemId = (typeof FALL_RISK_ITEM_IDS)[number];
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUSES)[number];
export type FallRiskPreviewStatus = (typeof FALL_RISK_PREVIEW_STATUSES)[number];

export type FallRiskAnswer =
  | { readonly state: "answered"; readonly value: "present" | "absent" }
  | { readonly state: "missing" }
  | { readonly state: "not_applicable"; readonly reason: string };
export type FallRiskAnswers = Readonly<Record<FallRiskItemId, FallRiskAnswer>>;

export type FallRiskRuleSnapshot = {
  version_id: typeof FALL_RISK_RULE_VERSION;
  instrument: "manual_unstandardized_fall_risk_factors";
  rule_revision: 1;
  activation_status: "candidate_unactivated";
  activated_at: null;
  review_required: true;
  formal_use_permitted: false;
  item_ids: readonly FallRiskItemId[];
  factor_definitions: readonly {
    id: FallRiskItemId;
    label: string;
    candidate_weight: 1;
  }[];
  answer_values: readonly ["present", "absent"];
  candidate_present_item_ids: readonly FallRiskItemId[];
  missing_policy: "no_preview_and_never_zero";
  not_applicable_policy: "no_preview_and_never_zero";
  strict_complete_required: true;
  candidate_bands: readonly { key: string; min: number; max: number }[];
  disclaimer: string;
};

export type FallRiskTrialPreview = {
  status: FallRiskPreviewStatus;
  candidatePoints: number | null;
  bandKey: string | null;
};

export type FallRiskClientOption = {
  clientId: string;
  displayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
};

export type FallRiskVersionHistoryItem = {
  versionId: string;
  assessmentVersion: number;
  recordState: "draft_preview";
  assessedOn: string;
  authorUserId: string;
  authorDisplayName: string;
  serviceStatusAtAssessment: ClientServiceStatus;
  answers: FallRiskAnswers;
  ruleVersionId: typeof FALL_RISK_RULE_VERSION;
  ruleSnapshot: FallRiskRuleSnapshot;
  ruleSnapshotHash: string;
  governanceStatus: "candidate_unactivated";
  previewStatus: FallRiskPreviewStatus;
  previewCandidatePoints: number | null;
  previewBandKey: string | null;
  contentHash: string;
  createdAt: string;
};

export type FallRiskAssessmentListItem = {
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
  answers: FallRiskAnswers | null;
  ruleVersionId: typeof FALL_RISK_RULE_VERSION | null;
  ruleSnapshot: FallRiskRuleSnapshot | null;
  ruleSnapshotHash: string | null;
  governanceStatus: "candidate_unactivated" | null;
  previewStatus: FallRiskPreviewStatus | null;
  previewCandidatePoints: number | null;
  previewBandKey: string | null;
  contentHash: string | null;
  createdAt: string | null;
  versionHistory: readonly FallRiskVersionHistoryItem[];
  versionHistoryTotal: number;
  versionHistoryTruncated: boolean;
};

export type FallRiskAssessmentFilters = {
  clientId: string | null;
  previewStatus: "all" | FallRiskPreviewStatus | "not_assessed";
  answerState: "all" | "all_answered" | "has_missing" |
    "has_not_applicable";
};

export type FallRiskAssessmentSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly FallRiskAssessmentListItem[];
  itemTotal: number;
  matchingTotal: number;
  itemsTruncated: boolean;
  metrics: {
    notAssessed: number;
    candidateComplete: number;
    incomplete: number;
    drafts: number;
  };
  clientOptions: readonly FallRiskClientOption[];
  clientOptionsTruncated: boolean;
  ruleVersionId: typeof FALL_RISK_RULE_VERSION;
  ruleActivationStatus: "candidate_unactivated";
  formalSignStatus: "blocked_rule_not_activated";
  formalScoreStatus: "not_available";
  formalRiskStatus: "not_available";
  careDecisionStatus: "blocked";
  draftTaskSuggestionStatus: "not_configured";
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  offlineSyncStatus: "not_configured";
  notificationStatus: "not_configured";
  demo: boolean;
};

export type FallRiskAssessmentFields = {
  clientId: string;
  assessedOn: string;
  answers: FallRiskAnswers;
  ruleVersionId: typeof FALL_RISK_RULE_VERSION;
};
export type CreateFallRiskDraftInput = FallRiskAssessmentFields & {
  action: "create_draft";
  idempotencyKey: string;
};
export type ReviseFallRiskDraftInput = FallRiskAssessmentFields & {
  action: "revise_draft";
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};
export type SignFallRiskAssessmentInput = {
  action: "sign";
  clientId: string;
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};
export type FallRiskAssessmentMutationInput =
  | ReviseFallRiskDraftInput
  | SignFallRiskAssessmentInput;

export type FallRiskAssessmentOperationResult = {
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
  ruleVersionId: typeof FALL_RISK_RULE_VERSION;
  governanceStatus: "candidate_unactivated";
  previewStatus: FallRiskPreviewStatus;
  previewCandidatePoints: number | null;
  previewBandKey: string | null;
  contentHash: string;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
