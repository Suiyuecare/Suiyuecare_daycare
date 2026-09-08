import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { externalHealthTaipeiDate, isExternalHealthDate } from "./date";
import { buildDemoExternalHealthDeviceSnapshot } from "./demo";
import {
  parseExternalHealthActionInput,
  parseExternalHealthApiError,
  parseExternalHealthApiSuccess,
  parseExternalHealthDatabaseReceipt,
} from "./parser";
import { projectExternalHealthDeviceSnapshot } from "./projection";

const ORG = "65000000-0000-4000-8000-000000000001";
const BRANCH = "65000000-0000-4000-8000-000000000002";
const DEVICE = "65000000-0000-4000-8000-000000000003";
const CLIENT = "65000000-0000-4000-8000-000000000004";
const MEASUREMENT = "65000000-0000-4000-8000-000000000005";
const KEY = "65000000-0000-4000-8000-000000000006";
const OPERATION = "65000000-0000-4000-8000-000000000007";
const STATE = "65000000-0000-4000-8000-000000000008";
const CORRECTION = "65000000-0000-4000-8000-000000000009";
const REQUEST = "65000000-0000-4000-8000-000000000010";
const filters = { dateFrom: null, dateTo: null, clientId: null, deviceId: null,
  matchStatus: "all" as const, deviceStatus: "all" as const, metricCode: null };
const source = {
  organization_id: ORG, branch_id: BRANCH,
  generated_at: "2026-09-02T05:00:00.000Z",
  devices: [{ device_id: DEVICE, source_provider: "test-provider",
    source_device_id: "DEV-001", device_code: "BP-01",
    device_type: "blood_pressure_monitor", state_sequence: 2,
    operational_status: "active", assigned_client_id: CLIENT,
    assigned_client_display_name: "測試個案", assigned_client_code: "C-001",
    state_reason: "確認設備配對", state_changed_at: "2026-09-02T03:00:00.000Z",
    last_measurement_received_at: "2026-09-02T04:00:02.000Z",
    measurement_count: 1, connection_status: "not_configured" }],
  device_total: 1, devices_truncated: false, active_device_total: 1,
  disabled_device_total: 0, assigned_device_total: 1,
  measurements: [{ measurement_id: MEASUREMENT,
    source_provider: "test-provider", source_measurement_id: "M-001",
    device_id: DEVICE, device_code: "BP-01", metric_code: "systolic_bp",
    numeric_value: "128", unit: "mmHg",
    measured_at: "2026-09-02T04:00:00.000Z",
    received_at: "2026-09-02T04:00:02.000Z", match_status: "matched",
    client_id: CLIENT, client_display_name: "測試個案", client_code: "C-001",
    correction_sequence: 0, correction_reason: null,
    corrected_by_display_name: null, corrected_at: null }],
  measurement_total: 1, measurements_truncated: false,
  unmatched_measurement_total: 0, excluded_measurement_total: 0,
  client_options: [{ client_id: CLIENT, display_name: "測試個案",
    client_code: "C-001" }], client_total: 1, clients_truncated: false,
  metric_options: [{ metric_code: "systolic_bp", unit: "mmHg",
    measurement_count: 1 }], metric_total: 1, metrics_truncated: false,
  source_deduplication: "organization_branch_provider_source_measurement_id",
  source_integration_status: "database_contract_only",
  connection_policy_status: "not_configured",
  attachment_pipeline_status: "not_applicable", export_status: "not_configured",
};

function deviceInput() {
  return parseExternalHealthActionInput({ action: "assign_device",
    deviceId: DEVICE, expectedStateSequence: 2, clientId: CLIENT,
    reason: "確認設備交付給目前個案" }, KEY);
}

function matchInput() {
  return parseExternalHealthActionInput({ action: "correct_measurement_match",
    measurementId: MEASUREMENT, expectedCorrectionSequence: 0,
    matchStatus: "matched", clientId: CLIENT,
    reason: "核對來源設備與個案標籤" }, KEY);
}

