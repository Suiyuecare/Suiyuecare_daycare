export const CONSULTATION_URGENCIES = ["routine", "soon", "urgent"] as const;
export const CONSULTATION_STATUSES = ["unassigned", "assigned", "answered", "closed"] as const;
export const CONSULTATION_DEADLINE_FILTERS = [
  "all", "dated", "missing", "not_applicable", "overdue",
] as const;
export const CONSULTATION_ACTIONS = [
  "create", "assign", "reassign", "reply", "supplement", "close", "reopen", "correct",
] as const;

export type ConsultationUrgency = (typeof CONSULTATION_URGENCIES)[number];
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];
export type ConsultationDeadlineState = "dated" | "missing" | "not_applicable";
export type ConsultationDeadlineFilter = (typeof CONSULTATION_DEADLINE_FILTERS)[number];
export type ConsultationAction = (typeof CONSULTATION_ACTIONS)[number];
export type ConsultationAssigneeMode = "all" | "assigned" | "unassigned" | "specific";

export type InterprofessionalConsultationFilters = {
  clientId: string | null;
  requesterUserId: string | null;
  assigneeMode: ConsultationAssigneeMode;
  assigneeUserId: string | null;
  disciplineCode: string | null;
  urgency: "all" | ConsultationUrgency;
  status: "all" | ConsultationStatus;
  deadlineFilter: ConsultationDeadlineFilter;
  dueFrom: string | null;
  dueTo: string | null;
  query: string;
};

export type ConsultationHistoryEntry = {
  eventId: string;
  sequence: number;
  eventKind: "created" | "assigned" | "reassigned" | "reply" | "supplement" | "closed" | "reopened" | "corrected";
  correctsEventId: string | null;
  entryContent: string | null;
  status: ConsultationStatus;
  assigneeDisplayName: string | null;
  occurredAt: string;
  actorDisplayName: string;
  contentHash: string;
  notificationRecipientCount: number;
};

export type InterprofessionalConsultationItem = {
  eventId: string;
  consultationKey: string;
  sequence: number;
  previousEventId: string | null;
  correctsEventId: string | null;
  eventKind: ConsultationHistoryEntry["eventKind"];
  clientId: string;
  clientDisplayName: string;
  clientCode: string;
  requesterUserId: string;
  requesterDisplayName: string;
  assigneeUserId: string | null;
  assigneeDisplayName: string | null;
  assignmentState: "assigned" | "unassigned";
  disciplineCode: string;
  disciplineLabel: string;
  disciplineTaxonomyStatus: "manual_unstandardized";
  urgency: ConsultationUrgency;
  urgencySource: "manual";
  requestedAt: string;
  deadlineState: ConsultationDeadlineState;
  dueAt: string | null;
  problemSummary: string;
  entryContent: string | null;
  status: ConsultationStatus;
  occurredAt: string;
  actorDisplayName: string;
  contentHash: string;
  notification: {
    queueStatus: "queued";
    deliveryClaim: "queued_not_delivered";
    externalProviderStatus: "not_configured";
    recipientCount: number;
  };
  history: readonly ConsultationHistoryEntry[];
};

export type ConsultationPersonOption = { userId: string; displayName: string };
export type ConsultationClientOption = { clientId: string; displayName: string; clientCode: string };
export type ConsultationDisciplineOption = {
  code: string; label: string; taxonomyStatus: "manual_unstandardized";
};

export type InterprofessionalConsultationSnapshot = {
  organizationId: string;
  organizationName: string;
  branchId: string;
  branchName: string;
  generatedAt: string;
  staleAfter: string;
  snapshotToken: string;
  items: readonly InterprofessionalConsultationItem[];
  metrics: {
    matching: number;
    unassigned: number;
    inProgress: number;
    overdue: number;
    closed: number;
    deadlineMissing: number;
    deadlineNotApplicable: number;
  };
  itemsTruncated: boolean;
  clientOptions: readonly ConsultationClientOption[];
  requesterOptions: readonly ConsultationPersonOption[];
  assigneeOptions: readonly ConsultationPersonOption[];
  disciplineOptions: readonly ConsultationDisciplineOption[];
  canCreate: boolean;
  canAssign: boolean;
  canRespond: boolean;
  canCorrect: boolean;
  canClose: boolean;
  taxonomyStatus: "manual_unstandardized";
  notificationQueueStatus: "queued";
  notificationDeliveryClaim: "queued_not_delivered";
  externalProviderStatus: "not_configured";
  demo: boolean;
};

export type InterprofessionalConsultationMutationInput = {
  action: ConsultationAction;
  consultationKey: string | null;
  previousEventId: string | null;
  expectedSequence: number | null;
  clientId: string | null;
  assigneeUserId: string | null;
  disciplineCode: string | null;
  disciplineLabel: string | null;
  urgency: ConsultationUrgency | null;
  requestedAt: string | null;
  deadlineState: ConsultationDeadlineState | null;
  dueAt: string | null;
  problemSummary: string | null;
  entryContent: string | null;
  correctsEventId: string | null;
  idempotencyKey: string;
};

export type InterprofessionalConsultationOperationResult = {
  organizationId: string;
  branchId: string;
  operationId: string;
  operationKind: ConsultationAction;
  consultationKey: string;
  eventId: string;
  eventSequence: number;
  previousEventId: string | null;
  eventKind: ConsultationHistoryEntry["eventKind"];
  consultationStatus: ConsultationStatus;
  assignmentState: "assigned" | "unassigned";
  assigneeUserId: string | null;
  deadlineState: ConsultationDeadlineState;
  notificationCount: number;
  notificationQueueStatus: "queued";
  notificationDeliveryClaim: "queued_not_delivered";
  externalProviderStatus: "not_configured";
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
