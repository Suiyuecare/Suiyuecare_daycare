import { describe, expect, it } from "vitest";

import { buildDemoWeightSnapshot, filterDemoWeightSnapshot } from "./demo";
import { parseRecordWeight, parseWeightActionSuccess, parseWeightMutation, parseWeightOperationResult } from "./parser";
import { projectWeightManagementSnapshot, type WeightManagementSnapshotSourceRow } from "./projection";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const key = "40000000-0000-4000-8000-000000000001";

function projectionRow(): WeightManagementSnapshotSourceRow {
  return {
    organization_id: organizationId, branch_id: branchId,
    target_month: "2026-09-01", generated_at: "2026-09-01T10:00:00+08:00",
    item_total: 1, matching_total: 1, measured_total: 1, missing_total: 0,
    alert_total: 1, acknowledged_total: 0, unacknowledged_total: 1,
    items_truncated: false,
    client_options: [{ client_id: organizationId, display_name: "個案", client_status: "active", can_record: true }],
    client_option_total: 1, client_options_truncated: false,
    threshold_rule_status: "published", threshold_rule_id: key,
    threshold_version_number: 1, absolute_kg_threshold: "1.00",
    percent_threshold: "2.00", trigger_mode: "either",
    items: [{
      client_id: organizationId, client_display_name: "個案", client_status: "active",
      current_state: "provided", current_observation_id: branchId,
      current_original_weight_kg: "65.00", current_weight_kg: "65.00",
      current_observed_at: "2026-09-01T10:00:00+08:00", current_source: "人工量測",
      current_recorded_at: "2026-09-01T10:01:00+08:00", recorder_display_name: "護理師",
      current_correction_id: null, current_correction_version: 0,
      current_correction_kind: null, current_correction_reason: null,
      prior_state: "provided", prior_observation_id: "50000000-0000-4000-8000-000000000001",
      prior_weight_kg: "70.00", prior_observed_at: "2026-08-20T10:00:00+08:00",
      prior_correction_id: null, prior_correction_version: 0,
      delta_kg: "-5.00", delta_percent: "-7.14", change_direction: "loss",
      alert_status: "unacknowledged", rule_version_id: key, rule_version_number: 1,
      absolute_kg_threshold: "1.00", percent_threshold: "2.00", trigger_mode: "either",
      acknowledgement_id: null, acknowledgement_note: null,
      acknowledged_at: null, acknowledged_by: null,
    }],
  };
}

