export const TRANSPORT_DIRECTIONS = ["pickup", "dropoff"] as const;
export const TRANSPORT_PLAN_STATUSES = [
  "draft_ready", "draft_conflicted", "published", "rejected",
] as const;
export const TRANSPORT_PLAN_STATUS_FILTERS = ["all", ...TRANSPORT_PLAN_STATUSES] as const;

export type TransportDirection = (typeof TRANSPORT_DIRECTIONS)[number];
export type TransportPlanStatus = (typeof TRANSPORT_PLAN_STATUSES)[number];
export type TransportPlanStatusFilter = (typeof TRANSPORT_PLAN_STATUS_FILTERS)[number];

export type TransportPlanFilters = {
  serviceDate: string;
  direction: "all" | TransportDirection;
  vehicleQuery: string;
  driverQuery: string;
  status: TransportPlanStatusFilter;
};

export type TransportVehicleOption = {
  code: string;
  name: string;
  capacity: number;
};

export type TransportDriverOption = {
  membershipId: string;
  userId: string;
  displayName: string;
  employeeCode: string | null;
  authorizationLabel: string;
};

export type TransportClientOption = {
  clientId: string;
  clientCode: string;
  displayName: string;
};

export type TransportPassenger = TransportClientOption & {
  pickupLabel: string;
  dropoffLabel: string;
};

export type TransportConflict = {
  key: string;
  code: "vehicle_capacity_exceeded" | "vehicle_time_overlap" |
    "driver_time_overlap" | "client_time_overlap";
  message: string;
  resourceType: "capacity" | "vehicle" | "driver" | "client";
  resourceKey: string;
  conflictingTripKey: string | null;
};

export type TransportTripPlan = {
  tripVersionId: string;
  tripKey: string;
  version: number;
  previousVersionId: string | null;
  contentHash: string;
  status: TransportPlanStatus;
  direction: TransportDirection;
  serviceDate: string;
  startsAt: string;
  endsAt: string;
  vehicle: TransportVehicleOption;
  driver: TransportDriverOption;
  pickupLabel: string;
  dropoffLabel: string;
  passengers: readonly TransportPassenger[];
  conflicts: readonly TransportConflict[];
  ruleVersionId: string;
  ruleSourceStatus: "manual_unstandardized";
  revisionReason: string;
  createdByUserId: string;
  createdByDisplayName: string;
  createdAt: string;
  reviewedByUserId: string | null;
  reviewerDisplayName: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  notificationStatus: "not_configured";
};

export type TransportPlanSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  filters: TransportPlanFilters;
  policyStatus: "manual_unstandardized" | "not_configured" | "ambiguous";
  policyVersionId: string | null;
  policyVersion: number | null;
  vehicles: readonly TransportVehicleOption[];
  drivers: readonly TransportDriverOption[];
  clients: readonly TransportClientOption[];
  clientTotal: number;
  clientsTruncated: boolean;
  trips: readonly TransportTripPlan[];
  matchingTripTotal: number;
  tripsTruncated: boolean;
  passengerTotal: number;
  capacityConflictTotal: number;
  pendingPublicationTotal: number;
  offlineStatus: "not_configured";
  exportStatus: "not_configured";
  notificationProviderStatus: "not_configured";
  demo: boolean;
};

export type SaveTransportTripInput = {
  action: "save_trip";
  mode: "create" | "revise";
  tripKey: string | null;
  previousVersionId: string | null;
  expectedVersion: number;
  expectedContentHash: string | null;
  direction: TransportDirection;
  serviceDate: string;
  startsAt: string;
  endsAt: string;
  vehicleCode: string;
  driverMembershipId: string;
  pickupLabel: string;
  dropoffLabel: string;
  passengers: readonly {
    clientId: string;
    pickupLabel: string;
    dropoffLabel: string;
  }[];
  revisionReason: string;
  idempotencyKey: string;
};

export type DecideTransportTripInput = {
  action: "decide_trip";
  decision: "publish" | "override" | "reject";
  tripVersionId: string;
  expectedTripKey: string;
  expectedVersion: number;
  expectedContentHash: string;
  expectedConflictCount: number;
  expectedRuleVersionId: string;
  reason: string;
  idempotencyKey: string;
};

export type TransportPlanMutationInput = SaveTransportTripInput | DecideTransportTripInput;

export type TransportPlanMutationReceipt = {
  operationId: string;
  action: "save_trip" | "decide_trip";
  decision: "publish" | "override" | "reject" | null;
  tripVersionId: string;
  tripKey: string;
  version: number;
  status: TransportPlanStatus;
  conflictCount: number;
  contentHash: string;
  ruleVersionId: string;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
