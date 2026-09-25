export const SPMSQ_RULE_VERSION =
  "spmsq-pfeiffer-10-education-adjusted-v1" as const;

export const SPMSQ_ITEM_IDS = [
  "spmsq_01", "spmsq_02", "spmsq_03", "spmsq_04", "spmsq_05",
  "spmsq_06", "spmsq_07", "spmsq_08", "spmsq_09", "spmsq_10",
] as const;

/** Taiwan MOHW SPMSQ prompts and administration notes (licensed source copy). */
export const SPMSQ_QUESTIONS = [
  {
    id: "spmsq_01",
    prompt: "今天是幾號？",
    note: "年、月、日都正確才算答對。",
  },
  {
    id: "spmsq_02",
    prompt: "今天是星期幾？",
    note: "星期答對才算答對。",
  },
  {
    id: "spmsq_03",
    prompt: "這是什麼地方？",
    note: "能正確描述所在地即可；例如說「我的家」或說出城鎮、醫院、機構名稱。",
  },
  {
    id: "spmsq_04",
    prompt: "您的電話號碼是幾號？",
    note: "核對號碼正確，或能在間隔較久後重複相同號碼，即可算答對；若沒有電話，改問「您住在什麼地方？」。",
  },
  {
    id: "spmsq_05",
    prompt: "您幾歲了？",
    note: "年齡須與出生年月日相符。",
  },
  {
    id: "spmsq_06",
    prompt: "您的出生年月日是什麼？",
    note: "年、月、日都正確才算答對。",
  },
  {
    id: "spmsq_07",
    prompt: "現任的總統是誰？",
    note: "姓氏正確即可；依評估當日的現任者判斷。",
  },
  {
    id: "spmsq_08",
    prompt: "前任的總統是誰？",
    note: "姓氏正確即可；依評估當日的前任者判斷。",
  },
  {
    id: "spmsq_09",
    prompt: "您媽媽叫什麼名字？",
    note: "不需另行查證；能說出一個不同於本人姓名的女性姓名即可。",
  },
  {
    id: "spmsq_10",
    prompt: "從 20 減 3 開始算，一直減 3 減下去。",
    note: "過程中出現錯誤或無法繼續，即記為答錯。",
  },
] as const satisfies readonly {
  id: (typeof SPMSQ_ITEM_IDS)[number];
  prompt: string;
  note: string;
}[];

export const SPMSQ_QUESTION_INSTRUCTIONS =
  "依序口頭詢問並記錄答對或答錯。若個案家中沒有電話，第 4 題改問居住地。";
export const SPMSQ_QUESTION_SOURCE =
  "衛生福利部所屬醫院：簡易心智狀態問卷調查表（SPMSQ）。";
export const SPMSQ_QUESTION_SOURCE_URL =
  "https://www.mil.mohw.gov.tw/public/dept_down/ufile/55b2bc21d3117046071942f0740047b5.pdf";

export const CLIENT_SERVICE_STATUSES = [
  "active", "suspended", "transferred", "closed", "deceased",
] as const;
export const SPMSQ_PREVIEW_STATUSES = [
  "candidate_complete", "incomplete",
] as const;
export const EDUCATION_VALUES = [
  "grade_school_or_less", "middle_or_high_school", "beyond_high_school",
] as const;

export type SpmsqItemId = (typeof SPMSQ_ITEM_IDS)[number];
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUSES)[number];
export type SpmsqPreviewStatus = (typeof SPMSQ_PREVIEW_STATUSES)[number];
export type EducationValue = (typeof EDUCATION_VALUES)[number];

export type SpmsqAnswer =
  | { readonly state: "answered"; readonly value: "correct" | "incorrect" }
  | { readonly state: "missing" }
  | { readonly state: "not_applicable"; readonly reason: string };

export type SpmsqAnswers = Readonly<Record<SpmsqItemId, SpmsqAnswer>>;

export type SpmsqEducationContext =
  | { readonly state: "answered"; readonly value: EducationValue }
  | { readonly state: "missing" }
  | { readonly state: "not_applicable"; readonly reason: string };

export type SpmsqCulturalContext =
  | { readonly state: "recorded"; readonly note: string }
  | { readonly state: "missing" }
  | { readonly state: "not_applicable"; readonly reason: string };

