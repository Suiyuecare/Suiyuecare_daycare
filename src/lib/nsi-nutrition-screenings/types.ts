export const NSI_NUTRITION_RULE_VERSION =
  "nsi-manual-nutrition-observations-candidate-v1" as const;

export const NSI_NUTRITION_ITEM_IDS = [
  "nutrition_observation_01",
  "nutrition_observation_02",
  "nutrition_observation_03",
  "nutrition_observation_04",
  "nutrition_observation_05",
  "nutrition_observation_06",
] as const;

export const NSI_NUTRITION_OBSERVATION_LABELS = {
  nutrition_observation_01: "人工觀察：近期餐食攝取情形需進一步確認",
  nutrition_observation_02: "人工觀察：近期體重或衣物鬆緊變化需進一步確認",
  nutrition_observation_03: "人工觀察：口腔、咀嚼或吞嚥相關情形需進一步確認",
  nutrition_observation_04: "人工觀察：自行進食或備餐協助需求需進一步確認",
  nutrition_observation_05: "人工觀察：飲食限制、過敏或特殊質地資訊需進一步確認",
  nutrition_observation_06: "人工觀察：營養相關健康或用藥資訊需專業覆核",
} as const satisfies Record<(typeof NSI_NUTRITION_ITEM_IDS)[number], string>;

export const CLIENT_SERVICE_STATUSES = [
  "active", "suspended", "transferred", "closed", "deceased",
] as const;
export const NSI_NUTRITION_PREVIEW_STATUSES = [
  "candidate_complete", "incomplete",
] as const;

export type NsiNutritionObservationId =
  (typeof NSI_NUTRITION_ITEM_IDS)[number];
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUSES)[number];
export type NsiNutritionPreviewStatus =
  (typeof NSI_NUTRITION_PREVIEW_STATUSES)[number];

export type NsiNutritionAnswer =
  | { readonly state: "answered"; readonly value: "present" | "absent" }
  | { readonly state: "missing" }
  | { readonly state: "not_applicable"; readonly reason: string };
export type NsiNutritionAnswers = Readonly<
  Record<NsiNutritionObservationId, NsiNutritionAnswer>
>;

export type NsiNutritionRuleSnapshot = {
  version_id: typeof NSI_NUTRITION_RULE_VERSION;
  instrument: "manual_unstandardized_nutrition_observations";
  rule_revision: 1;
  activation_status: "candidate_unactivated";
  activated_at: null;
  governance_review_required: true;
  formal_use_permitted: false;
  field_ids: readonly NsiNutritionObservationId[];
  field_definitions: readonly {
    id: NsiNutritionObservationId;
    label: string;
    data_kind: "manual_presence_observation";
  }[];
  answer_values: readonly ["present", "absent"];
  completeness_policy: "all_fields_answered_for_non_clinical_count";
  present_count_policy: "count_present_only_when_complete_non_clinical";
  missing_policy: "no_count_and_never_zero";
  not_applicable_policy: "no_count_and_never_zero";
  formal_questionnaire_status: "not_configured";
  licensed_source_status: "not_configured";
  formal_weights_status: "not_configured";
  formal_scoring_status: "not_configured";
  formal_risk_classification_status: "not_configured";
  disclaimer: string;
};

export type NsiNutritionTrialPreview = {
  status: NsiNutritionPreviewStatus;
  observedCount: number | null;
};

export type NsiNutritionClientOption = {
  clientId: string;
  displayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
};

export type NsiNutritionVersionHistoryItem = {
  versionId: string;
  assessmentVersion: number;
  recordState: "draft_preview";
  assessedOn: string;
  authorUserId: string;
  authorDisplayName: string;
  serviceStatusAtAssessment: ClientServiceStatus;
  answers: NsiNutritionAnswers;
  ruleVersionId: typeof NSI_NUTRITION_RULE_VERSION;
  ruleSnapshot: NsiNutritionRuleSnapshot;
  ruleSnapshotHash: string;
  governanceStatus: "candidate_unactivated";
  previewStatus: NsiNutritionPreviewStatus;
  previewObservedCount: number | null;
  contentHash: string;
  createdAt: string;
};

export type NsiNutritionScreeningListItem = {
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
  answers: NsiNutritionAnswers | null;
  ruleVersionId: typeof NSI_NUTRITION_RULE_VERSION | null;
  ruleSnapshot: NsiNutritionRuleSnapshot | null;
  ruleSnapshotHash: string | null;
  governanceStatus: "candidate_unactivated" | null;
  previewStatus: NsiNutritionPreviewStatus | null;
  previewObservedCount: number | null;
  contentHash: string | null;
  createdAt: string | null;
  versionHistory: readonly NsiNutritionVersionHistoryItem[];
  versionHistoryTotal: number;
  versionHistoryTruncated: boolean;
};

export type NsiNutritionScreeningFilters = {
  clientId: string | null;
  previewStatus: "all" | NsiNutritionPreviewStatus | "not_assessed";
  answerState: "all" | "all_answered" | "has_missing" |
    "has_not_applicable";
};

export type NsiNutritionScreeningSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly NsiNutritionScreeningListItem[];
  itemTotal: number;
  matchingTotal: number;
  itemsTruncated: boolean;
  metrics: {
    notAssessed: number;
    candidateComplete: number;
    incomplete: number;
    drafts: number;
  };
  clientOptions: readonly NsiNutritionClientOption[];
  clientOptionsTruncated: boolean;
  ruleVersionId: typeof NSI_NUTRITION_RULE_VERSION;
  ruleActivationStatus: "candidate_unactivated";
  formalSignStatus: "blocked_rule_not_activated";
  formalScoreStatus: "not_available";
  formalRiskClassificationStatus: "not_available";
  diagnosisStatus: "blocked";
  careDecisionStatus: "blocked";
  nutritionFollowUpStatus: "not_configured";
  nutritionReferralStatus: "not_configured";
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  offlineSyncStatus: "not_configured";
  notificationStatus: "not_configured";
  demo: boolean;
};

export type NsiNutritionScreeningFields = {
  clientId: string;
  assessedOn: string;
  answers: NsiNutritionAnswers;
  ruleVersionId: typeof NSI_NUTRITION_RULE_VERSION;
};
export type CreateNsiNutritionDraftInput = NsiNutritionScreeningFields & {
  action: "create_draft";
  idempotencyKey: string;
};
export type ReviseNsiNutritionDraftInput = NsiNutritionScreeningFields & {
  action: "revise_draft";
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};
export type SignNsiNutritionScreeningInput = {
  action: "sign";
  clientId: string;
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};
export type NsiNutritionScreeningMutationInput =
  | ReviseNsiNutritionDraftInput
  | SignNsiNutritionScreeningInput;

export type NsiNutritionScreeningOperationResult = {
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
  ruleVersionId: typeof NSI_NUTRITION_RULE_VERSION;
  governanceStatus: "candidate_unactivated";
  previewStatus: NsiNutritionPreviewStatus;
  previewObservedCount: number | null;
  contentHash: string;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
