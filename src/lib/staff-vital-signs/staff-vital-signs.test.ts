import { describe, expect, it } from "vitest";

import { buildDemoStaffVitalSignSnapshot } from "./demo";
import {
  parseStaffVitalSignRecordApiEnvelope,
  parseStaffVitalSignRecordInput,
  parseStaffVitalSignRecordReceipt,
} from "./parser";
import {
  projectStaffVitalSignSnapshot,
  type StaffVitalSignSnapshotSourceRow,
} from "./projection";
import type { StaffVitalSignFilters } from "./types";

const ORG = "69000000-0000-4000-8000-000000000001";
const BRANCH = "69000000-0000-4000-8000-000000000002";
const KEY = "69000000-0000-4000-8000-000000000003";
const VITAL = "69071000-0000-4000-8000-000000000001";
const VERSION = "69070000-0000-4000-8000-000000000001";
const STAFF = "69040000-0000-4000-8000-000000000001";
const filters: StaffVitalSignFilters = {
  staffMembershipId: null, measurementType: null, stateStatus: "all",
  dateFrom: null, dateTo: null, query: "",
};
const body = {
  action: "create", vital_sign_key: VITAL, previous_version_id: null,
  expected_base_version: 0, staff_membership_id: STAFF,
  measurement_type: "合成量測類型", value_status: "measured",
  value_decimal_text: "00120.00", unit: "合成單位", status_reason: null,
  occurred_at: "2026-09-02T08:30:00+08:00", source: "合成手動來源",
  note: "合成備註", correction_reason: null,
};
const receipt = {
  organization_id: ORG, branch_id: BRANCH, vital_sign_key: VITAL,
  record_version_id: VERSION, version: 1, previous_version_id: null,
  record_status: "active", completion_status: "completed",
  staff_membership_id: STAFF, content_hash: "a".repeat(64),
  threshold_evaluation_status: "not_configured",
  recorded_at: "2026-09-02T04:00:00.000Z", replayed: false,
};

