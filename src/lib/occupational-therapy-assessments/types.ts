export const OCCUPATIONAL_THERAPY_RECORD_STATES = [
  "draft", "signed", "corrected",
] as const;
export const OCCUPATIONAL_THERAPY_MEASUREMENT_STATES = [
  "numeric", "text", "missing", "not_applicable",
] as const;
export const CLIENT_SERVICE_STATUSES = [
  "active", "suspended", "transferred", "closed", "deceased",
] as const;

export type OccupationalTherapyRecordState =
  (typeof OCCUPATIONAL_THERAPY_RECORD_STATES)[number];
export type OccupationalTherapyMeasurementState =
  (typeof OCCUPATIONAL_THERAPY_MEASUREMENT_STATES)[number];
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUSES)[number];

export type OccupationalTherapyMeasurement = {
  name: string;
  state: OccupationalTherapyMeasurementState;
  value: string | null;
  unit: string | null;
  reason: string | null;
};

export type OccupationalTherapyClientOption = {
  clientId: string;
  displayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
};

export type OccupationalTherapyTherapistOption = {
  userId: string;
  displayName: string;
};

export type OccupationalTherapyVersionHistoryItem = {
  versionId: string;
  assessmentVersion: number;
  recordState: OccupationalTherapyRecordState;
  assessedOn: string;
  therapistUserId: string;
  therapistDisplayName: string;
  serviceStatusAtAssessment: ClientServiceStatus;
  reassessmentDueOn: string;
  dueBasis: string;
  measurements: readonly OccupationalTherapyMeasurement[];
  functionalObservation: string;
  goals: string;
  recommendations: string;
  followUpPlan: string;
  formBasis: "manual_unstandardized";
  formVersionReference: "manual-occupational-therapy-v1";
  correctionReason: string | null;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string;
};

export type OccupationalTherapyAssessmentListItem = {
  clientId: string;
  clientDisplayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
  versionId: string | null;
  assessmentKey: string | null;
  assessmentVersion: number | null;
  recordState: OccupationalTherapyRecordState | null;
  assessedOn: string | null;
  therapistUserId: string | null;
  therapistDisplayName: string | null;
  serviceStatusAtAssessment: ClientServiceStatus | null;
  reassessmentDueOn: string | null;
  reassessmentDue: boolean;
  dueBasis: string | null;
  measurements: readonly OccupationalTherapyMeasurement[] | null;
  functionalObservation: string | null;
  goals: string | null;
  recommendations: string | null;
  followUpPlan: string | null;
  formBasis: "manual_unstandardized" | null;
  formVersionReference: "manual-occupational-therapy-v1" | null;
  correctionReason: string | null;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string | null;
  versionHistory: readonly OccupationalTherapyVersionHistoryItem[];
  versionHistoryTotal: number;
  versionHistoryTruncated: boolean;
};

export type OccupationalTherapyAssessmentFilters = {
  clientId: string | null;
  therapistUserId: string | null;
  serviceStatus: ClientServiceStatus | null;
  dueStatus: "all" | "due" | "upcoming" | "not_assessed";
};

export type OccupationalTherapyAssessmentSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly OccupationalTherapyAssessmentListItem[];
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
  clientOptions: readonly OccupationalTherapyClientOption[];
  clientOptionsTruncated: boolean;
  therapistOptions: readonly OccupationalTherapyTherapistOption[];
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

export type OccupationalTherapyAssessmentFields = {
  clientId: string;
  assessedOn: string;
  reassessmentDueOn: string;
  dueBasis: string;
  measurements: readonly OccupationalTherapyMeasurement[];
  functionalObservation: string;
  goals: string;
  recommendations: string;
  followUpPlan: string;
  formVersionReference: "manual-occupational-therapy-v1";
};

export type CreateOccupationalTherapyDraftInput =
  OccupationalTherapyAssessmentFields & {
    action: "create_draft";
    idempotencyKey: string;
  };

export type ReviseOccupationalTherapyDraftInput =
  OccupationalTherapyAssessmentFields & {
    action: "revise_draft";
    assessmentKey: string;
    previousVersionId: string;
    expectedVersion: number;
    idempotencyKey: string;
  };

export type SignOccupationalTherapyAssessmentInput = {
  action: "sign";
  clientId: string;
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type CorrectOccupationalTherapyAssessmentInput =
  OccupationalTherapyAssessmentFields & {
    action: "correct";
    assessmentKey: string;
    previousVersionId: string;
    expectedVersion: number;
    correctionReason: string;
    idempotencyKey: string;
  };

export type OccupationalTherapyAssessmentMutationInput =
  | ReviseOccupationalTherapyDraftInput
  | SignOccupationalTherapyAssessmentInput
  | CorrectOccupationalTherapyAssessmentInput;

export type OccupationalTherapyAssessmentOperationResult = {
  action: "create_draft" | "revise_draft" | "sign" | "correct";
  operationId: string;
  clientId: string;
  assessmentKey: string;
  versionId: string;
  assessmentVersion: number;
  recordState: OccupationalTherapyRecordState;
  assessedOn: string;
  therapistUserId: string;
  serviceStatusAtAssessment: ClientServiceStatus;
  reassessmentDueOn: string;
  formVersionReference: "manual-occupational-therapy-v1";
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
