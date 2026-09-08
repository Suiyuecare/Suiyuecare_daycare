export type ClientLifecycleStatus =
  | "active"
  | "suspended"
  | "transferred"
  | "closed"
  | "deceased";

export type ClientServiceState =
  | "pending_admission"
  | ClientLifecycleStatus;
export type ClientLifecycleStatusFilter = "all" | ClientServiceState;

export type ClientTransitionKind =
  | "admit"
  | "suspend"
  | "resume"
  | "transfer"
  | "close"
  | "death";

export type ClientRegistryItem = {
  id: string;
  clientCode: string;
  displayName: string;
  dateOfBirth: string | null;
  status: ClientLifecycleStatus;
  serviceState: ClientServiceState;
  admittedOn: string | null;
  endedOn: string | null;
  sourceSystem: string;
  sourceUpdatedAt: string | null;
  rowVersion: number;
  updatedAt: string;
};

export type ClientRegistrySnapshot = {
  generatedAt: string;
  clients: readonly ClientRegistryItem[];
  demo: boolean;
};

/**
 * Page 61 intentionally has a narrower client projection than page 60. It
 * never carries date of birth, encrypted identifiers, source payloads, contact
 * details, health data, or actor UUIDs to the browser.
 */
export type ClientLifecycleClient = {
  id: string;
  clientCode: string;
  displayName: string;
  status: ClientLifecycleStatus;
  serviceState: ClientServiceState;
  admittedOn: string | null;
  endedOn: string | null;
  rowVersion: number;
  updatedAt: string;
};

export type ClientTransitionItem = {
  id: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  eventKind: ClientTransitionKind;
  effectiveOn: string;
  reason: string;
  handoffNote: string | null;
  fromStatus: ClientLifecycleStatus;
  toStatus: ClientLifecycleStatus;
  fromServiceState: ClientServiceState;
  toServiceState: ClientServiceState;
  baseRowVersion: number;
  resultingRowVersion: number;
  actorLabel: string;
  createdByCurrentUser: boolean;
  createdAt: string;
};

export type ClientLifecycleSnapshot = {
  generatedAt: string;
  clients: readonly ClientLifecycleClient[];
  transitions: readonly ClientTransitionItem[];
  metrics: {
    admittedThisMonth: number;
    pendingAdmission: number;
    suspended: number;
    endedThisMonth: number;
    pendingHandoff: number;
  };
  historyPage: number;
  historyPageSize: number;
  historyTotal: number;
  demo: boolean;
};

export type ClientTransitionInput = {
  clientId: string;
  eventKind: ClientTransitionKind;
  effectiveOn: string;
  reason: string;
  handoffNote: string | null;
  expectedRowVersion: number;
  idempotencyKey: string;
};

export type ClientTransitionResult = {
  transitionId: string;
  clientId: string;
  fromStatus: ClientLifecycleStatus;
  toStatus: ClientLifecycleStatus;
  resultingRowVersion: number;
  replayed: boolean;
};

export const CLIENT_LIFECYCLE_STATUSES = Object.freeze([
  "active",
  "suspended",
  "transferred",
  "closed",
  "deceased",
] as const);

export const CLIENT_TRANSITION_KINDS = Object.freeze([
  "admit",
  "suspend",
  "resume",
  "transfer",
  "close",
  "death",
] as const);
