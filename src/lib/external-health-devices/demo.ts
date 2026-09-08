import type {
  ExternalHealthDevice,
  ExternalHealthDeviceFilters,
  ExternalHealthDeviceSnapshot,
  ExternalHealthMeasurement,
} from "./types";

const ORIGIN = new Date("2026-09-02T05:00:00.000Z");

export function buildDemoExternalHealthDeviceSnapshot({
  organizationId,
  branchId,
  filters,
  now = ORIGIN,
}: {
  organizationId: string;
  branchId: string;
  filters: ExternalHealthDeviceFilters;
  now?: Date;
}): ExternalHealthDeviceSnapshot {
  const clients = [
    { clientId: "65000000-0000-4000-8000-000000000101",
      displayName: "合成個案甲", clientCode: "SYN-C001" },
    { clientId: "65000000-0000-4000-8000-000000000102",
      displayName: "合成個案乙", clientCode: "SYN-C002" },
  ] as const;
  const rawDevices: ExternalHealthDevice[] = [
    { deviceId: "65000000-0000-4000-8000-000000000201",
      sourceProvider: "synthetic-provider", sourceDeviceId: "SYN-DEV-001",
      deviceCode: "SYN-BP-01", deviceType: "blood_pressure_monitor",
      stateSequence: 2, operationalStatus: "active",
      assignedClientId: clients[0].clientId,
      assignedClientDisplayName: clients[0].displayName,
      assignedClientCode: clients[0].clientCode,
      stateReason: "合成展示配對", stateChangedAt: "2026-09-01T02:00:00.000Z",
      lastMeasurementReceivedAt: "2026-09-02T04:32:03.000Z",
      measurementCount: 2, connectionStatus: "not_configured" },
    { deviceId: "65000000-0000-4000-8000-000000000202",
      sourceProvider: "synthetic-provider", sourceDeviceId: "SYN-DEV-002",
      deviceCode: "SYN-OX-02", deviceType: "pulse_oximeter",
      stateSequence: 1, operationalStatus: "active",
      assignedClientId: null, assignedClientDisplayName: null,
      assignedClientCode: null, stateReason: "來源設備註冊",
      stateChangedAt: "2026-09-02T03:00:00.000Z",
      lastMeasurementReceivedAt: "2026-09-02T04:20:02.000Z",
      measurementCount: 1, connectionStatus: "not_configured" },
    { deviceId: "65000000-0000-4000-8000-000000000203",
      sourceProvider: "synthetic-provider", sourceDeviceId: "SYN-DEV-003",
      deviceCode: "SYN-WT-03", deviceType: "weight_scale",
      stateSequence: 3, operationalStatus: "disabled",
      assignedClientId: clients[1].clientId,
      assignedClientDisplayName: clients[1].displayName,
      assignedClientCode: clients[1].clientCode, stateReason: "合成展示停用",
      stateChangedAt: "2026-09-02T04:00:00.000Z",
      lastMeasurementReceivedAt: null, measurementCount: 0,
      connectionStatus: "not_configured" },
  ];
  const rawMeasurements: ExternalHealthMeasurement[] = [
    { measurementId: "65000000-0000-4000-8000-000000000301",
      sourceProvider: "synthetic-provider", sourceMeasurementId: "SYN-M-001",
      deviceId: rawDevices[0]!.deviceId, deviceCode: rawDevices[0]!.deviceCode,
      metricCode: "systolic_bp", numericValue: "128", unit: "mmHg",
      measuredAt: "2026-09-02T04:32:00.000Z",
      receivedAt: "2026-09-02T04:32:03.000Z", matchStatus: "matched",
      clientId: clients[0].clientId, clientDisplayName: clients[0].displayName,
      clientCode: clients[0].clientCode, correctionSequence: 0,
      correctionReason: null, correctedByDisplayName: null, correctedAt: null },
    { measurementId: "65000000-0000-4000-8000-000000000302",
      sourceProvider: "synthetic-provider", sourceMeasurementId: "SYN-M-002",
      deviceId: rawDevices[0]!.deviceId, deviceCode: rawDevices[0]!.deviceCode,
      metricCode: "diastolic_bp", numericValue: "76", unit: "mmHg",
      measuredAt: "2026-09-02T04:31:59.000Z",
      receivedAt: "2026-09-02T04:32:03.000Z", matchStatus: "matched",
      clientId: clients[0].clientId, clientDisplayName: clients[0].displayName,
      clientCode: clients[0].clientCode, correctionSequence: 0,
      correctionReason: null, correctedByDisplayName: null, correctedAt: null },
    { measurementId: "65000000-0000-4000-8000-000000000303",
      sourceProvider: "synthetic-provider", sourceMeasurementId: "SYN-M-003",
      deviceId: rawDevices[1]!.deviceId, deviceCode: rawDevices[1]!.deviceCode,
      metricCode: "spo2", numericValue: "97", unit: "%",
      measuredAt: "2026-09-02T04:20:00.000Z",
      receivedAt: "2026-09-02T04:20:02.000Z", matchStatus: "unmatched",
      clientId: null, clientDisplayName: null, clientCode: null,
      correctionSequence: 0, correctionReason: null,
      correctedByDisplayName: null, correctedAt: null },
  ];
  const localDate = (value: string) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
  const devices = rawDevices.filter((device) =>
    (filters.deviceId === null || device.deviceId === filters.deviceId) &&
    (filters.clientId === null || device.assignedClientId === filters.clientId) &&
    (filters.deviceStatus === "all" || device.operationalStatus === filters.deviceStatus));
  const measurements = rawMeasurements.filter((measurement) =>
    (filters.dateFrom === null || localDate(measurement.measuredAt) >= filters.dateFrom) &&
    (filters.dateTo === null || localDate(measurement.measuredAt) <= filters.dateTo) &&
    (filters.clientId === null || measurement.clientId === filters.clientId) &&
    (filters.deviceId === null || measurement.deviceId === filters.deviceId) &&
    (filters.matchStatus === "all" || measurement.matchStatus === filters.matchStatus) &&
    (filters.metricCode === null || measurement.metricCode === filters.metricCode));
  const metricMap = new Map<string, { metricCode: string; unit: string;
    measurementCount: number }>();
  for (const measurement of rawMeasurements) {
    const key = `${measurement.metricCode}\u0000${measurement.unit}`;
    const current = metricMap.get(key);
    metricMap.set(key, { metricCode: measurement.metricCode, unit: measurement.unit,
      measurementCount: (current?.measurementCount ?? 0) + 1 });
  }
  return {
    organizationId, branchId, generatedAt: now.toISOString(),
    staleAfter: new Date(now.getTime() + 5 * 60_000).toISOString(), filters,
    devices, deviceTotal: devices.length, devicesTruncated: false,
    activeDeviceTotal: devices.filter((device) => device.operationalStatus === "active").length,
    disabledDeviceTotal: devices.filter((device) => device.operationalStatus === "disabled").length,
    assignedDeviceTotal: devices.filter((device) => device.assignedClientId !== null).length,
    measurements, measurementTotal: measurements.length, measurementsTruncated: false,
    unmatchedMeasurementTotal: measurements.filter((item) => item.matchStatus === "unmatched").length,
    excludedMeasurementTotal: measurements.filter((item) => item.matchStatus === "excluded").length,
    clientOptions: clients, clientTotal: clients.length, clientsTruncated: false,
    metricOptions: [...metricMap.values()].sort((a, b) =>
      `${a.metricCode}\u0000${a.unit}`.localeCompare(`${b.metricCode}\u0000${b.unit}`, "en")),
    metricTotal: metricMap.size, metricsTruncated: false,
    sourceDeduplication: "organization_branch_provider_source_measurement_id",
    sourceIntegrationStatus: "database_contract_only",
    connectionPolicyStatus: "not_configured",
    attachmentPipelineStatus: "not_applicable",
    exportStatus: "not_configured", demo: true,
  };
}
