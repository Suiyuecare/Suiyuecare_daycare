export const TRANSPORT_EXECUTION_STATUSES = [
  "not_started", "in_progress", "completed",
] as const;
export type TransportExecutionStatus = typeof TRANSPORT_EXECUTION_STATUSES[number];

export const TRANSPORT_EXECUTION_EXCEPTION_FILTERS = [
  "all", "with_exception", "without_exception", "late", "unmatched",
] as const;
export type TransportExecutionExceptionFilter =
  typeof TRANSPORT_EXECUTION_EXCEPTION_FILTERS[number];

export const TRANSPORT_EXECUTION_EVENT_TYPES = [
  "trip_started", "passenger_boarded", "passenger_alighted",
  "exception_recorded", "trip_completed",
] as const;
export type TransportExecutionEventType = typeof TRANSPORT_EXECUTION_EVENT_TYPES[number];

export interface TransportExecutionFilters {
  serviceDate: string;
  vehicleQuery: string;
  driverQuery: string;
  completionStatus: "all" | TransportExecutionStatus;
  exceptionStatus: TransportExecutionExceptionFilter;
}

export interface TransportExecutionPassenger {
  clientId: string;
  clientCode: string;
  displayName: string;
  pickupLabel: string;
  dropoffLabel: string;
  boardedAt: string | null;
  alightedAt: string | null;
  pairingResolved: boolean;
  resolutionNote: string | null;
  pairingStatus: "pending" | "onboard" | "paired" | "resolved_exception";
}

export interface TransportExecutionEvent {
  eventId: string;
  sequence: number;
  eventType: TransportExecutionEventType;
  clientId: string | null;
  occurredAt: string;
  note: string | null;
  resolvesPairing: boolean;
  actorUserId: string;
  actorDisplayName: string;
  contentHash: string;
  committedAt: string;
}

export interface TransportExecutionTrip {
  planVersionId: string;
  tripKey: string;
  planVersion: number;
  planContentHash: string;
  planDecision: "publish" | "override";
  direction: "pickup" | "dropoff";
  serviceDate: string;
  plannedStartsAt: string;
  plannedEndsAt: string;
  vehicleCode: string;
  vehicleName: string;
  driverMembershipId: string;
  driverUserId: string;
  driverDisplayName: string;
  pickupLabel: string;
  dropoffLabel: string;
  passengers: TransportExecutionPassenger[];
  events: TransportExecutionEvent[];
  eventsTruncated: boolean;
  executionSequence: number;
  status: TransportExecutionStatus;
  actualStartedAt: string | null;
  actualCompletedAt: string | null;
  lateSeconds: number | null;
  exceptionCount: number;
  unmatchedPassengerCount: number;
}

export interface TransportExecutionSnapshot {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  filters: TransportExecutionFilters;
  trips: TransportExecutionTrip[];
  matchingTripTotal: number;
  tripsTruncated: boolean;
  pendingTotal: number;
  inProgressTotal: number;
  completedTotal: number;
  lateTotal: number;
  unmatchedTripTotal: number;
  lateDefinition: "actual_start_after_planned_start";
  offlineStatus: "not_configured";
  exportStatus: "not_configured";
  notificationStatus: "not_configured";
  demo: boolean;
}

interface MutationBase {
  idempotencyKey: string;
  planVersionId: string;
  expectedTripKey: string;
  expectedPlanContentHash: string;
  expectedSequence: number;
  occurredAt: string;
}

export interface StartTransportTripInput extends MutationBase {
  action: "append_event";
  eventType: "trip_started";
  clientId: null;
  note: null;
  resolvesPairing: false;
}

export interface RecordTransportPassengerInput extends MutationBase {
  action: "append_event";
  eventType: "passenger_boarded" | "passenger_alighted";
  clientId: string;
  note: null;
  resolvesPairing: false;
}

export interface RecordTransportExceptionInput extends MutationBase {
  action: "append_event";
  eventType: "exception_recorded";
  clientId: string | null;
  note: string;
  resolvesPairing: boolean;
}

export interface CompleteTransportTripInput extends MutationBase {
  action: "append_event";
  eventType: "trip_completed";
  clientId: null;
  note: string | null;
  resolvesPairing: false;
}

export type TransportExecutionMutationInput = StartTransportTripInput |
  RecordTransportPassengerInput | RecordTransportExceptionInput |
  CompleteTransportTripInput;

export interface TransportExecutionMutationReceipt {
  operationId: string;
  eventId: string;
  eventType: TransportExecutionEventType;
  planVersionId: string;
  tripKey: string;
  clientId: string | null;
  sequence: number;
  status: TransportExecutionStatus;
  actualStartedAt: string;
  actualCompletedAt: string | null;
  exceptionCount: number;
  unmatchedPassengerCount: number;
  lateSeconds: number;
  resolvesPairing: boolean;
  eventContentHash: string;
  planContentHash: string;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
}
