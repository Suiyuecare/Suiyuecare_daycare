export const CHEWING_RULE_VERSION =
  "chewing-manual-observations-candidate-v1" as const;

export const CHEWING_ITEM_IDS = [
  "chewing_observation_01",
  "chewing_observation_02",
  "chewing_observation_03",
  "chewing_observation_04",
  "chewing_observation_05",
  "chewing_observation_06",
] as const;

export const CHEWING_OBSERVATION_LABELS = {
  chewing_observation_01: "人工觀察：食物入口與口內處理情形需進一步確認",
  chewing_observation_02: "人工觀察：咀嚼動作或節律需進一步確認",
  chewing_observation_03: "人工觀察：口內食物殘留或清除情形需進一步確認",
  chewing_observation_04: "人工觀察：進食時疲勞或中止情形需進一步確認",
  chewing_observation_05: "人工觀察：牙齒、義齒或口腔不適情形需進一步確認",
  chewing_observation_06: "人工觀察：餐食質地或進食協助需求需專業覆核",
} as const satisfies Record<(typeof CHEWING_ITEM_IDS)[number], string>;

export const CLIENT_SERVICE_STATUSES = [
  "active", "suspended", "transferred", "closed", "deceased",
] as const;
export const CHEWING_PREVIEW_STATUSES = [
  "candidate_complete", "incomplete",
] as const;

export type ChewingObservationId =
  (typeof CHEWING_ITEM_IDS)[number];
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUSES)[number];
export type ChewingPreviewStatus =
  (typeof CHEWING_PREVIEW_STATUSES)[number];

export type ChewingAnswer =
  | { readonly state: "answered"; readonly value: "present" | "absent" }
  | { readonly state: "missing" }
  | { readonly state: "not_applicable"; readonly reason: string };
export type ChewingAnswers = Readonly<
  Record<ChewingObservationId, ChewingAnswer>
>;

export type ChewingRuleSnapshot = {
  version_id: typeof CHEWING_RULE_VERSION;
  instrument: "manual_unstandardized_chewing_observations";
  rule_revision: 1;
  activation_status: "candidate_unactivated";
  activated_at: null;
  governance_review_required: true;
  formal_use_permitted: false;
  field_ids: readonly ChewingObservationId[];
  field_definitions: readonly {
    id: ChewingObservationId;
    label: string;
    data_kind: "manual_presence_observation";
  }[];
  answer_values: readonly ["present", "absent"];
  completeness_policy: "all_fields_answered_for_non_clinical_count";
  present_count_policy: "count_present_only_when_complete_non_clinical";
  missing_policy: "no_count_and_never_zero";
  not_applicable_policy: "no_count_and_never_zero";
  formal_tool_status: "not_configured";
  licensed_source_status: "not_configured";
  formal_weights_status: "not_configured";
  formal_scoring_status: "not_configured";
  formal_ability_classification_status: "not_configured";
  disclaimer: string;
};

export type ChewingTrialPreview = {
  status: ChewingPreviewStatus;
  observedCount: number | null;
};

export type ChewingClientOption = {
  clientId: string;
  displayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
};

export type ChewingVersionHistoryItem = {
  versionId: string;
  assessmentVersion: number;
  recordState: "draft_preview";
  assessedOn: string;
  authorUserId: string;
  authorDisplayName: string;
  serviceStatusAtAssessment: ClientServiceStatus;
  answers: ChewingAnswers;
  ruleVersionId: typeof CHEWING_RULE_VERSION;
  ruleSnapshot: ChewingRuleSnapshot;
  ruleSnapshotHash: string;
  governanceStatus: "candidate_unactivated";
  previewStatus: ChewingPreviewStatus;
  previewObservedCount: number | null;
  contentHash: string;
  createdAt: string;
};

export type ChewingAssessmentListItem = {
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
  answers: ChewingAnswers | null;
  ruleVersionId: typeof CHEWING_RULE_VERSION | null;
  ruleSnapshot: ChewingRuleSnapshot | null;
  ruleSnapshotHash: string | null;
  governanceStatus: "candidate_unactivated" | null;
  previewStatus: ChewingPreviewStatus | null;
  previewObservedCount: number | null;
  contentHash: string | null;
  createdAt: string | null;
  versionHistory: readonly ChewingVersionHistoryItem[];
  versionHistoryTotal: number;
  versionHistoryTruncated: boolean;
};

export type ChewingAssessmentFilters = {
  clientId: string | null;
  previewStatus: "all" | ChewingPreviewStatus | "not_assessed";
  answerState: "all" | "all_answered" | "has_missing" |
    "has_not_applicable";
};

export type ChewingAssessmentSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly ChewingAssessmentListItem[];
  itemTotal: number;
  matchingTotal: number;
  itemsTruncated: boolean;
  metrics: {
    notAssessed: number;
    candidateComplete: number;
    incomplete: number;
    drafts: number;
  };
  clientOptions: readonly ChewingClientOption[];
  clientOptionsTruncated: boolean;
  ruleVersionId: typeof CHEWING_RULE_VERSION;
  ruleActivationStatus: "candidate_unactivated";
  formalSignStatus: "blocked_rule_not_activated";
  formalCorrectionStatus: "blocked_no_signed_record";
  formalScoreStatus: "not_available";
  formalAbilityClassificationStatus: "not_available";
  diagnosisStatus: "blocked";
  careDecisionStatus: "blocked";
  nutritionReferralStatus: "not_configured";
  swallowingReferralStatus: "not_configured";
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  offlineSyncStatus: "not_configured";
  notificationStatus: "not_configured";
  demo: boolean;
};

export type ChewingAssessmentFields = {
  clientId: string;
  assessedOn: string;
  answers: ChewingAnswers;
  ruleVersionId: typeof CHEWING_RULE_VERSION;
};
export type CreateChewingDraftInput = ChewingAssessmentFields & {
  action: "create_draft";
  idempotencyKey: string;
};
export type ReviseChewingDraftInput = ChewingAssessmentFields & {
  action: "revise_draft";
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};
export type SignChewingAssessmentInput = {
  action: "sign";
  clientId: string;
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};
export type CorrectChewingAssessmentInput = {
  action: "correct";
  clientId: string;
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  correctionReason: string;
  idempotencyKey: string;
};
export type ChewingAssessmentMutationInput =
  | ReviseChewingDraftInput
  | SignChewingAssessmentInput
  | CorrectChewingAssessmentInput;

export type ChewingAssessmentOperationResult = {
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
  ruleVersionId: typeof CHEWING_RULE_VERSION;
  governanceStatus: "candidate_unactivated";
  previewStatus: ChewingPreviewStatus;
  previewObservedCount: number | null;
  contentHash: string;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
