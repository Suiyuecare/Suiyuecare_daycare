export const REFERRAL_STATUSES = [
  "draft", "submitted", "received", "responded", "closed",
] as const;
export const REFERRAL_RECEIVING_UNIT_STATES = [
  "manual_unstandardized", "missing", "not_applicable",
] as const;
export const REFERRAL_RECEIVING_UNIT_MODES = [
  "all", "manual_unstandardized", "missing", "not_applicable", "specific",
] as const;
export const REFERRAL_ACTIONS = [
  "create", "submit", "register_received", "respond", "close", "correct",
] as const;

export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
export type ReferralReceivingUnitState = (typeof REFERRAL_RECEIVING_UNIT_STATES)[number];
export type ReferralReceivingUnitMode = (typeof REFERRAL_RECEIVING_UNIT_MODES)[number];
export type ReferralAction = (typeof REFERRAL_ACTIONS)[number];

export type ReferralManagementFilters = {
  clientId: string | null;
  receivingUnitMode: ReferralReceivingUnitMode;
  receivingUnitCode: string | null;
  status: "all" | ReferralStatus;
  recentFrom: string | null;
  recentTo: string | null;
  query: string;
};

export type ReferralHistoryEntry = {
  eventId: string;
  sequence: number;
  eventKind: "created" | "submitted" | "receipt_registered" | "response_recorded" | "closed" | "corrected";
  correctsEventId: string | null;
  entryContent: string | null;
  correctionReason: string | null;
  status: ReferralStatus;
  occurredAt: string;
  actorDisplayName: string;
  contentHash: string;
  notificationRecipientCount: number;
};

export type ReferralManagementItem = {
  eventId: string;
  referralKey: string;
  sequence: number;
  previousEventId: string | null;
  correctsEventId: string | null;
  eventKind: ReferralHistoryEntry["eventKind"];
  clientId: string;
  clientDisplayName: string;
  clientCode: string;
  ownerUserId: string;
  ownerDisplayName: string;
  receivingUnitState: ReferralReceivingUnitState;
  receivingUnitCode: string | null;
  receivingUnitName: string | null;
  receivingUnitDirectoryStatus: "not_configured";
  referralDate: string;
  referralReason: string;
  entryContent: string | null;
  correctionReason: string | null;
  status: ReferralStatus;
  occurredAt: string;
  actorDisplayName: string;
  contentHash: string;
  notification: {
    queueStatus: "queued";
    deliveryClaim: "no_external_delivery_claim";
    providerStatus: "not_configured";
    recipientCount: number;
  };
  history: readonly ReferralHistoryEntry[];
};

export type ReferralClientOption = {
  clientId: string;
  displayName: string;
  clientCode: string;
};
export type ReferralReceivingUnitOption = {
  code: string;
  name: string;
  directoryStatus: "not_configured";
};

export type ReferralManagementSnapshot = {
  organizationId: string;
  organizationName: string;
  branchId: string;
  branchName: string;
  generatedAt: string;
  staleAfter: string;
  snapshotToken: string;
  items: readonly ReferralManagementItem[];
  metrics: {
    matching: number;
    draft: number;
    submitted: number;
    received: number;
    responded: number;
    closed: number;
    unitMissing: number;
    unitNotApplicable: number;
  };
  itemsTruncated: boolean;
  clientOptions: readonly ReferralClientOption[];
  receivingUnitOptions: readonly ReferralReceivingUnitOption[];
  canCreate: boolean;
  canSubmit: boolean;
  canRegisterReceipt: boolean;
  canRespond: boolean;
  canClose: boolean;
  canCorrect: boolean;
  receivingUnitDirectoryStatus: "not_configured";
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  notificationQueueStatus: "queued";
  notificationProviderStatus: "not_configured";
  externalDeliveryStatus: "not_configured";
  deliveryClaim: "no_external_delivery_claim";
  demo: boolean;
};

export type ReferralManagementMutationInput = {
  action: ReferralAction;
  referralKey: string | null;
  previousEventId: string | null;
  expectedSequence: number | null;
  clientId: string | null;
  receivingUnitState: ReferralReceivingUnitState | null;
  receivingUnitCode: string | null;
  receivingUnitName: string | null;
  referralDate: string | null;
  referralReason: string | null;
  entryContent: string | null;
  correctionReason: string | null;
  correctsEventId: string | null;
  idempotencyKey: string;
};

export type ReferralManagementOperationResult = {
  organizationId: string;
  branchId: string;
  operationId: string;
  operationKind: ReferralAction;
  referralKey: string;
  eventId: string;
  eventSequence: number;
  previousEventId: string | null;
  eventKind: ReferralHistoryEntry["eventKind"];
  referralStatus: ReferralStatus;
  receivingUnitState: ReferralReceivingUnitState;
  notificationCount: number;
  notificationQueueStatus: "queued";
  notificationProviderStatus: "not_configured";
  externalDeliveryStatus: "not_configured";
  deliveryClaim: "no_external_delivery_claim";
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