describe("page-69 staff vital-sign contracts", () => {
  it("preserves exact decimal text without numeric normalization", () => {
    expect(parseStaffVitalSignRecordInput(body, KEY)).toMatchObject({
      valueStatus: "measured", valueDecimalText: "00120.00",
      unit: "合成單位", occurredAt: "2026-09-02T00:30:00.000Z",
    });
  });

  it("separates missing and not-applicable from measured values", () => {
    for (const status of ["missing", "not_applicable"] as const) {
      expect(parseStaffVitalSignRecordInput({ ...body,
        value_status: status, value_decimal_text: null, unit: null,
        status_reason: `${status} 的合成原因`,
      }, KEY)).toMatchObject({ valueStatus: status, valueDecimalText: null });
    }
    expect(() => parseStaffVitalSignRecordInput({ ...body,
      value_status: "missing", status_reason: "合成原因",
    }, KEY)).toThrow(/缺值或不適用/u);
  });

  it("rejects exponent notation, bare signs, and excessive precision", () => {
    for (const value of ["1e2", "+", "1.1234567890123"]) {
      expect(() => parseStaffVitalSignRecordInput({ ...body,
        value_decimal_text: value,
      }, KEY)).toThrow();
    }
  });

  it("rejects unknown medical, threshold, attachment, export, and offline keys", () => {
    for (const extra of [
      { diagnosis: "normal" }, { warning_status: "abnormal" },
      { attachment_reference: "browser://fake" }, { export: true },
      { offline: true },
    ]) expect(() => parseStaffVitalSignRecordInput({ ...body, ...extra }, KEY))
      .toThrow();
  });

  it("requires immutable correction and void base shapes", () => {
    expect(() => parseStaffVitalSignRecordInput({ ...body,
      action: "correct", previous_version_id: VERSION,
      expected_base_version: 1, correction_reason: null,
    }, KEY)).toThrow();
    expect(parseStaffVitalSignRecordInput({ action: "void",
      vital_sign_key: VITAL, previous_version_id: VERSION,
      expected_base_version: 1, staff_membership_id: STAFF,
      correction_reason: "合成作廢理由",
    }, KEY)).toMatchObject({ action: "void", measurementType: null });
  });

  it("strictly correlates tenant, version, status, and threshold receipt", () => {
    const input = parseStaffVitalSignRecordInput(body, KEY);
    expect(parseStaffVitalSignRecordReceipt(receipt, input, ORG, BRANCH))
      .toMatchObject({ vitalSignKey: VITAL, version: 1,
        thresholdEvaluationStatus: "not_configured" });
    for (const override of [
      { branch_id: ORG }, { version: 2 }, { record_status: "voided" },
      { threshold_evaluation_status: "configured" },
    ]) expect(() => parseStaffVitalSignRecordReceipt(
      { ...receipt, ...override }, input, ORG, BRANCH,
    )).toThrow();
  });

  it("correlates HTTP status with replay state", () => {
    const input = parseStaffVitalSignRecordInput(body, KEY);
    const apiReceipt = {
      organizationId: ORG, branchId: BRANCH, vitalSignKey: VITAL,
      recordVersionId: VERSION, version: 1, previousVersionId: null,
      recordStatus: "active", completionStatus: "completed",
      staffMembershipId: STAFF, contentHash: "a".repeat(64),
      thresholdEvaluationStatus: "not_configured",
      recordedAt: "2026-09-02T04:00:00.000Z", replayed: false,
      persisted: true, demo: false,
    };
    const envelope = { requestId: KEY, status: "ok", errors: [],
      data: { receipt: apiReceipt, persisted: true, demo: false } };
    expect(parseStaffVitalSignRecordApiEnvelope(
      envelope, input, ORG, BRANCH, 201,
    )).toMatchObject({ vitalSignKey: VITAL });
    expect(() => parseStaffVitalSignRecordApiEnvelope(
      envelope, input, ORG, BRANCH, 200,
    )).toThrow();
  });

  it("provides a synthetic read-only demo with same-snapshot trends", () => {
    const snapshot = demo();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.records).toHaveLength(5);
    expect(snapshot.measuredTotal).toBe(2);
    expect(snapshot.missingTotal).toBe(1);
    expect(snapshot.notApplicableTotal).toBe(1);
    expect(snapshot.voidedTotal).toBe(1);
    expect(snapshot.trendPointTotal).toBe(2);
    expect(snapshot.trendSeries[0]?.points.map((point) => point.valueDecimalText))
      .toEqual(["118.500", "120.00"]);
    expect(snapshot.thresholdRuleStatus).toBe("not_configured");
    expect(snapshot.thresholdWarningTotal).toBeNull();
  });

  it("filters missing, not-applicable, and measured records independently", () => {
    for (const [stateStatus, expected] of [
      ["measured", 2], ["missing", 1], ["not_applicable", 1], ["voided", 1],
    ] as const) {
      const snapshot = buildDemoStaffVitalSignSnapshot({
        organizationId: ORG, branchId: BRANCH,
        filters: { ...filters, stateStatus },
        now: new Date("2026-09-02T04:00:00.000Z"),
      });
      expect(snapshot.records).toHaveLength(expected);
    }
  });

  it("rejects inconsistent totals even when a snapshot claims truncation", () => {
    const source = buildSource(demo());
    expect(() => projectStaffVitalSignSnapshot({
      row: { ...source, records_truncated: true, record_total: 201,
        measured_total: 202 },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters, demo: false,
    })).toThrow("STAFF_VITAL_SIGN_SNAPSHOT_INVALID");
    expect(() => projectStaffVitalSignSnapshot({
      row: { ...source, records_truncated: true, record_total: 201,
        measured_total: 100, missing_total: 100,
        not_applicable_total: 100, voided_total: 0 },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters, demo: false,
    })).toThrow("STAFF_VITAL_SIGN_SNAPSHOT_INVALID");
  });

  it("rejects value-contract and threshold lies in snapshot rows", () => {
    const source = buildSource(demo());
    const first = source.records[0]!;
    for (const override of [
      { value_status: "missing", status_reason: "原因" },
      { threshold_evaluation_status: "configured" },
      { warning_status: "warning" },
    ]) expect(() => projectStaffVitalSignSnapshot({
      row: { ...source, records: [{ ...first, ...override },
        ...source.records.slice(1)] } as unknown as StaffVitalSignSnapshotSourceRow,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters, demo: false,
    })).toThrow("STAFF_VITAL_SIGN_SNAPSHOT_INVALID");
  });

  it("rejects a missing current version in an untruncated history", () => {
    const source = buildSource(demo());
    expect(() => projectStaffVitalSignSnapshot({
      row: { ...source, history: source.history.slice(1),
        history_total: source.history_total - 1 },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH,
      filters, demo: false,
    })).toThrow("STAFF_VITAL_SIGN_SNAPSHOT_INVALID");
  });
});

