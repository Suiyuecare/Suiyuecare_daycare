export const PHYSICAL_THERAPY_RECORD_STATES = [
  "draft", "signed", "corrected",
] as const;
export const PHYSICAL_THERAPY_MEASUREMENT_STATES = [
  "numeric", "text", "missing", "not_applicable",
] as const;
export const CLIENT_SERVICE_STATUSES = [
  "active", "suspended", "transferred", "closed", "deceased",
] as const;

export type PhysicalTherapyRecordState =
  (typeof PHYSICAL_THERAPY_RECORD_STATES)[number];
export type PhysicalTherapyMeasurementState =
  (typeof PHYSICAL_THERAPY_MEASUREMENT_STATES)[number];
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUSES)[number];

export type PhysicalTherapyMeasurement = {
  name: string;
  state: PhysicalTherapyMeasurementState;
  value: string | null;
  unit: string | null;
  reason: string | null;
};

export type PhysicalTherapyClientOption = {
  clientId: string;
  displayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
};

export type PhysicalTherapyTherapistOption = {
  userId: string;
  displayName: string;
};

export type PhysicalTherapyVersionHistoryItem = {
  versionId: string;
  assessmentVersion: number;
  recordState: PhysicalTherapyRecordState;
  assessedOn: string;
  therapistUserId: string;
  therapistDisplayName: string;
  serviceStatusAtAssessment: ClientServiceStatus;
  reassessmentDueOn: string;
  dueBasis: string;
  measurements: readonly PhysicalTherapyMeasurement[];
  functionalObservation: string;
  goals: string;
  recommendations: string;
  followUpPlan: string;
  formBasis: "manual_unstandardized";
  formVersionReference: "manual-physical-therapy-v1";
  correctionReason: string | null;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string;
};

export type PhysicalTherapyAssessmentListItem = {
  clientId: string;
  clientDisplayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
  versionId: string | null;
  assessmentKey: string | null;
  assessmentVersion: number | null;
  recordState: PhysicalTherapyRecordState | null;
  assessedOn: string | null;
  therapistUserId: string | null;
  therapistDisplayName: string | null;
  serviceStatusAtAssessment: ClientServiceStatus | null;
  reassessmentDueOn: string | null;
  reassessmentDue: boolean;
  dueBasis: string | null;
  measurements: readonly PhysicalTherapyMeasurement[] | null;
  functionalObservation: string | null;
  goals: string | null;
  recommendations: string | null;
  followUpPlan: string | null;
  formBasis: "manual_unstandardized" | null;
  formVersionReference: "manual-physical-therapy-v1" | null;
  correctionReason: string | null;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string | null;
  versionHistory: readonly PhysicalTherapyVersionHistoryItem[];
  versionHistoryTotal: number;
  versionHistoryTruncated: boolean;
};

export type PhysicalTherapyAssessmentFilters = {
  clientId: string | null;
  therapistUserId: string | null;
  serviceStatus: ClientServiceStatus | null;
  dueStatus: "all" | "due" | "upcoming" | "not_assessed";
};

export type PhysicalTherapyAssessmentSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly PhysicalTherapyAssessmentListItem[];
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
  clientOptions: readonly PhysicalTherapyClientOption[];
  clientOptionsTruncated: boolean;
  therapistOptions: readonly PhysicalTherapyTherapistOption[];
  therapistOptionsTruncated: boolean;
  assessmentMethodStatus: "manual_unstandardized_only";
  formPublicationStatus: "not_published_not_claimed";
  dueRuleStatus: "not_configured_manual_date_and_basis_only";
  formulaStatus: "not_configured";
  scoreStatus: "not_configured";
  diagnosisStatus: "not_configured";
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  reminderStatus: "not_configured";
  offlineSyncStatus: "not_configured";
  demo: boolean;
};

export type PhysicalTherapyAssessmentFields = {
  clientId: string;
  assessedOn: string;
  reassessmentDueOn: string;
  dueBasis: string;
  measurements: readonly PhysicalTherapyMeasurement[];
  functionalObservation: string;
  goals: string;
  recommendations: string;
  followUpPlan: string;
  formVersionReference: "manual-physical-therapy-v1";
};

export type CreatePhysicalTherapyDraftInput =
  PhysicalTherapyAssessmentFields & {
    action: "create_draft";
    idempotencyKey: string;
  };

export type RevisePhysicalTherapyDraftInput =
  PhysicalTherapyAssessmentFields & {
    action: "revise_draft";
    assessmentKey: string;
    previousVersionId: string;
    expectedVersion: number;
    idempotencyKey: string;
  };

export type SignPhysicalTherapyAssessmentInput = {
  action: "sign";
  clientId: string;
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type CorrectPhysicalTherapyAssessmentInput =
  PhysicalTherapyAssessmentFields & {
    action: "correct";
    assessmentKey: string;
    previousVersionId: string;
    expectedVersion: number;
    correctionReason: string;
    idempotencyKey: string;
  };

export type PhysicalTherapyAssessmentMutationInput =
  | RevisePhysicalTherapyDraftInput
  | SignPhysicalTherapyAssessmentInput
  | CorrectPhysicalTherapyAssessmentInput;

export type PhysicalTherapyAssessmentOperationResult = {
  action: "create_draft" | "revise_draft" | "sign" | "correct";
  operationId: string;
  clientId: string;
  assessmentKey: string;
  versionId: string;
  assessmentVersion: number;
  recordState: PhysicalTherapyRecordState;
  assessedOn: string;
  therapistUserId: string;
  serviceStatusAtAssessment: ClientServiceStatus;
  reassessmentDueOn: string;
  formVersionReference: "manual-physical-therapy-v1";
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
