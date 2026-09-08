export const INFECTION_TYPE_STATES = ["provided", "missing", "not_applicable"] as const;
export const INFECTION_HANDLING_STATUSES = ["reported", "in_progress", "closed"] as const;
export const INFECTION_TIMELINE_ENTRY_TYPES = [
  "treatment", "follow_up", "cluster_link", "cluster_unlink", "closure",
] as const;
export const INFECTION_CLUSTER_MODES = ["all", "linked", "unlinked"] as const;
export const INFECTION_ACTIONS = [
  "report", "treatment", "follow_up", "cluster_link", "cluster_unlink", "close",
] as const;

export type InfectionTypeState = (typeof INFECTION_TYPE_STATES)[number];
export type InfectionHandlingStatus = (typeof INFECTION_HANDLING_STATUSES)[number];
export type InfectionHandlingStatusFilter = "all" | InfectionHandlingStatus;
export type InfectionTimelineEntryType = (typeof INFECTION_TIMELINE_ENTRY_TYPES)[number];
export type InfectionClusterMode = (typeof INFECTION_CLUSTER_MODES)[number];
export type InfectionAction = (typeof INFECTION_ACTIONS)[number];

export type InfectionClientOption = {
  clientId: string;
  displayName: string;
  clientStatus: "active" | "suspended" | "transferred" | "closed" | "deceased";
  admittedOn: string | null;
  endedOn: string | null;
  canReport: boolean;
};

export type InfectionClusterOption = { clusterId: string; label: string; createdAt: string };

export type InfectionTimelineEntry = {
  id: string;
  sequenceNumber: number;
  entryType: InfectionTimelineEntryType;
  occurredAt: string;
  entryText: string | null;
  clusterId: string | null;
  clusterLabel: string | null;
  closureOutcome: string | null;
  closureReason: string | null;
  committerDisplayName: string;
  committedAt: string;
};

export type InfectionIncidentItem = {
  id: string;
  clientId: string;
  clientDisplayName: string;
  occurredAt: string;
  reportedAt: string;
  location: string;
  eventSummary: string;
  infectionTypeState: InfectionTypeState;
  infectionTypeText: string | null;
  currentClusterId: string | null;
  currentClusterLabel: string | null;
  reporterDisplayName: string;
  handlingStatus: InfectionHandlingStatus;
  chainVersion: number;
  lastActivityAt: string;
  timelineTotal: number;
  timelineTruncated: boolean;
  timeline: readonly InfectionTimelineEntry[];
};

export type InfectionEventFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  infectionType: string | null;
  handlingStatus: InfectionHandlingStatusFilter;
  clientId: string | null;
  clusterMode: InfectionClusterMode;
  clusterId: string | null;
};

export type InfectionEventSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly InfectionIncidentItem[];
  itemTotal: number;
  matchingTotal: number;
  metrics: {
    infectionProvided: number;
    linked: number;
    awaitingAction: number;
    awaitingClosure: number;
    closed: number;
  };
  itemsTruncated: boolean;
  clientOptions: readonly InfectionClientOption[];
  clientOptionsAvailableTotal: number;
  clientOptionsTruncated: boolean;
  infectionTypeOptions: readonly string[];
  infectionOptionsAvailableTotal: number;
  infectionOptionsTruncated: boolean;
  clusterOptions: readonly InfectionClusterOption[];
  clusterOptionsAvailableTotal: number;
  clusterOptionsTruncated: boolean;
  infectionTaxonomyStatus: "not_configured";
  clusterThresholdStatus: "not_configured";
  legalReportingStatus: "not_configured";
  demo: boolean;
};

export type ReportInfectionEventInput = {
  action: "report";
  clientId: string;
  occurredAt: string;
  location: string;
  eventSummary: string;
  infectionTypeState: InfectionTypeState;
  infectionTypeText: string | null;
  idempotencyKey: string;
};

export type AppendInfectionEventInput = {
  action: "treatment" | "follow_up";
  clientId: string;
  incidentId: string;
  occurredAt: string;
  entryText: string;
  expectedChainVersion: number;
  idempotencyKey: string;
};

export type ClusterInfectionEventInput = {
  action: "cluster_link" | "cluster_unlink";
  clientId: string;
  incidentId: string;
  occurredAt: string;
  clusterId: string | null;
  clusterLabel: string;
  expectedChainVersion: number;
  idempotencyKey: string;
};

export type CloseInfectionEventInput = {
  action: "close";
  clientId: string;
  incidentId: string;
  occurredAt: string;
  closureOutcome: string;
  closureReason: string;
  expectedChainVersion: number;
  idempotencyKey: string;
};

export type InfectionEventMutationInput =
  | AppendInfectionEventInput | ClusterInfectionEventInput | CloseInfectionEventInput;

export type InfectionEventOperationResult = {
  operationId: string;
  incidentId: string;
  clientId: string;
  entryId: string | null;
  operationKind: InfectionAction;
  chainVersion: number;
  handlingStatus: InfectionHandlingStatus;
  clusterId: string | null;
  clusterLabel: string | null;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
