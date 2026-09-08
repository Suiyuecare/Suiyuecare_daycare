export const STAFF_ANNOUNCEMENT_LIFECYCLES = [
  "draft",
  "scheduled",
  "published",
  "expired",
  "withdrawn",
] as const;

export type StaffAnnouncementLifecycle =
  (typeof STAFF_ANNOUNCEMENT_LIFECYCLES)[number];
export type StaffAnnouncementStatusFilter = "all" | StaffAnnouncementLifecycle;

export type StaffAnnouncementItem = {
  versionId: string;
  announcementKey: string;
  version: number;
  versionState: "draft" | "release" | "withdrawal";
  title: string;
  body: string;
  publishAt: string;
  expiresAt: string | null;
  lifecycle: StaffAnnouncementLifecycle;
  hasPendingDraft: boolean;
  audienceUserIds: readonly string[];
  audienceRoleIds: readonly string[];
  activeReleaseVersionId: string | null;
  activeReleaseVersion: number | null;
  activeReleaseTitle: string | null;
  activeReleaseBody: string | null;
  activeReleasePublishAt: string | null;
  activeReleaseExpiresAt: string | null;
  recipientCount: number;
  readCount: number;
  unreadCount: number;
  actorIsRecipient: boolean;
  actorReadAt: string | null;
  withdrawalReason: string | null;
};

export type StaffAnnouncementAudienceStaff = {
  userId: string;
  displayName: string;
  employeeCode: string | null;
  profileKind: "staff" | "professional" | "driver" | "finance";
};

export type StaffAnnouncementAudienceRole = {
  roleId: string;
  roleName: string;
};

export type StaffAnnouncementRecipient = {
  userId: string;
  displayName: string;
  employeeCode: string | null;
  profileKind: "staff" | "professional" | "driver" | "finance";
  resolutionKind: "direct" | "role" | "direct_and_role";
  readAt: string | null;
};

export type StaffAnnouncementSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly StaffAnnouncementItem[];
  availableTotal: number;
  itemsTruncated: boolean;
  metrics: {
    drafts: number;
    scheduled: number;
    published: number;
    expired: number;
    withdrawn: number;
    unreadRecipients: number;
  };
  canManage: boolean;
  audienceStaff: readonly StaffAnnouncementAudienceStaff[];
  audienceRoles: readonly StaffAnnouncementAudienceRole[];
  selectedReleaseId: string | null;
  selectedRecipients: readonly StaffAnnouncementRecipient[];
  demo: boolean;
  deliveryBoundary: "staff_portal_read_receipts_only";
  expiryRule: "explicit_datetime_or_explicit_no_expiry";
};

export type StaffAnnouncementFilters = {
  query: string;
  status: StaffAnnouncementStatusFilter;
};

export type StaffAnnouncementDraftInput = {
  action: "draft";
  previousVersionId: string | null;
  title: string;
  body: string;
  publishAt: string;
  expiresAt: string | null;
  audienceUserIds: readonly string[];
  audienceRoleIds: readonly string[];
  changeReason: string | null;
  idempotencyKey: string;
};

export type StaffAnnouncementPublishInput = {
  action: "publish";
  draftVersionId: string;
  idempotencyKey: string;
};

export type StaffAnnouncementWithdrawInput = {
  action: "withdraw";
  expectedLatestVersionId: string;
  releaseVersionId: string;
  reason: string;
  idempotencyKey: string;
};

export type StaffAnnouncementReadInput = {
  action: "read";
  releaseVersionId: string;
  idempotencyKey: string;
};

export type StaffAnnouncementMutationInput =
  | StaffAnnouncementDraftInput
  | StaffAnnouncementPublishInput
  | StaffAnnouncementWithdrawInput
  | StaffAnnouncementReadInput;

type PersistedResult = { replayed: boolean; persisted: true; demo: false };

export type StaffAnnouncementDraftResult = PersistedResult & {
  action: "draft";
  versionId: string;
  announcementKey: string;
  version: number;
  previousVersionId: string | null;
  versionState: "draft";
  publishAt: string;
  expiresAt: string | null;
};

export type StaffAnnouncementPublishResult = PersistedResult & {
  action: "publish";
  versionId: string;
  announcementKey: string;
  version: number;
  draftVersionId: string;
  lifecycle: "scheduled" | "published";
  publishAt: string;
  expiresAt: string | null;
  recipientCount: number;
};

export type StaffAnnouncementWithdrawResult = PersistedResult & {
  action: "withdraw";
  versionId: string;
  announcementKey: string;
  version: number;
  previousVersionId: string;
  lifecycle: "withdrawn";
  releaseVersionId: string;
  reason: string;
  withdrawnAt: string;
};

export type StaffAnnouncementReadResult = PersistedResult & {
  action: "read";
  releaseVersionId: string;
  announcementKey: string;
  readAt: string;
};

export type StaffAnnouncementMutationResult =
  | StaffAnnouncementDraftResult
  | StaffAnnouncementPublishResult
  | StaffAnnouncementWithdrawResult
  | StaffAnnouncementReadResult;
