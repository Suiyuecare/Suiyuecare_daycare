export const CASE_CONFERENCE_STATUSES = ["draft", "signed"] as const;
export const CASE_CONFERENCE_VERSION_KINDS = [
  "created", "revised", "signed", "corrected",
] as const;
export const CASE_CONFERENCE_ACTIONS = [
  "create", "revise", "sign", "correct",
] as const;
export const CASE_CONFERENCE_ATTENDANCE_STATUSES = [
  "attended", "remote", "absent", "excused",
] as const;
export const CASE_CONFERENCE_ACTION_STATUSES = [
  "open", "completed", "cancelled",
] as const;
export const CASE_CONFERENCE_DEADLINE_STATES = [
  "dated", "missing", "not_applicable",
] as const;

export type CaseConferenceStatus = (typeof CASE_CONFERENCE_STATUSES)[number];
export type CaseConferenceVersionKind = (typeof CASE_CONFERENCE_VERSION_KINDS)[number];
export type CaseConferenceAction = (typeof CASE_CONFERENCE_ACTIONS)[number];
export type CaseConferenceAttendanceStatus =
  (typeof CASE_CONFERENCE_ATTENDANCE_STATUSES)[number];
export type CaseConferenceActionStatus =
  (typeof CASE_CONFERENCE_ACTION_STATUSES)[number];
export type CaseConferenceDeadlineState =
  (typeof CASE_CONFERENCE_DEADLINE_STATES)[number];

export type CaseConferenceFilters = {
  clientId: string | null;
  status: "all" | CaseConferenceStatus;
  responsibleUserId: string | null;
  actionStatus: "all" | CaseConferenceActionStatus | "overdue";
  meetingFrom: string | null;
  meetingTo: string | null;
  query: string;
};

export type CaseConferenceClientOption = {
  clientId: string;
  displayName: string;
  clientCode: string;
};

export type CaseConferenceStaffOption = {
  userId: string;
  displayName: string;
  roleKeys: readonly string[];
};

export type CaseConferenceAttendee = {
  userId: string;
  membershipId: string;
  displayName: string;
  roleKeys: readonly string[];
  attendanceStatus: CaseConferenceAttendanceStatus;
};

export type CaseConferenceActionItem = {
  actionId: string;
  itemOrder: number;
  actionText: string;
  responsibleUserId: string;
  responsibleMembershipId: string;
  responsibleDisplayName: string;
  deadlineState: CaseConferenceDeadlineState;
  dueDate: string | null;
  actionStatus: CaseConferenceActionStatus;
  isOverdue: boolean;
};

export type CaseConferenceHistoryEntry = {
  versionId: string;
  version: number;
  previousVersionId: string | null;
  correctsVersionId: string | null;
  versionKind: CaseConferenceVersionKind;
  status: CaseConferenceStatus;
  meetingStartsAt: string;
  meetingEndsAt: string;
  problemStatement: string;
  decisionSummary: string;
  attendees: readonly CaseConferenceAttendee[];
  actionItems: readonly CaseConferenceActionItem[];
  correctionReason: string | null;
  occurredAt: string;
  authorDisplayName: string;
  signedAt: string | null;
  signerDisplayName: string | null;
  signerRoleKeys: readonly string[];
  signaturePurpose: "個案研討會議紀錄簽署" | null;
  contentHash: string;
};

export type CaseConferenceItem = CaseConferenceHistoryEntry & {
  meetingKey: string;
  clientId: string;
  clientDisplayName: string;
  clientCode: string;
  history: readonly CaseConferenceHistoryEntry[];
};

export type CaseConferenceSnapshot = {
  organizationId: string;
  organizationName: string;
  branchId: string;
  branchName: string;
  generatedAt: string;
  snapshotDate: string;
  staleAfter: string;
  snapshotToken: string;
  items: readonly CaseConferenceItem[];
  metrics: {
    matching: number;
    draft: number;
    signed: number;
    corrected: number;
    actionTotal: number;
    openAction: number;
    overdueAction: number;
    deadlineMissing: number;
    deadlineNotApplicable: number;
  };
  itemsTruncated: boolean;
  clientOptions: readonly CaseConferenceClientOption[];
  staffOptions: readonly CaseConferenceStaffOption[];
  canManage: boolean;
  canSign: boolean;
  canCorrect: boolean;
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  notificationStatus: "not_configured";
  externalDeliveryStatus: "not_configured";
  deliveryClaim: "no_external_delivery_claim";
  offlineStatus: "not_configured";
  demo: boolean;
};

export type CaseConferenceAttendeeInput = {
  userId: string;
  attendanceStatus: CaseConferenceAttendanceStatus;
};

export type CaseConferenceActionItemInput = {
  actionId: string;
  itemOrder: number;
  actionText: string;
  responsibleUserId: string;
  deadlineState: CaseConferenceDeadlineState;
  dueDate: string | null;
  actionStatus: CaseConferenceActionStatus;
};

export type CaseConferenceMutationInput = {
  action: CaseConferenceAction;
  meetingKey: string | null;
  previousVersionId: string | null;
  expectedVersion: number | null;
  correctsVersionId: string | null;
  clientId: string | null;
  meetingStartsAt: string | null;
  meetingEndsAt: string | null;
  problemStatement: string | null;
  decisionSummary: string | null;
  attendees: readonly CaseConferenceAttendeeInput[] | null;
  actionItems: readonly CaseConferenceActionItemInput[] | null;
  correctionReason: string | null;
  idempotencyKey: string;
};

export type CaseConferenceOperationResult = {
  organizationId: string;
  branchId: string;
  operationId: string;
  operationKind: CaseConferenceAction;
  meetingKey: string;
  versionId: string;
  version: number;
  previousVersionId: string | null;
  correctsVersionId: string | null;
  versionKind: CaseConferenceVersionKind;
  conferenceStatus: CaseConferenceStatus;
  signedAt: string | null;
  contentHash: string;
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  notificationStatus: "not_configured";
  externalDeliveryStatus: "not_configured";
  deliveryClaim: "no_external_delivery_claim";
  offlineStatus: "not_configured";
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