describe("weight management strict contracts", () => {
  it("projects exact signed decimals and distinct missing/not-applicable states", () => {
    const snapshot = buildDemoWeightSnapshot(organizationId, branchId, "2026-09-01");
    expect(snapshot.items[0]).toMatchObject({ deltaKg: "-2.00", deltaPercent: "-2.78", alertStatus: "unacknowledged" });
    expect(snapshot.items[1]).toMatchObject({ currentState: "missing", priorState: "missing", deltaKg: null });
    expect(snapshot.items[2]).toMatchObject({ currentState: "provided", priorState: "not_applicable", deltaKg: null });
    expect(snapshot.metrics).toEqual({ measured: 2, missing: 1, alerts: 1, acknowledged: 0, unacknowledged: 1 });
  });

  it("keeps demo filters and aggregate/detail parity", () => {
    const snapshot = buildDemoWeightSnapshot(organizationId, branchId, "2026-09-01");
    const filtered = filterDemoWeightSnapshot(snapshot, { targetMonth: "2026-09-01", clientId: null, changeDirection: "loss", alertStatus: "alert" });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.matchingTotal).toBe(1);
    expect(filtered.metrics.alerts).toBe(1);
  });

  it("normalizes bounded kg input and rejects scale or technical overflow", () => {
    expect(parseRecordWeight({ action: "record", clientId: organizationId, observedAt: "2026-09-01T10:00:00+08:00", weightKg: "60.5", source: "人工量測" }, key).weightKg).toBe("60.50");
    expect(() => parseRecordWeight({ action: "record", clientId: organizationId, observedAt: "2026-09-01T10:00:00+08:00", weightKg: "60.555", source: "人工量測" }, key)).toThrow();
    expect(() => parseRecordWeight({ action: "record", clientId: organizationId, observedAt: "2026-09-01T10:00:00+08:00", weightKg: "1000000", source: "人工量測" }, key)).toThrow();
  });

  it("accepts narrative line breaks but rejects hidden controls and void revival payloads", () => {
    expect(parseWeightMutation({ action: "correct", clientId: organizationId, observationId: branchId, expectedCorrectionVersion: 0, replacementWeightKg: "61", correctionReason: "第一行\n第二行" }, key).action).toBe("correct");
    expect(() => parseWeightMutation({ action: "correct", clientId: organizationId, observationId: branchId, expectedCorrectionVersion: 0, replacementWeightKg: "61", correctionReason: "惡意\u0000內容" }, key)).toThrow();
    expect(() => parseWeightMutation({ action: "void", clientId: organizationId, observationId: branchId, expectedCorrectionVersion: 0, replacementWeightKg: "61", correctionReason: "作廢" }, key)).toThrow();
  });

  it("fails closed on unknown or mismatched successful receipts", () => {
    const receipt = {
      operation_id: key, operation_kind: "record", client_id: organizationId,
      observation_id: branchId, correction_id: null, correction_version: null,
      prior_observation_id: null, rule_version_id: null,
      current_evidence_correction_version: null, prior_evidence_correction_version: null,
      acknowledgement_id: null, committed_at: "2026-09-01T10:00:00+08:00", replayed: false,
    };
    expect(parseWeightOperationResult(receipt).observationId).toBe(branchId);
    expect(() => parseWeightOperationResult({ ...receipt, malicious: true })).toThrow();
    const input = parseRecordWeight({ action: "record", clientId: organizationId, observedAt: "2026-09-01T10:00:00+08:00", weightKg: "60", source: "人工量測" }, key);
    expect(() => parseWeightActionSuccess({ requestId: key, status: "ok", errors: [], data: { operationId: key, operationKind: "record", clientId: branchId, observationId: branchId, correctionId: null, correctionVersion: null, priorObservationId: null, ruleVersionId: null, currentEvidenceCorrectionVersion: null, priorEvidenceCorrectionVersion: null, acknowledgementId: null, committedAt: "2026-09-01T10:00:00+08:00", replayed: false, persisted: true, demo: false } }, input)).toThrow(/MISMATCHED/u);
  });

  it("rejects forged alert states, partial rules, and incomplete acknowledgement evidence", () => {
    const project = (row: WeightManagementSnapshotSourceRow) => projectWeightManagementSnapshot({
      row, expectedOrganizationId: organizationId, expectedBranchId: branchId,
      expectedTargetMonth: "2026-09-01", demo: false,
    });
    expect(project(projectionRow()).items[0]?.alertStatus).toBe("unacknowledged");

    const partialRule = projectionRow();
    partialRule.items[0]!.rule_version_id = null;
    expect(() => project(partialRule)).toThrow(/INVALID_WEIGHT_MANAGEMENT_PROJECTION/u);

    const falseWithin = projectionRow();
    falseWithin.items[0]!.alert_status = "within_threshold";
    falseWithin.alert_total = 0; falseWithin.unacknowledged_total = 0;
    expect(() => project(falseWithin)).toThrow(/INVALID_WEIGHT_MANAGEMENT_PROJECTION/u);

    const incompleteAck = projectionRow();
    incompleteAck.items[0]!.alert_status = "acknowledged";
    incompleteAck.items[0]!.acknowledgement_id = "50000000-0000-4000-8000-000000000002";
    incompleteAck.items[0]!.acknowledgement_note = "已確認";
    incompleteAck.items[0]!.acknowledged_at = "2026-09-01T11:00:00+08:00";
    incompleteAck.acknowledged_total = 1; incompleteAck.unacknowledged_total = 0;
    expect(() => project(incompleteAck)).toThrow(/INVALID_WEIGHT_MANAGEMENT_PROJECTION/u);

    const partialHeader = projectionRow();
    partialHeader.threshold_rule_id = null;
    expect(() => project(partialHeader)).toThrow(/INVALID_WEIGHT_MANAGEMENT_PROJECTION/u);

    const mismatchedHeader = projectionRow();
    mismatchedHeader.threshold_rule_id = "50000000-0000-4000-8000-000000000003";
    expect(() => project(mismatchedHeader)).toThrow(/INVALID_WEIGHT_MANAGEMENT_PROJECTION/u);
  });
});
