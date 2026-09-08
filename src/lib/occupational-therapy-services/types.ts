export const OCCUPATIONAL_THERAPY_SERVICE_RECORD_STATES = [
  "draft", "signed", "corrected",
] as const;
export const OCCUPATIONAL_THERAPY_SERVICE_VALUE_STATES = [
  "recorded", "missing", "not_applicable",
] as const;
export const CLIENT_SERVICE_STATUSES = [
  "active", "suspended", "transferred", "closed", "deceased",
] as const;

export type OccupationalTherapyServiceRecordState =
  (typeof OCCUPATIONAL_THERAPY_SERVICE_RECORD_STATES)[number];
export type OccupationalTherapyServiceValueState =
  (typeof OCCUPATIONAL_THERAPY_SERVICE_VALUE_STATES)[number];
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUSES)[number];

export type OccupationalTherapyServiceValue = {
  state: OccupationalTherapyServiceValueState;
  text: string | null;
  reason: string | null;
};

export type OccupationalTherapyServiceClientOption = {
  clientId: string;
  displayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
};

export type OccupationalTherapyServiceTherapistOption = {
  userId: string;
  displayName: string;
};

export type OccupationalTherapyAssessmentReference = {
  status: "linked" | "none_available";
  versionId: string | null;
  assessmentKey: string | null;
  assessmentVersion: number | null;
  assessedOn: string | null;
  therapistDisplayName: string | null;
};

export type OccupationalTherapyServiceVersionHistoryItem = {
  versionId: string;
  recordVersion: number;
  recordState: OccupationalTherapyServiceRecordState;
  occurredAt: string;
  serviceContent: OccupationalTherapyServiceValue;
  clientReaction: OccupationalTherapyServiceValue;
  recommendation: OccupationalTherapyServiceValue;
  therapistUserId: string;
  therapistDisplayName: string;
  serviceStatusAtOccurrence: ClientServiceStatus;
  assessmentReference: OccupationalTherapyAssessmentReference;
  correctionReason: string | null;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string;
};

export type OccupationalTherapyServiceRecord = {
  recordKey: string;
  versionId: string;
  recordVersion: number;
  recordState: OccupationalTherapyServiceRecordState;
  clientId: string;
  clientDisplayName: string;
  occurredAt: string;
  serviceContent: OccupationalTherapyServiceValue;
  clientReaction: OccupationalTherapyServiceValue;
  recommendation: OccupationalTherapyServiceValue;
  therapistUserId: string;
  therapistDisplayName: string;
  serviceStatusAtOccurrence: ClientServiceStatus;
  assessmentReference: OccupationalTherapyAssessmentReference;
  correctionReason: string | null;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string;
  versionHistory: readonly OccupationalTherapyServiceVersionHistoryItem[];
  versionHistoryTotal: number;
  versionHistoryTruncated: boolean;
};

export type OccupationalTherapyServiceFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  clientId: string | null;
  therapistUserId: string | null;
  recordState: OccupationalTherapyServiceRecordState | null;
  keyword: string | null;
};

export type OccupationalTherapyServiceSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  records: readonly OccupationalTherapyServiceRecord[];
  recordTotal: number;
  matchingTotal: number;
  recordsTruncated: boolean;
  metrics: {
    today: number;
    drafts: number;
    signed: number;
    corrected: number;
    linkedAssessments: number;
  };
  clientOptions: readonly OccupationalTherapyServiceClientOption[];
  clientOptionsTruncated: boolean;
  therapistOptions: readonly OccupationalTherapyServiceTherapistOption[];
  therapistOptionsTruncated: boolean;
  assessmentLinkStatus: "readonly_latest_terminal";
  formulaStatus: "not_configured";
  diagnosisStatus: "not_configured";
  automaticRecommendationStatus: "not_configured";
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  offlineSyncStatus: "not_configured";
  demo: boolean;
};

export type OccupationalTherapyServiceFields = {
  clientId: string;
  occurredAt: string;
  serviceContent: OccupationalTherapyServiceValue;
  clientReaction: OccupationalTherapyServiceValue;
  recommendation: OccupationalTherapyServiceValue;
};

export type CreateOccupationalTherapyServiceDraftInput =
  OccupationalTherapyServiceFields & {
    action: "create_draft";
    idempotencyKey: string;
  };

export type ReviseOccupationalTherapyServiceDraftInput =
  OccupationalTherapyServiceFields & {
    action: "revise_draft";
    recordKey: string;
    previousVersionId: string;
    expectedVersion: number;
    idempotencyKey: string;
  };

export type SignOccupationalTherapyServiceInput = {
  action: "sign";
  clientId: string;
  recordKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type CorrectOccupationalTherapyServiceInput =
  OccupationalTherapyServiceFields & {
    action: "correct";
    recordKey: string;
    previousVersionId: string;
    expectedVersion: number;
    correctionReason: string;
    idempotencyKey: string;
  };

export type OccupationalTherapyServiceMutationInput =
  | ReviseOccupationalTherapyServiceDraftInput
  | SignOccupationalTherapyServiceInput
  | CorrectOccupationalTherapyServiceInput;

export type OccupationalTherapyServiceOperationResult = {
  action: "create_draft" | "revise_draft" | "sign" | "correct";
  operationId: string;
  organizationId: string;
  branchId: string;
  clientId: string;
  recordKey: string;
  versionId: string;
  recordVersion: number;
  recordState: OccupationalTherapyServiceRecordState;
  occurredAt: string;
  therapistUserId: string;
  serviceStatusAtOccurrence: ClientServiceStatus;
  assessmentReferenceVersionId: string | null;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
