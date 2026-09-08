export const MNA_GOVERNANCE_VERSION =
  "mna-electronic-license-gate-v1" as const;

export const MNA_FORM_VARIANTS = ["mna_sf", "full_mna"] as const;
export const MNA_RISK_STATES = [
  "normal", "at_risk", "malnourished",
] as const;
export const MNA_FOLLOW_UP_STATUSES = [
  "not_started", "planned", "in_progress", "completed", "not_required",
] as const;
export const CLIENT_SERVICE_STATUSES = [
  "active", "suspended", "transferred", "closed", "deceased",
] as const;

export type MnaFormVariant = (typeof MNA_FORM_VARIANTS)[number];
export type MnaRiskState = (typeof MNA_RISK_STATES)[number];
export type MnaFollowUpStatus = (typeof MNA_FOLLOW_UP_STATUSES)[number];
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUSES)[number];

export type MnaGovernanceSnapshot = {
  version_id: typeof MNA_GOVERNANCE_VERSION;
  instrument_family_reference: "MNA";
  short_form_reference: "MNA-SF Revision 2009";
  full_form_reference: "Long MNA amended 2023";
  target_locale: "zh-TW";
  activation_status: "license_required_not_configured";
  formal_use_permitted: false;
  official_item_text_embedded: false;
  official_answer_options_embedded: false;
  official_scoring_formula_embedded: false;
  license_agreement_reference: null;
  electronic_implementation_approval_reference: null;
  screenshot_review_reference: null;
  questionnaire_content_status: "not_configured";
  scoring_algorithm_status: "not_configured";
  risk_classification_status: "not_configured";
  automatic_reassessment_rule_status: "not_configured";
  automatic_follow_up_rule_status: "not_configured";
  source_links: readonly [string, string, string];
  disclaimer: string;
};

export type MnaVersionHistoryItem = {
  versionId: string;
  assessmentVersion: number;
  recordState: "synthetic_demo_signed" | "synthetic_demo_corrected";
  assessedOn: string;
  fullAssessmentOn: string | null;
  authorUserId: string;
  authorDisplayName: string;
  serviceStatusAtAssessment: ClientServiceStatus;
  shortFormScore: number;
  shortFormRisk: MnaRiskState;
  fullScore: number | null;
  fullRisk: MnaRiskState | null;
  reassessmentDueOn: string | null;
  reassessmentBasis: string | null;
  followUpStatus: MnaFollowUpStatus;
  followUpPlan: string | null;
  followUpOwnerDisplayName: string | null;
  governanceVersionId: typeof MNA_GOVERNANCE_VERSION;
  governanceSnapshot: MnaGovernanceSnapshot;
  governanceSnapshotHash: string;
  sourceFormVersionReference: string;
  signedAt: string;
  signedByUserId: string;
  correctionOfVersionId: string | null;
  correctionReason: string | null;
  contentHash: string;
  createdAt: string;
};

export type MnaClientOption = {
  clientId: string;
  displayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
};

export type MnaAssessmentListItem = {
  clientId: string;
  clientDisplayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
  versionId: string | null;
  assessmentKey: string | null;
  assessmentVersion: number | null;
  recordState: "synthetic_demo_signed" | "synthetic_demo_corrected" | null;
  assessedOn: string | null;
  fullAssessmentOn: string | null;
  authorUserId: string | null;
  authorDisplayName: string | null;
  serviceStatusAtAssessment: ClientServiceStatus | null;
  shortFormScore: number | null;
  shortFormRisk: MnaRiskState | null;
  fullScore: number | null;
  fullRisk: MnaRiskState | null;
  reassessmentDueOn: string | null;
  reassessmentBasis: string | null;
  followUpStatus: MnaFollowUpStatus | null;
  followUpPlan: string | null;
  followUpOwnerDisplayName: string | null;
  governanceVersionId: typeof MNA_GOVERNANCE_VERSION | null;
  governanceSnapshot: MnaGovernanceSnapshot | null;
  governanceSnapshotHash: string | null;
  sourceFormVersionReference: string | null;
  signedAt: string | null;
  signedByUserId: string | null;
  correctionOfVersionId: string | null;
  correctionReason: string | null;
  contentHash: string | null;
  createdAt: string | null;
  versionHistory: readonly MnaVersionHistoryItem[];
  versionHistoryTotal: number;
  versionHistoryTruncated: boolean;
};

export type MnaAssessmentFilters = {
  clientId: string | null;
  risk: "all" | MnaRiskState | "not_assessed";
  followUp: "all" | "pending" | "completed" | "not_assessed";
};

export type MnaAssessmentSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly MnaAssessmentListItem[];
  itemTotal: number;
  matchingTotal: number;
  itemsTruncated: boolean;
  metrics: {
    notAssessed: number;
    normal: number;
    atRisk: number;
    malnourished: number;
    followUpPending: number;
  };
  clientOptions: readonly MnaClientOption[];
  clientOptionsTruncated: boolean;
  governanceVersionId: typeof MNA_GOVERNANCE_VERSION;
  licenseStatus: "license_required_not_configured";
  questionnaireContentStatus: "not_configured";
  scoringAlgorithmStatus: "not_configured";
  riskClassificationStatus: "not_configured";
  formalDraftStatus: "blocked_license_not_configured";
  formalSignStatus: "blocked_license_not_configured";
  formalCorrectionStatus: "blocked_license_not_configured";
  automaticReassessmentStatus: "not_configured";
  automaticFollowUpStatus: "not_configured";
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  offlineSyncStatus: "not_configured";
  notificationStatus: "not_configured";
  demo: boolean;
};

type MnaBlockedBase = {
  clientId: string;
  idempotencyKey: string;
};

export type CreateMnaAssessmentInput = MnaBlockedBase & {
  action: "create_draft";
  assessedOn: string;
  formVariant: MnaFormVariant;
  governanceVersionId: typeof MNA_GOVERNANCE_VERSION;
};

export type ReviseMnaAssessmentInput = MnaBlockedBase & {
  action: "revise_draft";
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  assessedOn: string;
  formVariant: MnaFormVariant;
  governanceVersionId: typeof MNA_GOVERNANCE_VERSION;
};

export type SignMnaAssessmentInput = MnaBlockedBase & {
  action: "sign";
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
};

export type CorrectMnaAssessmentInput = MnaBlockedBase & {
  action: "correct";
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  correctionReason: string;
};

export type MnaAssessmentMutationInput = ReviseMnaAssessmentInput |
  SignMnaAssessmentInput | CorrectMnaAssessmentInput;

