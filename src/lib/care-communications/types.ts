export const CARE_COMMUNICATION_DELIVERY_FILTERS = ["all", "queued"] as const;
export const CARE_COMMUNICATION_CONFIRMATION_FILTERS = [
  "all",
  "not_configured",
] as const;

export type CareCommunicationDeliveryFilter =
  (typeof CARE_COMMUNICATION_DELIVERY_FILTERS)[number];
export type CareCommunicationConfirmationFilter =
  (typeof CARE_COMMUNICATION_CONFIRMATION_FILTERS)[number];

export type CareCommunicationFilters = {
  clientId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  authorUserId: string | null;
  deliveryStatus: CareCommunicationDeliveryFilter;
  confirmationStatus: CareCommunicationConfirmationFilter;
  query: string;
};

export type CareCommunicationRecipient = {
  displayName: string;
  profileKind: "family";
  relationship: string;
  consentDocumentVersion: string;
  consentScopes: readonly string[];
  consentedAt: string;
  consentExpiresAt: string | null;
};

export type CareCommunicationDeliveryEvent = {
  eventKind: "queued";
  channel: "family_pwa";
  providerWorkerStatus: "not_configured";
  familyConsumerStatus: "not_configured";
  offlineConsumerStatus: "not_configured";
  occurredAt: string;
};

export type CareCommunicationItem = {
  versionId: string;
  communicationKey: string;
  version: number;
  previousVersionId: string | null;
  recordKind: "original" | "correction";
  category: "care_communication";
  direction: "staff_to_family";
  clientId: string;
  clientDisplayName: string;
  clientCode: string;
  subject: string;
  body: string;
  occurredAt: string;
  submittedAt: string;
  authorDisplayName: string;
  authorProfileKind: "staff";
  correctionReason: string | null;
  attachmentState: "none";
  recipientCount: number;
  deliveryStatus: "queued";
  readStatus: "not_configured";
  familyConfirmationStatus: "not_configured";
  current: boolean;
  recipients: readonly CareCommunicationRecipient[];
  deliveryEvents: readonly CareCommunicationDeliveryEvent[];
};

export type CareCommunicationClientOption = {
  clientId: string;
  displayName: string;
  clientCode: string;
  authorizedFamilyCount: number;
};

export type CareCommunicationAuthorOption = {
  userId: string;
  displayName: string;
};

export type CareCommunicationSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly CareCommunicationItem[];
  metrics: {
    matching: number;
    threads: number;
    corrections: number;
    queued: number;
    today: number;
    attachments: number;
  };
  itemsTruncated: boolean;
  clientOptions: readonly CareCommunicationClientOption[];
  authorOptions: readonly CareCommunicationAuthorOption[];
  canManage: boolean;
  canCorrect: boolean;
  categoryBoundary: "care_communication_only";
  familyRecipientBoundary: "active_messages_read_consent";
  attachmentPipelineStatus: "not_configured";
  providerWorkerStatus: "not_configured";
  familyConsumerStatus: "not_configured";
  offlineConsumerStatus: "not_configured";
  demo: boolean;
};

export type CareCommunicationAttachmentInput = {
  reference: string;
  sha256: string;
};

export type CareCommunicationCreateInput = {
  action: "create";
  clientId: string;
  subject: string;
  body: string;
  occurredAt: string;
  attachments: readonly CareCommunicationAttachmentInput[];
  idempotencyKey: string;
};

export type CareCommunicationCorrectionInput = {
  action: "correct";
  clientId: string;
  communicationKey: string;
  previousVersionId: string;
  expectedVersion: number;
  subject: string;
  body: string;
  correctionReason: string;
  attachments: readonly CareCommunicationAttachmentInput[];
  idempotencyKey: string;
};

type PersistedResult = {
  persisted: true;
  demo: false;
  replayed: boolean;
};

export type CareCommunicationWriteResult = PersistedResult & {
  action: "create" | "correct";
  operationId: string;
  communicationKey: string;
  versionId: string;
  communicationVersion: number;
  previousVersionId: string | null;
  recordKind: "original" | "correction";
  clientId: string;
  recipientCount: number;
  deliveryStatus: "queued";
  readStatus: "not_configured";
  familyConfirmationStatus: "not_configured";
  attachmentState: "none";
  submittedAt: string;
};
