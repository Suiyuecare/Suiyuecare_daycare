export const ABNORMAL_MAJOR_STATES = ["major", "not_major", "unclassified"] as const;
export const ABNORMAL_AFFECTED_TARGET_KINDS = [
  "client", "staff", "visitor", "facility", "other",
] as const;
export const ABNORMAL_HANDLING_STATUSES = ["reported", "in_progress", "closed"] as const;
export const ABNORMAL_TIMELINE_ENTRY_TYPES = [
  "manual_notification", "improvement", "follow_up", "closure",
] as const;
export const ABNORMAL_DUE_DATE_ACTIONS = ["keep", "replace"] as const;
export const ABNORMAL_ACTIONS = [
  "report", "manual_notification", "improvement", "follow_up", "close",
] as const;

export type AbnormalMajorState = (typeof ABNORMAL_MAJOR_STATES)[number];
export type AbnormalAffectedTargetKind = (typeof ABNORMAL_AFFECTED_TARGET_KINDS)[number];
export type AbnormalAffectedTargetFilter = "all" | AbnormalAffectedTargetKind;
export type AbnormalHandlingStatus = (typeof ABNORMAL_HANDLING_STATUSES)[number];
export type AbnormalHandlingStatusFilter = "all" | AbnormalHandlingStatus;
export type AbnormalTimelineEntryType = (typeof ABNORMAL_TIMELINE_ENTRY_TYPES)[number];
export type AbnormalDueDateAction = (typeof ABNORMAL_DUE_DATE_ACTIONS)[number];
export type AbnormalAction = (typeof ABNORMAL_ACTIONS)[number];

export type AbnormalClientOption = {
  clientId: string;
  displayName: string;
  clientStatus: "active" | "suspended" | "transferred" | "closed" | "deceased";
  admittedOn: string | null;
  endedOn: string | null;
  canReport: boolean;
};

export type AbnormalResponsibleOption = {
  membershipId: string;
  userId: string;
  displayName: string;
  scope: "organization" | "branch";
};

export type AbnormalTimelineEntry = {
  id: string;
  sequenceNumber: number;
  entryType: AbnormalTimelineEntryType;
  occurredAt: string;
  entryText: string | null;
  notificationTarget: string | null;
  notificationMethod: string | null;
  notificationResult: string | null;
  responsibleMembershipId: string | null;
  responsibleUserId: string | null;
  responsibleDisplayName: string | null;
  dueDateAction: AbnormalDueDateAction | null;
  dueDateValue: string | null;
  effectiveDueDate: string;
  closureOutcome: string | null;
  closureReason: string | null;
  committerDisplayName: string;
  committedAt: string;
};

export type AbnormalIncidentItem = {
  id: string;
  affectedTargetKind: AbnormalAffectedTargetKind;
  affectedClientId: string | null;
  affectedTargetLabel: string;
  occurredAt: string;
  reportedAt: string;
  location: string;
  eventType: string;
  eventSummary: string;
  immediateAction: string;
  majorState: AbnormalMajorState;
  lateEntryReason: string | null;
  initialResponsibleMembershipId: string;
  initialResponsibleUserId: string;
  initialResponsibleDisplayName: string;
  currentResponsibleMembershipId: string;
  currentResponsibleUserId: string;
  currentResponsibleDisplayName: string;
  initialImprovementDueDate: string;
  currentImprovementDueDate: string;
  reporterDisplayName: string;
  handlingStatus: AbnormalHandlingStatus;
  chainVersion: number;
  lastActivityAt: string;
  timelineTotal: number;
  timelineTruncated: boolean;
  timeline: readonly AbnormalTimelineEntry[];
};

export type AbnormalEventFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  eventType: string | null;
  affectedTargetKind: AbnormalAffectedTargetFilter;
  handlingStatus: AbnormalHandlingStatusFilter;
};

export type AbnormalEventSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly AbnormalIncidentItem[];
  itemTotal: number;
  matchingTotal: number;
  metrics: { major: number; awaitingImprovement: number; overdue: number; closed: number };
  itemsTruncated: boolean;
  clientOptions: readonly AbnormalClientOption[];
  clientOptionsAvailableTotal: number;
  clientOptionsTruncated: boolean;
  responsibleOptions: readonly AbnormalResponsibleOption[];
  responsibleOptionsAvailableTotal: number;
  responsibleOptionsTruncated: boolean;
  eventTypeOptions: readonly string[];
  eventTypeOptionsAvailableTotal: number;
  eventTypeOptionsTruncated: boolean;
  eventTaxonomyStatus: "not_configured";
  majorCriteriaStatus: "not_configured";
  legalReportingStatus: "not_configured";
  deliveryIntegrationStatus: "not_implemented";
  demo: boolean;
};

export type ReportAbnormalEventInput = {
  action: "report";
  affectedTargetKind: AbnormalAffectedTargetKind;
  affectedClientId: string | null;
  affectedTargetLabel: string | null;
  occurredAt: string;
  location: string;
  eventType: string;
  eventSummary: string;
  immediateAction: string;
  majorState: AbnormalMajorState;
  responsibleMembershipId: string;
  improvementDueDate: string;
  lateEntryReason: string | null;
  idempotencyKey: string;
};

export type ManualNotificationInput = {
  action: "manual_notification";
  incidentId: string;
  affectedTargetKind: AbnormalAffectedTargetKind;
  affectedClientId: string | null;
  occurredAt: string;
  notificationTarget: string;
  notificationMethod: string;
  notificationResult: string;
  expectedChainVersion: number;
  idempotencyKey: string;
};

export type ImprovementInput = {
  action: "improvement" | "follow_up";
  incidentId: string;
  affectedTargetKind: AbnormalAffectedTargetKind;
  affectedClientId: string | null;
  occurredAt: string;
  entryText: string;
  responsibleMembershipId: string;
  dueDateAction: AbnormalDueDateAction;
  dueDateValue: string | null;
  expectedChainVersion: number;
  idempotencyKey: string;
};

export type CloseAbnormalEventInput = {
  action: "close";
  incidentId: string;
  affectedTargetKind: AbnormalAffectedTargetKind;
  affectedClientId: string | null;
  occurredAt: string;
  closureOutcome: string;
  closureReason: string;
  expectedChainVersion: number;
  idempotencyKey: string;
};

export type AbnormalEventMutationInput = ManualNotificationInput | ImprovementInput | CloseAbnormalEventInput;

export type AbnormalEventOperationResult = {
  operationId: string;
  incidentId: string;
  entryId: string | null;
  operationKind: AbnormalAction;
  affectedTargetKind: AbnormalAffectedTargetKind;
  affectedClientId: string | null;
  chainVersion: number;
  handlingStatus: AbnormalHandlingStatus;
  responsibleMembershipId: string;
  effectiveDueDate: string;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
