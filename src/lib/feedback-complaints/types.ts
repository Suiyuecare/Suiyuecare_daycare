export const FEEDBACK_SOURCES = [
  "client", "family", "staff", "anonymous", "external",
] as const;
export const FEEDBACK_CASE_TYPES = [
  "feedback", "service", "rights", "safety", "privacy", "billing", "other",
] as const;
export const FEEDBACK_RISKS = ["standard", "high"] as const;
export const FEEDBACK_STATES = [
  "received", "assigned", "in_progress", "escalated", "closed",
] as const;
export const FEEDBACK_FILTER_STATES = [
  "all", ...FEEDBACK_STATES, "overdue",
] as const;
export const FEEDBACK_ACTIONS = [
  "create", "assign", "progress", "correct", "close",
] as const;
export const FEEDBACK_EVENT_TYPES = [
  "created", "assignment", "progress", "correction", "closure",
] as const;

export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];
export type FeedbackCaseType = (typeof FEEDBACK_CASE_TYPES)[number];
export type FeedbackRisk = (typeof FEEDBACK_RISKS)[number];
export type FeedbackState = (typeof FEEDBACK_STATES)[number];
export type FeedbackFilterState = (typeof FEEDBACK_FILTER_STATES)[number];
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];
export type FeedbackEventType = (typeof FEEDBACK_EVENT_TYPES)[number];

export type FeedbackComplaintFilters = {
  receivedFrom: string | null;
  receivedTo: string | null;
  source: "all" | FeedbackSource;
  caseType: "all" | FeedbackCaseType;
  risk: "all" | FeedbackRisk;
  assignee: "all" | "unassigned" | string;
  status: FeedbackFilterState;
  query: string;
};

export type FeedbackDeadlineRuleOption = {
  id: string;
  label: string;
  source: FeedbackSource;
  caseType: FeedbackCaseType;
  risk: FeedbackRisk;
  responseHours: number;
  effectiveFrom: string;
  effectiveThrough: string | null;
};

export type FeedbackAssigneeOption = {
  membershipId: string;
  displayName: string;
  scope: "organization" | "branch";
};

export type FeedbackTimelineEvent = {
  id: string;
  version: number;
  eventType: FeedbackEventType;
  occurredAt: string;
  resultingStatus: FeedbackState;
  riskAfter: FeedbackRisk;
  automaticReason: "high_risk" | "overdue" | "high_risk_and_overdue" | null;
  assigneeMembershipId: string | null;
  assigneeDisplayName: string | null;
  correctedEventId: string | null;
  note: string | null;
  sensitiveMasked: boolean;
  actorDisplayName: string;
  committedAt: string;
};

export type FeedbackComplaintItem = {
  id: string;
  caseNumber: string;
  receivedAt: string;
  source: FeedbackSource;
  caseType: FeedbackCaseType;
  reportedRisk: FeedbackRisk;
  effectiveRisk: FeedbackRisk;
  status: FeedbackState;
  dueAt: string;
  overdue: boolean;
  escalationReason: "high_risk" | "overdue" | "high_risk_and_overdue" | null;
  assigneeMembershipId: string | null;
  assigneeDisplayName: string | null;
  chainVersion: number;
  latestEventAt: string;
  reporterName: string | null;
  reporterContact: string | null;
  subject: string | null;
  description: string | null;
  sensitiveMasked: boolean;
  timelineTotal: number;
  timelineTruncated: boolean;
  timeline: readonly FeedbackTimelineEvent[];
};

export type FeedbackComplaintSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  filters: FeedbackComplaintFilters;
  items: readonly FeedbackComplaintItem[];
  matchingTotal: number;
  itemsTruncated: boolean;
  metrics: {
    cases: number;
    highRisk: number;
    inProgress: number;
    overdue: number;
  };
  assignees: readonly FeedbackAssigneeOption[];
  assigneesTruncated: boolean;
  deadlineRules: readonly FeedbackDeadlineRuleOption[];
  deadlineRuleStatus: "configured" | "not_configured";
  escalationEvaluationStatus: "server_clock";
  escalationDeliveryStatus: "not_configured";
  exportStatus: "not_configured";
  canViewSensitive: boolean;
  demo: boolean;
};

type IdempotentInput = { idempotencyKey: string };

export type CreateFeedbackComplaintInput = IdempotentInput & {
  action: "create";
  deadlineRuleId: string;
  receivedAt: string;
  reporterName: string | null;
  reporterContact: string | null;
  subject: string;
  description: string;
};

type ExistingCaseInput = IdempotentInput & {
  caseId: string;
  expectedVersion: number;
};

export type AssignFeedbackComplaintInput = ExistingCaseInput & {
  action: "assign";
  assigneeMembershipId: string;
  note: string | null;
};

export type ProgressFeedbackComplaintInput = ExistingCaseInput & {
  action: "progress";
  note: string;
};

export type CorrectFeedbackComplaintInput = ExistingCaseInput & {
  action: "correct";
  correctedEventId: string;
  correctionReason: string;
  reporterName: string | null;
  reporterContact: string | null;
  subject: string;
  description: string;
};

export type CloseFeedbackComplaintInput = ExistingCaseInput & {
  action: "close";
  resolution: string;
};

export type FeedbackComplaintMutationInput =
  | CreateFeedbackComplaintInput
  | AssignFeedbackComplaintInput
  | ProgressFeedbackComplaintInput
  | CorrectFeedbackComplaintInput
  | CloseFeedbackComplaintInput;

export type FeedbackComplaintMutationReceipt = {
  operationId: string;
  action: FeedbackAction;
  caseId: string;
  caseNumber: string;
  eventId: string;
  version: number;
  status: FeedbackState;
  effectiveRisk: FeedbackRisk;
  dueAt: string;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
