export const EXTERNAL_HEALTH_MATCH_STATUSES = [
  "all", "matched", "unmatched", "excluded",
] as const;
export type ExternalHealthMatchStatus =
  (typeof EXTERNAL_HEALTH_MATCH_STATUSES)[number];

export const EXTERNAL_HEALTH_DEVICE_STATUSES = ["all", "active", "disabled"] as const;
export type ExternalHealthDeviceStatus =
  (typeof EXTERNAL_HEALTH_DEVICE_STATUSES)[number];

export type ExternalHealthDeviceFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  clientId: string | null;
  deviceId: string | null;
  matchStatus: ExternalHealthMatchStatus;
  deviceStatus: ExternalHealthDeviceStatus;
  metricCode: string | null;
};

export type ExternalHealthClientOption = {
  clientId: string;
  displayName: string;
  clientCode: string;
};

export type ExternalHealthMetricOption = {
  metricCode: string;
  unit: string;
  measurementCount: number;
};

export type ExternalHealthDevice = {
  deviceId: string;
  sourceProvider: string;
  sourceDeviceId: string;
  deviceCode: string;
  deviceType: string;
  stateSequence: number;
  operationalStatus: Exclude<ExternalHealthDeviceStatus, "all">;
  assignedClientId: string | null;
  assignedClientDisplayName: string | null;
  assignedClientCode: string | null;
  stateReason: string;
  stateChangedAt: string;
  lastMeasurementReceivedAt: string | null;
  measurementCount: number;
  connectionStatus: "not_configured";
};

export type ExternalHealthMeasurement = {
  measurementId: string;
  sourceProvider: string;
  sourceMeasurementId: string;
  deviceId: string;
  deviceCode: string;
  metricCode: string;
  numericValue: string;
  unit: string;
  measuredAt: string;
  receivedAt: string;
  matchStatus: Exclude<ExternalHealthMatchStatus, "all">;
  clientId: string | null;
  clientDisplayName: string | null;
  clientCode: string | null;
  correctionSequence: number;
  correctionReason: string | null;
  correctedByDisplayName: string | null;
  correctedAt: string | null;
};

export type ExternalHealthDeviceSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  filters: ExternalHealthDeviceFilters;
  devices: readonly ExternalHealthDevice[];
  deviceTotal: number;
  devicesTruncated: boolean;
  activeDeviceTotal: number;
  disabledDeviceTotal: number;
  assignedDeviceTotal: number;
  measurements: readonly ExternalHealthMeasurement[];
  measurementTotal: number;
  measurementsTruncated: boolean;
  unmatchedMeasurementTotal: number;
  excludedMeasurementTotal: number;
  clientOptions: readonly ExternalHealthClientOption[];
  clientTotal: number;
  clientsTruncated: boolean;
  metricOptions: readonly ExternalHealthMetricOption[];
  metricTotal: number;
  metricsTruncated: boolean;
  sourceDeduplication: "organization_branch_provider_source_measurement_id";
  sourceIntegrationStatus: "database_contract_only";
  connectionPolicyStatus: "not_configured";
  attachmentPipelineStatus: "not_applicable";
  exportStatus: "not_configured";
  demo: boolean;
};

export type ExternalHealthDeviceStateInput = {
  action: "assign_device" | "unassign_device" | "disable_device" | "enable_device";
  deviceId: string;
  expectedStateSequence: number;
  clientId: string | null;
  reason: string;
  idempotencyKey: string;
};

export type ExternalHealthMeasurementMatchInput = {
  action: "correct_measurement_match";
  measurementId: string;
  expectedCorrectionSequence: number;
  matchStatus: Exclude<ExternalHealthMatchStatus, "all">;
  clientId: string | null;
  reason: string;
  idempotencyKey: string;
};

export type ExternalHealthActionInput =
  | ExternalHealthDeviceStateInput
  | ExternalHealthMeasurementMatchInput;

export type ExternalHealthDeviceStateReceipt = {
  receiptKind: "device_state";
  action: ExternalHealthDeviceStateInput["action"];
  operationId: string;
  deviceId: string;
  stateEventId: string;
  stateSequence: number;
  operationalStatus: Exclude<ExternalHealthDeviceStatus, "all">;
  assignedClientId: string | null;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type ExternalHealthMeasurementMatchReceipt = {
  receiptKind: "measurement_match";
  action: "correct_measurement_match";
  operationId: string;
  measurementId: string;
  correctionId: string;
  correctionSequence: number;
  matchStatus: Exclude<ExternalHealthMatchStatus, "all">;
  clientId: string | null;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type ExternalHealthActionReceipt =
  | ExternalHealthDeviceStateReceipt
  | ExternalHealthMeasurementMatchReceipt;