function demo() {
  return buildDemoStaffVitalSignSnapshot({
    organizationId: ORG, branchId: BRANCH, filters,
    now: new Date("2026-09-02T04:00:00.000Z"),
  });
}

function buildSource(
  snapshot: ReturnType<typeof buildDemoStaffVitalSignSnapshot>,
): StaffVitalSignSnapshotSourceRow {
  return {
    organization_id: snapshot.organizationId, branch_id: snapshot.branchId,
    generated_at: snapshot.generatedAt, snapshot_date: snapshot.snapshotDate,
    records: snapshot.records.map((record) => ({
      record_version_id: record.recordVersionId,
      vital_sign_key: record.vitalSignKey, version: record.version,
      previous_version_id: record.previousVersionId,
      record_status: record.recordStatus,
      correction_reason: record.correctionReason,
      completion_status: record.completionStatus,
      staff_membership_id: record.staffMembershipId,
      staff_user_id: record.staffUserId,
      staff_display_name: record.staffDisplayName,
      staff_employee_code: record.staffEmployeeCode,
      measurement_type: record.measurementType,
      value_status: record.valueStatus,
      value_decimal_text: record.valueDecimalText, unit: record.unit,
      status_reason: record.statusReason, occurred_at: record.occurredAt,
      source: record.source, note: record.note,
      threshold_evaluation_status: record.thresholdEvaluationStatus,
      threshold_version_id: null, warning_status: null,
      medical_interpretation_status: record.medicalInterpretationStatus,
      recorded_by: record.recordedBy,
      recorded_by_display_name: record.recordedByDisplayName,
      recorded_at: record.recordedAt, content_hash: record.contentHash,
    })),
    record_total: snapshot.recordTotal, records_truncated: snapshot.recordsTruncated,
    measured_total: snapshot.measuredTotal, missing_total: snapshot.missingTotal,
    not_applicable_total: snapshot.notApplicableTotal,
    voided_total: snapshot.voidedTotal,
    history: snapshot.history.map((record) => ({
      record_version_id: record.recordVersionId,
      vital_sign_key: record.vitalSignKey, version: record.version,
      previous_version_id: record.previousVersionId,
      record_status: record.recordStatus,
      correction_reason: record.correctionReason,
      completion_status: record.completionStatus,
      measurement_type: record.measurementType,
      value_status: record.valueStatus,
      value_decimal_text: record.valueDecimalText, unit: record.unit,
      status_reason: record.statusReason, occurred_at: record.occurredAt,
      source: record.source, note: record.note,
      recorded_by_display_name: record.recordedByDisplayName,
      recorded_at: record.recordedAt, content_hash: record.contentHash,
    })),
    history_total: snapshot.historyTotal, history_truncated: snapshot.historyTruncated,
    staff_options: snapshot.staffOptions.map((staff) => ({
      staff_membership_id: staff.staffMembershipId,
      staff_user_id: staff.staffUserId, display_name: staff.displayName,
      employee_code: staff.employeeCode, is_current: staff.isCurrent,
    })), staff_total: snapshot.staffTotal, staff_truncated: snapshot.staffTruncated,
    type_options: snapshot.typeOptions.map((option) => ({
      measurement_type: option.measurementType, record_count: option.recordCount,
    })), type_total: snapshot.typeTotal, types_truncated: snapshot.typesTruncated,
    threshold_rule_status: "not_configured", threshold_version_id: null,
    threshold_warning_total: null, threshold_pending_confirmation_total: null,
    scheduled_missing_rule_status: "not_configured", scheduled_missing_total: null,
    decimal_preservation: "verbatim_after_outer_trim",
    value_status_separation: "measured_missing_not_applicable",
    medical_interpretation_status: "not_evaluated",
    attachment_pipeline_status: "not_configured", export_status: "disabled",
    offline_status: "disabled", recent_aal2_max_age_minutes: 15,
  };
}
