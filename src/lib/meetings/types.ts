export const MEETING_ACTION_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export type MeetingActionStatus = (typeof MEETING_ACTION_STATUSES)[number];
export type MeetingStatusFilter = "all" | "open" | "overdue" | "completed" | "cancelled";

export type MeetingStaffOption = {
  userId: string;
  displayName: string;
  employeeCode: string | null;
  profileKind: "staff" | "professional" | "driver" | "finance";
  membershipScope: "branch" | "organization";
};

export type MeetingStaffAttendee = {
  attendeeKind: "staff";
  userId: string;
  displayName: string;
  profileKind: "staff" | "professional" | "driver" | "finance";
  membershipScope: "branch" | "organization";
};

export type MeetingExternalAttendee = {
  attendeeKind: "external";
  name: string;
};

export type MeetingAgendaItem = { itemId: string; itemOrder: number; topic: string };
export type MeetingDecision = { decisionId: string; itemOrder: number; decision: string };

export type MeetingActionItem = {
  actionId: string;
  itemOrder: number;
  action: string;
  responsibleUserId: string;
  responsibleDisplayName: string;
  dueDate: string;
  progressStatus: MeetingActionStatus;
  latestUpdateId: string | null;
  updateSequence: number;
  progressNote: string | null;
  progressRecordedAt: string | null;
  isOverdue: boolean;
  localWorkItem: boolean;
  externalNotificationSent: false;
};

export type MeetingMinute = {
  minuteVersionId: string;
  meetingKey: string;
  minuteVersion: number;
  previousVersionId: string | null;
  correctionReason: string | null;
  meetingType: string;
  title: string;
  startsAt: string;
  endsAt: string;
  staffAttendees: readonly MeetingStaffAttendee[];
  externalAttendees: readonly MeetingExternalAttendee[];
  agendaItems: readonly MeetingAgendaItem[];
  decisions: readonly MeetingDecision[];
  actionItems: readonly MeetingActionItem[];
  signedAt: string;
  signerDisplayName: string;
  signerRoleKeys: readonly string[];
  signaturePurpose: "會議紀錄簽署";
};

export type MeetingManagementSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  snapshotDate: string;
  staleAfter: string;
  staffOptions: readonly MeetingStaffOption[];
  staffTotal: number;
  staffTruncated: boolean;
  meetings: readonly MeetingMinute[];
  meetingTotal: number;
  meetingAvailableTotal: number;
  meetingsTruncated: boolean;
  correctionTotal: number;
  actionTotal: number;
  openActionTotal: number;
  overdueActionTotal: number;
  meetingTypePolicy: "institution_owned_unconfigured";
  retentionPolicy: "institution_owned_unconfigured";
  escalationPolicy: "institution_owned_unconfigured";
  notificationDelivery: "none_not_sent";
  demo: boolean;
};

export type MeetingFilters = {
  query: string;
  meetingType: string;
  status: MeetingStatusFilter;
  date: string | null;
};

export type MeetingMinuteInput = {
  meetingKey: string | null;
  previousVersionId: string | null;
  correctionReason: string | null;
  meetingType: string;
  title: string;
  startsAt: string;
  endsAt: string;
  staffAttendeeUserIds: readonly string[];
  externalAttendeeNames: readonly string[];
  agendaItems: readonly { itemId: string; itemOrder: number; topic: string }[];
  decisions: readonly { decisionId: string; itemOrder: number; decision: string }[];
  actionItems: readonly {
    actionId: string;
    itemOrder: number;
    action: string;
    responsibleUserId: string;
    dueDate: string;
  }[];
  idempotencyKey: string;
};

export type MeetingMinuteReceipt = {
  minuteVersionId: string;
  meetingKey: string;
  minuteVersion: number;
  previousVersionId: string | null;
  signedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type MeetingActionUpdateInput = {
  meetingKey: string;
  minuteVersionId: string;
  actionId: string;
  expectedPreviousUpdateId: string | null;
  progressStatus: MeetingActionStatus;
  progressNote: string | null;
  idempotencyKey: string;
};

export type MeetingActionUpdateReceipt = {
  actionUpdateId: string;
  meetingKey: string;
  minuteVersionId: string;
  actionId: string;
  previousUpdateId: string | null;
  updateSequence: number;
  progressStatus: MeetingActionStatus;
  recordedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
