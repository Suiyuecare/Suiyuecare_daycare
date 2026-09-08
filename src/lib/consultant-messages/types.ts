export const CONSULTANT_MESSAGE_STATUSES = [
  "all",
  "unread",
  "read",
  "confirmed",
  "unconfirmed",
] as const;

export type ConsultantMessageStatus =
  (typeof CONSULTANT_MESSAGE_STATUSES)[number];

export type ConsultantMessageFilters = {
  consultantUserId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  status: ConsultantMessageStatus;
  query: string;
};

export type ConsultantMessageRecipient = {
  userId: string;
  displayName: string;
  employeeCode: string | null;
  profileKind: "professional";
  roleNames: readonly string[];
  readAt: string | null;
  confirmedAt: string | null;
};

export type ConsultantMessageItem = {
  messageId: string;
  category: "consultant";
  subject: string;
  body: string;
  occurredAt: string;
  publishedAt: string;
  authorDisplayName: string;
  authorProfileKind: "staff";
  recipientCount: number;
  readCount: number;
  confirmedCount: number;
  actorIsRecipient: boolean;
  actorReadAt: string | null;
  actorConfirmedAt: string | null;
  attachmentCount: number;
  recipients: readonly ConsultantMessageRecipient[];
};

export type ConsultantRecipientOption = {
  userId: string;
  displayName: string;
  employeeCode: string | null;
  profileKind: "professional";
  roleNames: readonly string[];
};

export type ConsultantMessageSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly ConsultantMessageItem[];
  metrics: {
    messages: number;
    unread: number;
    today: number;
    attachments: number;
    pendingConfirmations: number;
  };
  itemsTruncated: boolean;
  canManage: boolean;
  recipientOptions: readonly ConsultantRecipientOption[];
  categoryBoundary: "consultant_only";
  deliveryBoundary: "in_app_only";
  attachmentPipelineStatus: "not_configured";
  attachmentScanStatus: "not_configured";
  demo: boolean;
};

export type ConsultantMessageAttachmentInput = {
  reference: string;
  sha256: string;
};

export type ConsultantMessageCreateInput = {
  action: "create";
  subject: string;
  body: string;
  occurredAt: string;
  recipientUserIds: readonly string[];
  attachments: readonly ConsultantMessageAttachmentInput[];
  idempotencyKey: string;
};

export type ConsultantMessageReceiptAction = "read" | "confirm";

export type ConsultantMessageReceiptInput = {
  action: ConsultantMessageReceiptAction;
  messageId: string;
  idempotencyKey: string;
};

type PersistedResult = {
  persisted: true;
  demo: false;
  replayed: boolean;
};

export type ConsultantMessageCreateResult = PersistedResult & {
  action: "create";
  operationId: string;
  messageId: string;
  category: "consultant";
  recipientCount: number;
  publishedAt: string;
};

export type ConsultantMessageReceiptResult = PersistedResult & {
  operationId: string;
  messageId: string;
  category: "consultant";
  action: ConsultantMessageReceiptAction;
  readAt: string;
  confirmedAt: string | null;
};
