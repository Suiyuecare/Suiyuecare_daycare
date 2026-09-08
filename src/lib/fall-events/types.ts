export const FALL_INJURY_STATES = ["provided", "missing", "not_applicable"] as const;
export const FALL_HANDLING_STATUSES = ["reported", "in_progress", "closed"] as const;
export const FALL_TIMELINE_ENTRY_TYPES = ["treatment", "follow_up", "closure"] as const;

export type FallInjuryState = (typeof FALL_INJURY_STATES)[number];
export type FallHandlingStatus = (typeof FALL_HANDLING_STATUSES)[number];
export type FallHandlingStatusFilter = "all" | FallHandlingStatus;
export type FallTimelineEntryType = (typeof FALL_TIMELINE_ENTRY_TYPES)[number];

export type FallClientOption = {
  clientId: string;
  displayName: string;
  clientStatus: "active" | "suspended" | "transferred" | "closed" | "deceased";
  admittedOn: string | null;
  endedOn: string | null;
  canReport: boolean;
};

export type FallTimelineEntry = {
  id: string;
  sequenceNumber: number;
  entryType: FallTimelineEntryType;
  occurredAt: string;
  entryText: string | null;
  closureOutcome: string | null;
  closureReason: string | null;
  committerDisplayName: string;
  committedAt: string;
};

export type FallIncidentItem = {
  id: string;
  clientId: string;
  clientDisplayName: string;
  occurredAt: string;
  reportedAt: string;
  location: string;
  eventSummary: string;
  injuryDegreeState: FallInjuryState;
  injuryDegreeText: string | null;
  lateEntryReason: string | null;
  reporterDisplayName: string;
  handlingStatus: FallHandlingStatus;
  chainVersion: number;
  lastActivityAt: string;
  timelineTotal: number;
  timelineTruncated: boolean;
  timeline: readonly FallTimelineEntry[];
};

export type FallEventFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  injuryDegree: string | null;
  handlingStatus: FallHandlingStatusFilter;
  clientId: string | null;
};

export type FallEventSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly FallIncidentItem[];
  itemTotal: number;
  matchingTotal: number;
  metrics: {
    injuryProvided: number;
    awaitingAction: number;
    awaitingClosure: number;
    closed: number;
  };
  itemsTruncated: boolean;
  clientOptions: readonly FallClientOption[];
  clientOptionsTruncated: boolean;
  injuryDegreeOptions: readonly string[];
  injuryOptionsTruncated: boolean;
  injuryTaxonomyStatus: "not_configured";
  severityScoringStatus: "not_configured";
  reportingThresholdStatus: "not_configured";
  demo: boolean;
};

export type ReportFallEventInput = {
  action: "report";
  clientId: string;
  occurredAt: string;
  location: string;
  eventSummary: string;
  injuryDegreeState: FallInjuryState;
  injuryDegreeText: string | null;
  lateEntryReason: string | null;
  idempotencyKey: string;
};

export type AppendFallEventInput = {
  action: "treatment" | "follow_up";
  clientId: string;
  incidentId: string;
  occurredAt: string;
  entryText: string;
  expectedChainVersion: number;
  idempotencyKey: string;
};

export type CloseFallEventInput = {
  action: "close";
  clientId: string;
  incidentId: string;
  occurredAt: string;
  closureOutcome: string;
  closureReason: string;
  expectedChainVersion: number;
  idempotencyKey: string;
};

export type FallEventMutationInput = AppendFallEventInput | CloseFallEventInput;

export type FallEventOperationResult = {
  operationId: string;
  incidentId: string;
  clientId: string;
  entryId: string | null;
  chainVersion: number;
  handlingStatus: FallHandlingStatus;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
