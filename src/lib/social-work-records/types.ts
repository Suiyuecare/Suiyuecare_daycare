export const SOCIAL_WORK_RECORD_STATES = ["draft", "signed", "corrected"] as const;
export const SOCIAL_WORK_FOLLOW_UP_STATUSES = ["pending", "completed", "cancelled"] as const;

export type SocialWorkRecordState = (typeof SOCIAL_WORK_RECORD_STATES)[number];
export type SocialWorkFollowUpStatus = (typeof SOCIAL_WORK_FOLLOW_UP_STATUSES)[number];

export type SocialWorkClientOption = {
  clientId: string;
  displayName: string;
  clientStatus: "active" | "suspended" | "transferred" | "closed" | "deceased";
  admittedOn: string | null;
  endedOn: string | null;
};

export type SocialWorkAuthorOption = {
  userId: string;
  displayName: string;
};

export type SocialWorkVersionHistoryItem = {
  versionId: string;
  recordVersion: number;
  recordState: SocialWorkRecordState;
  occurredAt: string;
  serviceType: string;
  serviceContent: string;
  serviceResult: string;
  correctionReason: string | null;
  authorDisplayName: string;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string;
};

export type SocialWorkFollowUpHistoryItem = {
  eventId: string;
  sequence: number;
  status: SocialWorkFollowUpStatus;
  dueOn: string | null;
  plan: string | null;
  outcome: string | null;
  transitionReason: string | null;
  committerDisplayName: string;
  committedAt: string;
};

export type SocialWorkServiceRecord = {
  recordKey: string;
  versionId: string;
  recordVersion: number;
  recordState: SocialWorkRecordState;
  clientId: string;
  clientDisplayName: string;
  occurredAt: string;
  serviceType: string;
  serviceContent: string;
  serviceResult: string;
  authorUserId: string;
  authorDisplayName: string;
  correctionReason: string | null;
  signedAt: string | null;
  signerDisplayName: string | null;
  createdAt: string;
  followUpEventId: string | null;
  followUpSequence: number;
  followUpStatus: SocialWorkFollowUpStatus | null;
  followUpDueOn: string | null;
  followUpPlan: string | null;
  followUpOutcome: string | null;
  followUpTransitionReason: string | null;
  followUpCommitterDisplayName: string | null;
  followUpCommittedAt: string | null;
  followUpOverdue: boolean;
  versionHistory: readonly SocialWorkVersionHistoryItem[];
  versionHistoryTotal: number;
  versionHistoryTruncated: boolean;
  followUpHistory: readonly SocialWorkFollowUpHistoryItem[];
  followUpHistoryTotal: number;
  followUpHistoryTruncated: boolean;
};

export type SocialWorkRecordFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  clientId: string | null;
  serviceType: string | null;
  authorUserId: string | null;
};

export type SocialWorkRecordSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  records: readonly SocialWorkServiceRecord[];
  recordTotal: number;
  matchingTotal: number;
  recordsTruncated: boolean;
  metrics: {
    currentMonth: number;
    pendingFollowUp: number;
    overdueFollowUp: number;
    drafts: number;
    signed: number;
  };
  clientOptions: readonly SocialWorkClientOption[];
  clientOptionsTruncated: boolean;
  serviceTypeOptions: readonly string[];
  serviceTypeOptionsTruncated: boolean;
  authorOptions: readonly SocialWorkAuthorOption[];
  authorOptionsTruncated: boolean;
  offlineSyncStatus: "not_configured";
  followUpNotificationStatus: "none_not_sent";
  demo: boolean;
};

export type SocialWorkRecordFields = {
  clientId: string;
  occurredAt: string;
  serviceType: string;
  serviceContent: string;
  serviceResult: string;
};

export type CreateSocialWorkDraftInput = SocialWorkRecordFields & {
  action: "create_draft";
  idempotencyKey: string;
};

export type ReviseSocialWorkDraftInput = SocialWorkRecordFields & {
  action: "revise_draft";
  recordKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type SignSocialWorkRecordInput = {
  action: "sign";
  clientId: string;
  recordKey: string;
  previousVersionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type CorrectSocialWorkRecordInput = SocialWorkRecordFields & {
  action: "correct";
  recordKey: string;
  previousVersionId: string;
  expectedVersion: number;
  correctionReason: string;
  idempotencyKey: string;
};

export type SocialWorkRecordMutationInput =
  | ReviseSocialWorkDraftInput
  | SignSocialWorkRecordInput
  | CorrectSocialWorkRecordInput;

export type SocialWorkFollowUpMutationInput = {
  action: "track" | "complete_follow_up" | "cancel_follow_up";
  clientId: string;
  recordKey: string;
  serviceVersionId: string;
  expectedSequence: number;
  dueOn: string | null;
  followUpPlan: string | null;
  followUpOutcome: string | null;
  transitionReason: string | null;
  idempotencyKey: string;
};

export type SocialWorkRecordOperationResult = {
  receiptKind: "record";
  action: "create_draft" | "revise_draft" | "sign" | "correct";
  operationId: string;
  recordKey: string;
  versionId: string;
  recordVersion: number;
  recordState: SocialWorkRecordState;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type SocialWorkFollowUpOperationResult = {
  receiptKind: "follow_up";
  action: "track" | "complete_follow_up" | "cancel_follow_up";
  operationId: string;
  recordKey: string;
  followUpEventId: string;
  followUpSequence: number;
  followUpStatus: SocialWorkFollowUpStatus;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type SocialWorkOperationResult =
  | SocialWorkRecordOperationResult
  | SocialWorkFollowUpOperationResult;