export type SpmsqRuleSnapshot = {
  version_id: typeof SPMSQ_RULE_VERSION;
  instrument: "spmsq";
  rule_revision: 1;
  activation_status: "candidate_unactivated";
  activated_at: null;
  review_required: true;
  formal_use_permitted: false;
  item_ids: readonly SpmsqItemId[];
  answer_weights: { correct: 0; incorrect: 1 };
  missing_policy: "no_preview_and_never_zero";
  not_applicable_policy: "no_preview_and_never_zero";
  education_adjustment: {
    grade_school_or_less: -1;
    middle_or_high_school: 0;
    beyond_high_school: 1;
    clamp_min: 0;
    clamp_max: 10;
  };
  cultural_adjustment: {
    status: "not_configured";
    numeric_effect: 0;
    policy: "context_is_preserved_but_never_changes_trial_preview";
  };
  candidate_bands: readonly {
    key: string;
    min: number;
    max: number;
  }[];
  disclaimer: string;
};

export type SpmsqTrialPreview = {
  status: SpmsqPreviewStatus;
  rawErrors: number | null;
  adjustedErrors: number | null;
  bandKey: string | null;
};

export type SpmsqClientOption = {
  clientId: string;
  displayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
};

export type SpmsqVersionHistoryItem = {
  versionId: string;
  assessmentVersion: number;
  recordState: "draft_preview";
  assessedOn: string;
  authorUserId: string;
  authorDisplayName: string;
  serviceStatusAtAssessment: ClientServiceStatus;
  answers: SpmsqAnswers;
  educationContext: SpmsqEducationContext;
  culturalContext: SpmsqCulturalContext;
  ruleVersionId: typeof SPMSQ_RULE_VERSION;
  ruleSnapshot: SpmsqRuleSnapshot;
  ruleSnapshotHash: string;
  governanceStatus: "candidate_unactivated";
  previewStatus: SpmsqPreviewStatus;
  previewRawErrors: number | null;
  previewAdjustedErrors: number | null;
  previewBandKey: string | null;
  createdAt: string;
};

export type SpmsqAssessmentListItem = {
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
  answers: SpmsqAnswers | null;
  educationContext: SpmsqEducationContext | null;
  culturalContext: SpmsqCulturalContext | null;
  ruleVersionId: typeof SPMSQ_RULE_VERSION | null;
  ruleSnapshot: SpmsqRuleSnapshot | null;
  ruleSnapshotHash: string | null;
  governanceStatus: "candidate_unactivated" | null;
  previewStatus: SpmsqPreviewStatus | null;
  previewRawErrors: number | null;
  previewAdjustedErrors: number | null;
  previewBandKey: string | null;
  createdAt: string | null;
  versionHistory: readonly SpmsqVersionHistoryItem[];
  versionHistoryTotal: number;
  versionHistoryTruncated: boolean;
};

export type SpmsqAssessmentFilters = {
  clientId: string | null;
  previewStatus: "all" | SpmsqPreviewStatus | "not_assessed";
  educationState: "all" | "answered" | "missing" | "not_applicable";
};

export type SpmsqAssessmentSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly SpmsqAssessmentListItem[];
  itemTotal: number;
  matchingTotal: number;
  itemsTruncated: boolean;
  metrics: {
    notAssessed: number;
    candidateComplete: number;
    incomplete: number;
    drafts: number;
  };
  clientOptions: readonly SpmsqClientOption[];
  clientOptionsTruncated: boolean;
  ruleVersionId: typeof SPMSQ_RULE_VERSION;
  ruleActivationStatus: "candidate_unactivated";
  formalSignStatus: "blocked_rule_not_activated";
  formalScoreStatus: "not_available";
  careDecisionStatus: "blocked";
  culturalAdjustmentStatus: "not_configured_context_only";
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  offlineSyncStatus: "not_configured";
  demo: boolean;
};

export type SpmsqAssessmentFields = {
  clientId: string;
  assessedOn: string;
  answers: SpmsqAnswers;
  educationContext: SpmsqEducationContext;
  culturalContext: SpmsqCulturalContext;
  ruleVersionId: typeof SPMSQ_RULE_VERSION;
};

export type CreateSpmsqDraftInput = SpmsqAssessmentFields & {
  action: "create_draft";
  idempotencyKey: string;
};

export type ReviseSpmsqDraftInput = SpmsqAssessmentFields & {
  action: "revise_draft";
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type SignSpmsqAssessmentInput = {
  action: "sign";
  clientId: string;
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type SpmsqAssessmentMutationInput =
  | ReviseSpmsqDraftInput
  | SignSpmsqAssessmentInput;

export type SpmsqAssessmentOperationResult = {
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
  ruleVersionId: typeof SPMSQ_RULE_VERSION;
  governanceStatus: "candidate_unactivated";
  previewStatus: SpmsqPreviewStatus;
  previewRawErrors: number | null;
  previewAdjustedErrors: number | null;
  previewBandKey: string | null;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
