export const CASE_SERVICE_RECORD_STATES = ["draft", "signed", "corrected"] as const;
export const CASE_SERVICE_EXECUTION_STATUSES = ["not_linked", "linked_completed_event"] as const;
export const CASE_SERVICE_EXECUTION_VERIFICATIONS = [
  "not_linked",
  "verified_completed",
  "changed_or_unavailable",
] as const;

export type CaseServiceRecordState = (typeof CASE_SERVICE_RECORD_STATES)[number];
export type CaseServiceExecutionStatus = (typeof CASE_SERVICE_EXECUTION_STATUSES)[number];
export type CaseServiceExecutionVerification =
  (typeof CASE_SERVICE_EXECUTION_VERIFICATIONS)[number];

export type CaseServiceRecordFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  clientId: string | null;
  serviceType: string | null;
  authorUserId: string | null;
  recordState: CaseServiceRecordState | "all";
};

export type CaseServiceClientOption = { clientId: string; displayName: string };
export type CaseServiceAuthorOption = { userId: string; displayName: string };

export type CaseServiceRecordFields = {
  clientId: string;
  startedAt: string;
  endedAt: string;
  serviceType: string;
  serviceContent: string;
  serviceResult: string;
  executionReferenceId: string | null;
};

export type CaseServiceRecordVersion = CaseServiceRecordFields & {
  versionId: string;
  recordKey: string;
  version: number;
  previousVersionId: string | null;
  contentHash: string;
  recordState: CaseServiceRecordState;
  clientDisplayName: string;
  executionReferenceStatus: CaseServiceExecutionStatus;
  executionReferenceContentHash: string | null;
  executionReferenceVerification: CaseServiceExecutionVerification;
  authorUserId: string;
  authorDisplayName: string;
  revisionReason: string | null;
  correctionReason: string | null;
  signedAt: string | null;
  signedByUserId: string | null;
  signerDisplayName: string | null;
  signerRoleKeys: readonly string[] | null;
  signaturePurpose: string | null;
  signatureReauthChallengeId: string | null;
  sourceKind: "manual_local";
  schemaKind: "manual_service_narrative_v1";
  statutoryRuleStatus: "not_configured";
  claimEligibilityStatus: "not_configured";
  createdAt: string;
};

export type CaseServiceRecord = CaseServiceRecordVersion & {
  history: readonly CaseServiceRecordVersion[];
  historyTotal: number;
  historyTruncated: boolean;
};

export type CaseServiceRecordSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  filters: CaseServiceRecordFilters;
  records: readonly CaseServiceRecord[];
  matchingTotal: number;
  recordsTruncated: boolean;
  metrics: {
    serviceTotal: number;
    draftTotal: number;
    signedTotal: number;
    correctedTotal: number;
    linkedExecutionTotal: number;
    changedExecutionTotal: number;
  };
  clients: readonly CaseServiceClientOption[];
  clientTotal: number;
  clientsTruncated: boolean;
  serviceTypes: readonly string[];
  serviceTypeTotal: number;
  serviceTypesTruncated: boolean;
  authors: readonly CaseServiceAuthorOption[];
  authorTotal: number;
  authorsTruncated: boolean;
  schemaKind: "manual_service_narrative_v1";
  statutoryRuleStatus: "not_configured";
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  notificationStatus: "not_configured";
  offlineStatus: "not_configured";
  claimEligibilityStatus: "not_configured";
  demo: boolean;
};

export type SaveCaseServiceRecordInput = CaseServiceRecordFields & {
  action: "save_record";
  mode: "create" | "revise";
  recordKey: string | null;
  previousVersionId: string | null;
  expectedVersion: number;
  expectedContentHash: string | null;
  revisionReason: string;
  idempotencyKey: string;
};

export type SignCaseServiceRecordInput = {
  action: "sign_record";
  clientId: string;
  recordKey: string;
  previousVersionId: string;
  expectedVersion: number;
  expectedContentHash: string;
  expectedRecordPayload: CaseServiceRecordReceiptPayload;
  idempotencyKey: string;
};

export type CorrectCaseServiceRecordInput = CaseServiceRecordFields & {
  action: "correct_record";
  recordKey: string;
  previousVersionId: string;
  expectedVersion: number;
  expectedContentHash: string;
  expectedAuthorUserId: string;
  reason: string;
  idempotencyKey: string;
};

export type CaseServiceRecordMutationInput =
  | SaveCaseServiceRecordInput
  | SignCaseServiceRecordInput
  | CorrectCaseServiceRecordInput;

export type CaseServiceRecordReceiptPayload = CaseServiceRecordFields & {
  executionReferenceStatus: CaseServiceExecutionStatus;
  executionReferenceContentHash: string | null;
  authorUserId: string;
  sourceKind: "manual_local";
  schemaKind: "manual_service_narrative_v1";
  statutoryRuleStatus: "not_configured";
  claimEligibilityStatus: "not_configured";
};

export type CaseServiceRecordReceipt = {
  organizationId: string;
  branchId: string;
  clientId: string;
  actorUserId: string;
  operationId: string;
  idempotencyKey: string;
  action: CaseServiceRecordMutationInput["action"];
  recordKey: string;
  versionId: string;
  version: number;
  recordState: CaseServiceRecordState;
  previousVersionId: string | null;
  sourceContentHash: string | null;
  contentHash: string;
  recordPayload: CaseServiceRecordReceiptPayload;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
