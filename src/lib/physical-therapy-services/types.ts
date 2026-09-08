export const PHYSICAL_THERAPY_SERVICE_RECORD_STATES = [
  "draft", "signed", "corrected",
] as const;
export const PHYSICAL_THERAPY_SERVICE_VALUE_STATES = [
  "recorded", "missing", "not_applicable",
] as const;
export const CLIENT_SERVICE_STATUSES = [
  "active", "suspended", "transferred", "closed", "deceased",
] as const;

export type PhysicalTherapyServiceRecordState =
  (typeof PHYSICAL_THERAPY_SERVICE_RECORD_STATES)[number];
export type PhysicalTherapyServiceValueState =
  (typeof PHYSICAL_THERAPY_SERVICE_VALUE_STATES)[number];
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUSES)[number];

export type PhysicalTherapyServiceValue = {
  state: PhysicalTherapyServiceValueState;
  text: string | null;
  reason: string | null;
};

export type PhysicalTherapyServiceClientOption = {
  clientId: string;
  displayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
};

export type PhysicalTherapyServiceTherapistOption = {
  userId: string;
  displayName: string;
};

export type PhysicalTherapyAssessmentReference = {
  status: "linked" | "none_available";
  versionId: string | null;
  assessmentKey: string | null;
  assessmentVersion: number | null;
  assessedOn: string | null;
  therapistDisplayName: string | null;
};

export type PhysicalTherapyServiceVersionHistoryItem = {
  versionId: string;
  recordVersion: number;
  recordState: PhysicalTherapyServiceRecordState;
  occurredAt: string;
  serviceContent: PhysicalTherapyServiceValue;
  clientReaction: PhysicalTherapyServiceValue;
  recommendation: PhysicalTherapyServiceValue;
  therapistUserId: string;
  therapistDisplayName: string;
  serviceStatusAtOccurrence: ClientServiceStatus;
  assessmentReference: PhysicalTherapyAssessmentReference;
  correctionReason: string | null;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string;
};

export type PhysicalTherapyServiceRecord = {
  recordKey: string;
  versionId: string;
  recordVersion: number;
  recordState: PhysicalTherapyServiceRecordState;
  clientId: string;
  clientDisplayName: string;
  occurredAt: string;
  serviceContent: PhysicalTherapyServiceValue;
  clientReaction: PhysicalTherapyServiceValue;
  recommendation: PhysicalTherapyServiceValue;
  therapistUserId: string;
  therapistDisplayName: string;
  serviceStatusAtOccurrence: ClientServiceStatus;
  assessmentReference: PhysicalTherapyAssessmentReference;
  correctionReason: string | null;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string;
  versionHistory: readonly PhysicalTherapyServiceVersionHistoryItem[];
  versionHistoryTotal: number;
  versionHistoryTruncated: boolean;
};

export type PhysicalTherapyServiceFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  clientId: string | null;
  therapistUserId: string | null;
  recordState: PhysicalTherapyServiceRecordState | null;
  keyword: string | null;
};

export type PhysicalTherapyServiceSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  records: readonly PhysicalTherapyServiceRecord[];
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
  clientOptions: readonly PhysicalTherapyServiceClientOption[];
  clientOptionsTruncated: boolean;
  therapistOptions: readonly PhysicalTherapyServiceTherapistOption[];
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

export type PhysicalTherapyServiceFields = {
  clientId: string;
  occurredAt: string;
  serviceContent: PhysicalTherapyServiceValue;
  clientReaction: PhysicalTherapyServiceValue;
  recommendation: PhysicalTherapyServiceValue;
};

export type CreatePhysicalTherapyServiceDraftInput =
  PhysicalTherapyServiceFields & {
    action: "create_draft";
    idempotencyKey: string;
  };

export type RevisePhysicalTherapyServiceDraftInput =
  PhysicalTherapyServiceFields & {
    action: "revise_draft";
    recordKey: string;
    previousVersionId: string;
    expectedVersion: number;
    idempotencyKey: string;
  };

export type SignPhysicalTherapyServiceInput = {
  action: "sign";
  clientId: string;
  recordKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type CorrectPhysicalTherapyServiceInput =
  PhysicalTherapyServiceFields & {
    action: "correct";
    recordKey: string;
    previousVersionId: string;
    expectedVersion: number;
    correctionReason: string;
    idempotencyKey: string;
  };

export type PhysicalTherapyServiceMutationInput =
  | RevisePhysicalTherapyServiceDraftInput
  | SignPhysicalTherapyServiceInput
  | CorrectPhysicalTherapyServiceInput;

export type PhysicalTherapyServiceOperationResult = {
  action: "create_draft" | "revise_draft" | "sign" | "correct";
  operationId: string;
  organizationId: string;
  branchId: string;
  clientId: string;
  recordKey: string;
  versionId: string;
  recordVersion: number;
  recordState: PhysicalTherapyServiceRecordState;
  occurredAt: string;
  therapistUserId: string;
  serviceStatusAtOccurrence: ClientServiceStatus;
  assessmentReferenceVersionId: string | null;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
