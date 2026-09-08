export const PSYCHOSOCIAL_RECORD_STATES = ["draft", "signed", "corrected"] as const;
export const PSYCHOSOCIAL_DOMAIN_STATES = ["provided", "missing", "not_applicable"] as const;
export const PSYCHOSOCIAL_DOMAIN_KEYS = [
  "family_relationships",
  "social_support",
  "social_participation",
  "communication_context",
  "resource_access",
] as const;
export const CLIENT_SERVICE_STATUSES = [
  "active", "suspended", "transferred", "closed", "deceased",
] as const;

export type PsychosocialRecordState = (typeof PSYCHOSOCIAL_RECORD_STATES)[number];
export type PsychosocialDomainState = (typeof PSYCHOSOCIAL_DOMAIN_STATES)[number];
export type PsychosocialDomainKey = (typeof PSYCHOSOCIAL_DOMAIN_KEYS)[number];
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUSES)[number];

export type PsychosocialDomainValue = {
  state: PsychosocialDomainState;
  detail: string | null;
};

export type PsychosocialDimensions = Record<
  PsychosocialDomainKey,
  PsychosocialDomainValue
>;

export type PsychosocialClientOption = {
  clientId: string;
  displayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
};

export type PsychosocialResponsibleOption = {
  userId: string;
  displayName: string;
};

export type PsychosocialVersionHistoryItem = {
  versionId: string;
  assessmentVersion: number;
  recordState: PsychosocialRecordState;
  assessedOn: string;
  responsibleUserId: string;
  responsibleDisplayName: string;
  serviceStatusAtAssessment: ClientServiceStatus;
  reassessmentDueOn: string;
  dueBasis: string;
  dimensions: PsychosocialDimensions;
  assessmentSummary: string;
  formBasis: "manual_unstandardized";
  formVersionReference: "manual-psychosocial-v1";
  correctionReason: string | null;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string;
};

export type PsychosocialAssessmentListItem = {
  clientId: string;
  clientDisplayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
  versionId: string | null;
  assessmentKey: string | null;
  assessmentVersion: number | null;
  recordState: PsychosocialRecordState | null;
  assessedOn: string | null;
  responsibleUserId: string | null;
  responsibleDisplayName: string | null;
  serviceStatusAtAssessment: ClientServiceStatus | null;
  reassessmentDueOn: string | null;
  reassessmentDue: boolean;
  dueBasis: string | null;
  dimensions: PsychosocialDimensions | null;
  assessmentSummary: string | null;
  formBasis: "manual_unstandardized" | null;
  formVersionReference: "manual-psychosocial-v1" | null;
  correctionReason: string | null;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string | null;
  versionHistory: readonly PsychosocialVersionHistoryItem[];
  versionHistoryTotal: number;
  versionHistoryTruncated: boolean;
};

export type PsychosocialAssessmentFilters = {
  clientId: string | null;
  responsibleUserId: string | null;
  serviceStatus: ClientServiceStatus | null;
  dueStatus: "all" | "due" | "upcoming" | "not_assessed";
};

export type PsychosocialAssessmentSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly PsychosocialAssessmentListItem[];
  itemTotal: number;
  matchingTotal: number;
  itemsTruncated: boolean;
  metrics: {
    assessed: number;
    notAssessed: number;
    due: number;
    upcoming: number;
    drafts: number;
    completed: number;
  };
  clientOptions: readonly PsychosocialClientOption[];
  clientOptionsTruncated: boolean;
  responsibleOptions: readonly PsychosocialResponsibleOption[];
  responsibleOptionsTruncated: boolean;
  assessmentMethodStatus: "manual_unstandardized_only";
  formPublicationStatus: "not_published_not_claimed";
  dueRuleStatus: "not_configured_manual_date_and_basis_only";
  scoreStatus: "not_configured";
  diagnosisStatus: "not_configured";
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  offlineSyncStatus: "not_configured";
  demo: boolean;
};

export type PsychosocialAssessmentFields = {
  clientId: string;
  assessedOn: string;
  reassessmentDueOn: string;
  dueBasis: string;
  dimensions: PsychosocialDimensions;
  assessmentSummary: string;
  formVersionReference: "manual-psychosocial-v1";
};

export type CreatePsychosocialDraftInput = PsychosocialAssessmentFields & {
  action: "create_draft";
  idempotencyKey: string;
};

export type RevisePsychosocialDraftInput = PsychosocialAssessmentFields & {
  action: "revise_draft";
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type SignPsychosocialAssessmentInput = {
  action: "sign";
  clientId: string;
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type CorrectPsychosocialAssessmentInput = PsychosocialAssessmentFields & {
  action: "correct";
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  correctionReason: string;
  idempotencyKey: string;
};

export type PsychosocialAssessmentMutationInput =
  | RevisePsychosocialDraftInput
  | SignPsychosocialAssessmentInput
  | CorrectPsychosocialAssessmentInput;

export type PsychosocialAssessmentOperationResult = {
  action: "create_draft" | "revise_draft" | "sign" | "correct";
  operationId: string;
  clientId: string;
  assessmentKey: string;
  versionId: string;
  assessmentVersion: number;
  recordState: PsychosocialRecordState;
  assessedOn: string;
  responsibleUserId: string;
  serviceStatusAtAssessment: ClientServiceStatus;
  reassessmentDueOn: string;
  formVersionReference: "manual-psychosocial-v1";
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