describe("page-65 external health device contracts", () => {
  it("uses real Taipei calendar dates without normalizing invalid dates", () => {
    expect(isExternalHealthDate("2026-02-28")).toBe(true);
    expect(isExternalHealthDate("2026-02-30")).toBe(false);
    expect(externalHealthTaipeiDate("2026-09-01T16:10:00.000Z")).toBe("2026-09-02");
  });

  it("keeps the synthetic provider and connection boundary explicit", () => {
    const snapshot = buildDemoExternalHealthDeviceSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters, now: new Date("2026-09-02T05:00:00.000Z") });
    expect(snapshot.demo).toBe(true);
    expect(snapshot.sourceIntegrationStatus).toBe("database_contract_only");
    expect(snapshot.connectionPolicyStatus).toBe("not_configured");
    expect(snapshot.devices.every((item) => item.connectionStatus === "not_configured"))
      .toBe(true);
  });

  it("filters the synthetic device and measurement collections independently", () => {
    const snapshot = buildDemoExternalHealthDeviceSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters: { ...filters, clientId:
        "65000000-0000-4000-8000-000000000101" } });
    expect(snapshot.deviceTotal).toBe(1);
    expect(snapshot.measurementTotal).toBe(2);
    expect(snapshot.unmatchedMeasurementTotal).toBe(0);
  });

  it("projects a strict correlated snapshot with exact value text", () => {
    const snapshot = projectExternalHealthDeviceSnapshot({ row: source,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false });
    expect(snapshot).toMatchObject({ deviceTotal: 1, measurementTotal: 1,
      activeDeviceTotal: 1, unmatchedMeasurementTotal: 0 });
    expect(snapshot.measurements[0]).toMatchObject({ measurementId: MEASUREMENT,
      numericValue: "128", measuredAt: "2026-09-02T04:00:00.000Z" });
  });

  it.each([
    { ...source, branch_id: ORG },
    { ...source, active_device_total: 0 },
    { ...source, devices: [...source.devices, source.devices[0]] },
    { ...source, measurements: [{ ...source.measurements[0], numeric_value: "1e3" }] },
    { ...source, measurements: [{ ...source.measurements[0], match_status: "unmatched" }] },
    { ...source, measurements: [{ ...source.measurements[0], correction_sequence: 1 }] },
    { ...source, measurement_total: 3, measurements_truncated: true,
      unmatched_measurement_total: 2, excluded_measurement_total: 2 },
    { ...source, unexpected: "private" },
  ])("rejects forged, inconsistent, duplicate or scientific snapshot data %#", (row) => {
    expect(() => projectExternalHealthDeviceSnapshot({ row,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false }))
      .toThrow("INVALID_EXTERNAL_HEALTH_DEVICE_SNAPSHOT");
  });

  it("accepts only action-specific client combinations and no unknown fields", () => {
    expect(deviceInput()).toMatchObject({ action: "assign_device", clientId: CLIENT });
    expect(matchInput()).toMatchObject({ action: "correct_measurement_match",
      clientId: CLIENT });
    expect(() => parseExternalHealthActionInput({ action: "disable_device",
      deviceId: DEVICE, expectedStateSequence: 2, clientId: CLIENT,
      reason: "不可夾帶個案" }, KEY)).toThrow(IntegrationError);
    expect(() => parseExternalHealthActionInput({ action: "correct_measurement_match",
      measurementId: MEASUREMENT, expectedCorrectionSequence: 0,
      matchStatus: "unmatched", clientId: CLIENT, reason: "不可夾帶個案",
      private: true }, KEY)).toThrow(IntegrationError);
  });

  it("correlates both database receipt kinds to the exact next sequence", () => {
    const device = deviceInput();
    expect(parseExternalHealthDatabaseReceipt({ organization_id: ORG,
      branch_id: BRANCH, operation_id: OPERATION, action: "assign_device",
      device_id: DEVICE, state_event_id: STATE, state_sequence: 3,
      operational_status: "active", assigned_client_id: CLIENT,
      committed_at: "2026-09-02T05:00:00.000Z", replayed: false },
    device, ORG, BRANCH)).toMatchObject({ receiptKind: "device_state",
      stateSequence: 3, persisted: true });
    const match = matchInput();
    expect(parseExternalHealthDatabaseReceipt({ organization_id: ORG,
      branch_id: BRANCH, operation_id: OPERATION,
      action: "correct_measurement_match", measurement_id: MEASUREMENT,
      correction_id: CORRECTION, correction_sequence: 1,
      match_status: "matched", client_id: CLIENT,
      committed_at: "2026-09-02T05:00:00.000Z", replayed: false },
    match, ORG, BRANCH)).toMatchObject({ receiptKind: "measurement_match",
      correctionSequence: 1, persisted: true });
  });

  it("rejects uncorrelated database receipts", () => {
    expect(() => parseExternalHealthDatabaseReceipt({ organization_id: ORG,
      branch_id: BRANCH, operation_id: OPERATION,
      action: "correct_measurement_match", measurement_id: MEASUREMENT,
      correction_id: CORRECTION, correction_sequence: 2,
      match_status: "matched", client_id: CLIENT,
      committed_at: "2026-09-02T05:00:00.000Z", replayed: false },
    matchInput(), ORG, BRANCH)).toThrow(IntegrationError);
  });

  it("requires HTTP 201 for create and 200 only for exact replay", () => {
    const input = matchInput();
    const payload = { requestId: REQUEST, status: "ok", data: {
      receiptKind: "measurement_match", action: "correct_measurement_match",
      organizationId: ORG, branchId: BRANCH, operationId: OPERATION,
      measurementId: MEASUREMENT, correctionId: CORRECTION,
      correctionSequence: 1, matchStatus: "matched", clientId: CLIENT,
      committedAt: "2026-09-02T05:00:00.000Z", replayed: false,
      persisted: true, demo: false }, errors: [] };
    expect(parseExternalHealthApiSuccess(payload, input, ORG, BRANCH, 201).data)
      .toMatchObject({ measurementId: MEASUREMENT, persisted: true });
    expect(() => parseExternalHealthApiSuccess(payload, input, ORG, BRANCH, 200))
      .toThrow("MISMATCHED_EXTERNAL_HEALTH_SUCCESS");
    expect(parseExternalHealthApiSuccess({ ...payload,
      data: { ...payload.data, replayed: true } }, input, ORG, BRANCH, 200)
      .data.replayed).toBe(true);
  });

  it("accepts only bounded structured API errors", () => {
    expect(parseExternalHealthApiError({ requestId: REQUEST, status: "error",
      data: null, errors: [{ code: "EXTERNAL_HEALTH_CONFLICT",
        message: "請重新載入" }] })).not.toBeNull();
    expect(parseExternalHealthApiError({ status: "error", errors: [{
      code: "bad code", message: "secret", detail: "private" }] })).toBeNull();
  });
});
