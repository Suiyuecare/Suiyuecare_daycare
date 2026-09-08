export const ADAPTATION_RECORD_STATES = ["draft", "signed", "corrected"] as const;
export const ADAPTATION_STATUSES = ["settled", "adjusting", "support_requested"] as const;
export const ADAPTATION_FOLLOW_UP_STATUSES = ["pending", "completed", "cancelled"] as const;
export const CLIENT_SERVICE_STATUSES = ["active", "suspended", "transferred", "closed", "deceased"] as const;

export type AdaptationRecordState = (typeof ADAPTATION_RECORD_STATES)[number];
export type AdaptationStatus = (typeof ADAPTATION_STATUSES)[number];
export type AdaptationFollowUpStatus = (typeof ADAPTATION_FOLLOW_UP_STATUSES)[number];
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUSES)[number];
export type AdaptationCurrentFollowUpStatus =
  | "not_assessed"
  | "not_required"
  | "not_started"
  | AdaptationFollowUpStatus;

export type AdaptationClientOption = {
  clientId: string;
  displayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
};

export type AdaptationAssessorOption = {
  userId: string;
  displayName: string;
};

export type AdaptationVersionHistoryItem = {
  versionId: string;
  assessmentVersion: number;
  recordState: AdaptationRecordState;
  assessedOn: string;
  adaptationStatus: AdaptationStatus;
  assessmentSummary: string;
  reassessmentDueOn: string;
  needsFollowUp: boolean;
  formBasis: "manual_unstandardized";
  formVersionReference: "manual-adaptation-v1";
  correctionReason: string | null;
  assessorDisplayName: string;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string;
};

export type AdaptationFollowUpHistoryItem = {
  eventId: string;
  sequence: number;
  status: AdaptationFollowUpStatus;
  dueOn: string | null;
  plan: string | null;
  outcome: string | null;
  transitionReason: string | null;
  committerDisplayName: string;
  committedAt: string;
};

export type AdaptationAssessmentListItem = {
  clientId: string;
  clientDisplayName: string;
  serviceStatus: ClientServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
  versionId: string | null;
  assessmentKey: string | null;
  assessmentVersion: number | null;
  recordState: AdaptationRecordState | null;
  assessedOn: string | null;
  adaptationStatus: AdaptationStatus | null;
  assessmentSummary: string | null;
  reassessmentDueOn: string | null;
  reassessmentDue: boolean;
  needsFollowUp: boolean;
  currentFollowUpStatus: AdaptationCurrentFollowUpStatus;
  formBasis: "manual_unstandardized" | null;
  formVersionReference: "manual-adaptation-v1" | null;
  assessorUserId: string | null;
  assessorDisplayName: string | null;
  correctionReason: string | null;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string | null;
  followUpEventId: string | null;
  followUpSequence: number;
  followUpStatus: AdaptationFollowUpStatus | null;
  followUpDueOn: string | null;
  followUpPlan: string | null;
  followUpOutcome: string | null;
  followUpTransitionReason: string | null;
  followUpCommitterDisplayName: string | null;
  followUpCommittedAt: string | null;
  followUpOverdue: boolean;
  versionHistory: readonly AdaptationVersionHistoryItem[];
  versionHistoryTotal: number;
  versionHistoryTruncated: boolean;
  followUpHistory: readonly AdaptationFollowUpHistoryItem[];
  followUpHistoryTotal: number;
  followUpHistoryTruncated: boolean;
};

export type AdaptationAssessmentFilters = {
  clientId: string | null;
  serviceStatus: ClientServiceStatus | null;
  assessmentPresence: "all" | "assessed" | "not_assessed";
  reassessmentStatus: "all" | "due" | "upcoming";
  adaptationStatus: AdaptationStatus | null;
  followUpFilter: "all" | "needs_follow_up" | "no_follow_up" | "open" | "overdue";
};

export type AdaptationAssessmentSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly AdaptationAssessmentListItem[];
  itemTotal: number;
  matchingTotal: number;
  itemsTruncated: boolean;
  metrics: {
    assessed: number;
    notAssessed: number;
    reassessmentDue: number;
    needsFollowUp: number;
    openFollowUp: number;
    overdueFollowUp: number;
    drafts: number;
    completed: number;
  };
  clientOptions: readonly AdaptationClientOption[];
  clientOptionsTruncated: boolean;
  assessorOptions: readonly AdaptationAssessorOption[];
  assessorOptionsTruncated: boolean;
  assessmentMethodStatus: "manual_unstandardized_only";
  formPublicationStatus: "not_published_not_claimed";
  offlineSyncStatus: "not_configured";
  followUpNotificationStatus: "none_not_sent";
  demo: boolean;
};

export type AdaptationAssessmentFields = {
  clientId: string;
  assessedOn: string;
  adaptationStatus: AdaptationStatus;
  assessmentSummary: string;
  reassessmentDueOn: string;
  needsFollowUp: boolean;
  formVersionReference: "manual-adaptation-v1";
};

export type CreateAdaptationDraftInput = AdaptationAssessmentFields & {
  action: "create_draft";
  idempotencyKey: string;
};

export type ReviseAdaptationDraftInput = AdaptationAssessmentFields & {
  action: "revise_draft";
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type SignAdaptationAssessmentInput = {
  action: "sign";
  clientId: string;
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type CorrectAdaptationAssessmentInput = AdaptationAssessmentFields & {
  action: "correct";
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  correctionReason: string;
  idempotencyKey: string;
};

export type AdaptationAssessmentMutationInput =
  | ReviseAdaptationDraftInput
  | SignAdaptationAssessmentInput
  | CorrectAdaptationAssessmentInput;

export type AdaptationFollowUpMutationInput = {
  action: "track" | "complete_follow_up" | "cancel_follow_up";
  clientId: string;
  assessmentKey: string;
  assessmentVersionId: string;
  expectedSequence: number;
  dueOn: string | null;
  followUpPlan: string | null;
  followUpOutcome: string | null;
  transitionReason: string | null;
  idempotencyKey: string;
};

export type AdaptationAssessmentOperationResult = {
  receiptKind: "assessment";
  action: "create_draft" | "revise_draft" | "sign" | "correct";
  operationId: string;
  clientId: string;
  assessmentKey: string;
  versionId: string;
  assessmentVersion: number;
  recordState: AdaptationRecordState;
  assessedOn: string;
  adaptationStatus: AdaptationStatus;
  reassessmentDueOn: string;
  needsFollowUp: boolean;
  formVersionReference: "manual-adaptation-v1";
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type AdaptationFollowUpOperationResult = {
  receiptKind: "follow_up";
  action: "track" | "complete_follow_up" | "cancel_follow_up";
  operationId: string;
  clientId: string;
  assessmentKey: string;
  followUpEventId: string;
  followUpSequence: number;
  followUpStatus: AdaptationFollowUpStatus;
  dueOn: string | null;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type AdaptationOperationResult =
  | AdaptationAssessmentOperationResult
  | AdaptationFollowUpOperationResult;
