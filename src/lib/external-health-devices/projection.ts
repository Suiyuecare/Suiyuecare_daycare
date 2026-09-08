import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import type {
  ExternalHealthDeviceFilters,
  ExternalHealthDeviceSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const safeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const decimal = z.union([
  z.string().regex(/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/u),
  z.number().finite().transform((value) => String(value))
    .pipe(z.string().regex(/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/u)),
]);
const matchStatus = z.enum(["matched", "unmatched", "excluded"]);
const operationalStatus = z.enum(["active", "disabled"]);

const deviceSchema = z.object({
  device_id: uuid,
  source_provider: safeText(120),
  source_device_id: safeText(240),
  device_code: safeText(120),
  device_type: safeText(120),
  state_sequence: count.pipe(z.number().int().positive()),
  operational_status: operationalStatus,
  assigned_client_id: uuid.nullable(),
  assigned_client_display_name: safeText(120).nullable(),
  assigned_client_code: safeText(120).nullable(),
  state_reason: narrative(1_000),
  state_changed_at: timestamp,
  last_measurement_received_at: timestamp.nullable(),
  measurement_count: count,
  connection_status: z.literal("not_configured"),
}).strict();

const measurementSchema = z.object({
  measurement_id: uuid,
  source_provider: safeText(120),
  source_measurement_id: safeText(240),
  device_id: uuid,
  device_code: safeText(120),
  metric_code: safeText(120),
  numeric_value: decimal,
  unit: safeText(80),
  measured_at: timestamp,
  received_at: timestamp,
  match_status: matchStatus,
  client_id: uuid.nullable(),
  client_display_name: safeText(120).nullable(),
  client_code: safeText(120).nullable(),
  correction_sequence: count,
  correction_reason: narrative(1_000).nullable(),
  corrected_by_display_name: safeText(120).nullable(),
  corrected_at: timestamp.nullable(),
}).strict();

const clientSchema = z.object({
  client_id: uuid,
  display_name: safeText(120),
  client_code: safeText(120),
}).strict();

const metricSchema = z.object({
  metric_code: safeText(120),
  unit: safeText(80),
  measurement_count: count,
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  devices: z.array(deviceSchema).max(200),
  device_total: count,
  devices_truncated: z.boolean(),
  active_device_total: count,
  disabled_device_total: count,
  assigned_device_total: count,
  measurements: z.array(measurementSchema).max(200),
  measurement_total: count,
  measurements_truncated: z.boolean(),
  unmatched_measurement_total: count,
  excluded_measurement_total: count,
  client_options: z.array(clientSchema).max(500),
  client_total: count,
  clients_truncated: z.boolean(),
  metric_options: z.array(metricSchema).max(200),
  metric_total: count,
  metrics_truncated: z.boolean(),
  source_deduplication: z.literal(
    "organization_branch_provider_source_measurement_id",
  ),
  source_integration_status: z.literal("database_contract_only"),
  connection_policy_status: z.literal("not_configured"),
  attachment_pipeline_status: z.literal("not_applicable"),
  export_status: z.literal("not_configured"),
}).strict();

export type ExternalHealthDeviceSnapshotSource = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_EXTERNAL_HEALTH_DEVICE_SNAPSHOT");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

export function projectExternalHealthDeviceSnapshot({
  row: value,
  expectedOrganizationId,
  expectedBranchId,
  filters,
  demo,
}: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: ExternalHealthDeviceFilters;
  demo: boolean;
}): ExternalHealthDeviceSnapshot {
  const parsed = sourceSchema.safeParse(value);
  const organization = uuid.safeParse(expectedOrganizationId);
  const branch = uuid.safeParse(expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data ||
      row.devices.length > row.device_total ||
      row.measurements.length > row.measurement_total ||
      row.client_options.length > row.client_total ||
      row.metric_options.length > row.metric_total ||
      row.devices_truncated !== (row.device_total > row.devices.length) ||
      row.measurements_truncated !== (row.measurement_total > row.measurements.length) ||
      row.clients_truncated !== (row.client_total > row.client_options.length) ||
      row.metrics_truncated !== (row.metric_total > row.metric_options.length) ||
      row.active_device_total + row.disabled_device_total !== row.device_total ||
      row.assigned_device_total > row.device_total ||
      row.unmatched_measurement_total > row.measurement_total ||
      row.excluded_measurement_total > row.measurement_total ||
      row.unmatched_measurement_total + row.excluded_measurement_total >
        row.measurement_total ||
      !unique(row.devices.map((device) => device.device_id)) ||
      !unique(row.measurements.map((measurement) => measurement.measurement_id)) ||
      !unique(row.client_options.map((client) => client.client_id)) ||
      !unique(row.metric_options.map((metric) => `${metric.metric_code}\u0000${metric.unit}`))) {
    invalid();
  }

  for (const device of row.devices) {
    const clientFields = [device.assigned_client_id,
      device.assigned_client_display_name, device.assigned_client_code];
    if (!(clientFields.every((field) => field === null) ||
        clientFields.every((field) => field !== null))) invalid();
  }
  let previousSort = "";
  for (const measurement of row.measurements) {
    const clientFields = [measurement.client_id,
      measurement.client_display_name, measurement.client_code];
    const hasClient = clientFields.every((field) => field !== null);
    const hasNoClient = clientFields.every((field) => field === null);
    const hasCorrection = measurement.correction_sequence > 0 &&
      measurement.correction_reason !== null &&
      measurement.corrected_by_display_name !== null &&
      measurement.corrected_at !== null;
    const sort = `${measurement.measured_at}:${measurement.received_at}:${measurement.measurement_id}`;
    if ((!hasClient && !hasNoClient) ||
        (measurement.match_status === "matched") !== hasClient ||
        (measurement.match_status !== "matched" && !hasNoClient) ||
        (measurement.correction_sequence > 0) !== hasCorrection ||
        (measurement.correction_sequence === 0 && (
          measurement.correction_reason !== null ||
          measurement.corrected_by_display_name !== null ||
          measurement.corrected_at !== null
        )) || (measurement.corrected_at !== null &&
          measurement.corrected_at < measurement.measured_at) ||
        (previousSort !== "" && sort > previousSort)) invalid();
    previousSort = sort;
  }
  if (!row.devices_truncated) {
    if (row.active_device_total !== row.devices.filter((device) =>
      device.operational_status === "active").length ||
      row.disabled_device_total !== row.devices.filter((device) =>
        device.operational_status === "disabled").length ||
      row.assigned_device_total !== row.devices.filter((device) =>
        device.assigned_client_id !== null).length) invalid();
  }
  if (!row.measurements_truncated) {
    if (row.unmatched_measurement_total !== row.measurements.filter((measurement) =>
      measurement.match_status === "unmatched").length ||
      row.excluded_measurement_total !== row.measurements.filter((measurement) =>
        measurement.match_status === "excluded").length) invalid();
  }

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(Date.parse(row.generated_at) + 5 * 60_000).toISOString(),
    filters,
    devices: row.devices.map((device) => ({
      deviceId: device.device_id,
      sourceProvider: device.source_provider,
      sourceDeviceId: device.source_device_id,
      deviceCode: device.device_code,
      deviceType: device.device_type,
      stateSequence: device.state_sequence,
      operationalStatus: device.operational_status,
      assignedClientId: device.assigned_client_id,
      assignedClientDisplayName: device.assigned_client_display_name,
      assignedClientCode: device.assigned_client_code,
      stateReason: device.state_reason,
      stateChangedAt: device.state_changed_at,
      lastMeasurementReceivedAt: device.last_measurement_received_at,
      measurementCount: device.measurement_count,
      connectionStatus: device.connection_status,
    })),
    deviceTotal: row.device_total,
    devicesTruncated: row.devices_truncated,
    activeDeviceTotal: row.active_device_total,
    disabledDeviceTotal: row.disabled_device_total,
    assignedDeviceTotal: row.assigned_device_total,
    measurements: row.measurements.map((measurement) => ({
      measurementId: measurement.measurement_id,
      sourceProvider: measurement.source_provider,
      sourceMeasurementId: measurement.source_measurement_id,
      deviceId: measurement.device_id,
      deviceCode: measurement.device_code,
      metricCode: measurement.metric_code,
      numericValue: measurement.numeric_value,
      unit: measurement.unit,
      measuredAt: measurement.measured_at,
      receivedAt: measurement.received_at,
      matchStatus: measurement.match_status,
      clientId: measurement.client_id,
      clientDisplayName: measurement.client_display_name,
      clientCode: measurement.client_code,
      correctionSequence: measurement.correction_sequence,
      correctionReason: measurement.correction_reason,
      correctedByDisplayName: measurement.corrected_by_display_name,
      correctedAt: measurement.corrected_at,
    })),
    measurementTotal: row.measurement_total,
    measurementsTruncated: row.measurements_truncated,
    unmatchedMeasurementTotal: row.unmatched_measurement_total,
    excludedMeasurementTotal: row.excluded_measurement_total,
    clientOptions: row.client_options.map((client) => ({
      clientId: client.client_id,
      displayName: client.display_name,
      clientCode: client.client_code,
    })),
    clientTotal: row.client_total,
    clientsTruncated: row.clients_truncated,
    metricOptions: row.metric_options.map((metric) => ({
      metricCode: metric.metric_code,
      unit: metric.unit,
      measurementCount: metric.measurement_count,
    })),
    metricTotal: row.metric_total,
    metricsTruncated: row.metrics_truncated,
    sourceDeduplication: row.source_deduplication,
    sourceIntegrationStatus: row.source_integration_status,
    connectionPolicyStatus: row.connection_policy_status,
    attachmentPipelineStatus: row.attachment_pipeline_status,
    exportStatus: row.export_status,
    demo,
  };
}
