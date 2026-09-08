import { describe, expect, it } from "vitest";

import { buildDemoStaffLabReportSnapshot } from "./demo";
import {
  parseStaffLabReportRecordApiEnvelope,
  parseStaffLabReportRecordInput,
  parseStaffLabReportRecordReceipt,
} from "./parser";
import {
  projectStaffLabReportSnapshot,
  type StaffLabReportSnapshotSourceRow,
} from "./projection";
import type { StaffLabReportFilters } from "./types";

const ORG = "78000000-0000-4000-8000-000000000001";
const BRANCH = "78000000-0000-4000-8000-000000000002";
const KEY = "78000000-0000-4000-8000-000000000003";
const REPORT = "78071000-0000-4000-8000-000000000001";
const VERSION = "78070000-0000-4000-8000-000000000001";
const STAFF = "78040000-0000-4000-8000-000000000001";
const filters: StaffLabReportFilters = {
  staffMembershipId: null, reportType: null, validityStatus: "all",
  duplicateStatus: "all", evidenceStatus: "all",
  dateFrom: null, dateTo: null, query: "",
};
const body = {
  action: "create", report_key: REPORT, previous_version_id: null,
  expected_base_version: 0, staff_membership_id: STAFF,
  report_type: "合成檢驗類型", tested_on: "2026-08-20",
  provider_name: "合成院所", result_text: "合成結果文字",
  valid_through: "2026-10-20", validity_basis: "合成人工效期依據",
  evidence_status: "missing", attachment_reference: null,
  attachment_sha256: null, correction_reason: null,
};
const receipt = {
  organization_id: ORG, branch_id: BRANCH, report_key: REPORT,
  record_version_id: VERSION, version: 1, previous_version_id: null,
  record_status: "active", completion_status: "completed",
  staff_membership_id: STAFF, content_hash: "a".repeat(64),
  exact_duplicate_count: 1, key_field_duplicate_count: 2,
  duplicate_warning: true,
  duplicate_basis: "exact_content_or_same_staff_type_tested_on_provider",
  recorded_at: "2026-09-02T04:00:00.000Z", replayed: false,
};

describe("page-78 staff lab report contracts", () => {
  it("parses manual facts without inventing a medical state", () => {
    expect(parseStaffLabReportRecordInput(body, KEY)).toMatchObject({
      reportType: "合成檢驗類型", resultText: "合成結果文字",
      validThrough: "2026-10-20", validityBasis: "合成人工效期依據",
      evidenceStatus: "missing", attachmentReference: null,
    });
  });

  it("rejects unknown keys and browser-supplied attachment references", () => {
    expect(() => parseStaffLabReportRecordInput({ ...body,
      result_status: "normal",
    }, KEY)).toThrow();
    expect(() => parseStaffLabReportRecordInput({ ...body,
      evidence_status: "provided", attachment_reference: "browser://fake",
      attachment_sha256: "a".repeat(64),
    }, KEY)).toThrow();
  });

  it("rejects a reverse manual validity range", () => {
    expect(() => parseStaffLabReportRecordInput({ ...body,
      valid_through: "2026-08-19",
    }, KEY)).toThrow("人工輸入的有效至不得早於檢驗日期");
  });

  it("requires immutable correction and void base shapes", () => {
    expect(() => parseStaffLabReportRecordInput({ ...body,
      action: "correct", previous_version_id: VERSION,
      expected_base_version: 1, correction_reason: null,
    }, KEY)).toThrow();
    expect(parseStaffLabReportRecordInput({ action: "void", report_key: REPORT,
      previous_version_id: VERSION, expected_base_version: 1,
      staff_membership_id: STAFF, correction_reason: "合成作廢理由",
    }, KEY)).toMatchObject({ action: "void", reportType: null });
  });

  it("correlates both duplicate counts and the warning flag", () => {
    const input = parseStaffLabReportRecordInput(body, KEY);
    expect(parseStaffLabReportRecordReceipt(receipt, input, ORG, BRANCH))
      .toMatchObject({ exactDuplicateCount: 1, keyFieldDuplicateCount: 2,
        duplicateWarning: true, completionStatus: "completed" });
    expect(() => parseStaffLabReportRecordReceipt({ ...receipt,
      duplicate_warning: false }, input, ORG, BRANCH)).toThrow();
    expect(() => parseStaffLabReportRecordReceipt({ ...receipt,
      exact_duplicate_count: 3 }, input, ORG, BRANCH)).toThrow();
  });

  it("correlates HTTP status with replay state", () => {
    const input = parseStaffLabReportRecordInput(body, KEY);
    const apiReceipt = {
      organizationId: ORG, branchId: BRANCH, reportKey: REPORT,
      recordVersionId: VERSION, version: 1, previousVersionId: null,
      recordStatus: "active", completionStatus: "completed",
      staffMembershipId: STAFF, contentHash: "a".repeat(64),
      exactDuplicateCount: 1, keyFieldDuplicateCount: 2,
      duplicateWarning: true,
      duplicateBasis: "exact_content_or_same_staff_type_tested_on_provider",
      recordedAt: "2026-09-02T04:00:00.000Z", replayed: false,
      persisted: true, demo: false,
    };
    const envelope = { requestId: KEY, status: "ok", errors: [],
      data: { receipt: apiReceipt, persisted: true, demo: false } };
    expect(parseStaffLabReportRecordApiEnvelope(
      envelope, input, ORG, BRANCH, 201,
    )).toMatchObject({ reportKey: REPORT });
    expect(() => parseStaffLabReportRecordApiEnvelope(
      envelope, input, ORG, BRANCH, 200,
    )).toThrow();
  });

  it("provides a synthetic read-only demo with exact and key-only warnings", () => {
    const snapshot = buildDemoStaffLabReportSnapshot({
      organizationId: ORG, branchId: BRANCH, filters,
      now: new Date("2026-09-02T04:00:00.000Z"),
    });
    expect(snapshot.demo).toBe(true);
    expect(snapshot.records).toHaveLength(4);
    expect(snapshot.duplicateWarningTotal).toBe(3);
    expect(snapshot.records.some((record) =>
      record.duplicateBases.length === 1 &&
      record.duplicateBases[0] === "same_staff_type_tested_on_provider")).toBe(true);
    expect(snapshot.medicalInterpretationStatus).toBe("not_evaluated");
    expect(snapshot.expiryReminderScheduleStatus).toBe("not_configured");
    expect(snapshot.attachmentPipelineStatus).toBe("not_configured");
  });

  it("filters exact and key-field duplicate warnings without merging records", () => {
    const exact = buildDemoStaffLabReportSnapshot({
      organizationId: ORG, branchId: BRANCH,
      filters: { ...filters, duplicateStatus: "exact" },
      now: new Date("2026-09-02T04:00:00.000Z"),
    });
    const keyFields = buildDemoStaffLabReportSnapshot({
      organizationId: ORG, branchId: BRANCH,
      filters: { ...filters, duplicateStatus: "key_fields" },
      now: new Date("2026-09-02T04:00:00.000Z"),
    });
    expect(exact.records).toHaveLength(2);
    expect(keyFields.records).toHaveLength(3);
    expect(new Set(keyFields.records.map((record) => record.reportKey)).size).toBe(3);
  });

  it("rejects internally inconsistent snapshot counts", () => {
    const source: StaffLabReportSnapshotSourceRow = {
      organization_id: ORG, branch_id: BRANCH,
      generated_at: "2026-09-02T04:00:00.000Z", snapshot_date: "2026-09-02",
      records: [], record_total: 1, records_truncated: false,
      active_total: 0, expired_total: 0, missing_evidence_total: 0,
      duplicate_warning_total: 0, history: [], history_total: 0,
      history_truncated: false, staff_options: [], staff_total: 0,
      staff_truncated: false, type_options: [], type_total: 0,
      types_truncated: false, validity_rule_status: "not_configured",
      valid_through_source_mode: "manual_per_record",
      expiry_reminder_schedule_status: "not_configured",
      expiry_notice_days: null, expiring_total: null,
      duplicate_rule_status: "configured",
      duplicate_basis: "exact_content_or_same_staff_type_tested_on_provider",
      duplicate_resolution: "warning_only_no_auto_merge",
      medical_interpretation_status: "not_evaluated",
      attachment_pipeline_status: "not_configured",
      attachment_scan_status: "not_configured", recent_aal2_max_age_minutes: 15,
    };
    expect(() => projectStaffLabReportSnapshot({ row: source,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("STAFF_LAB_REPORT_SNAPSHOT_INVALID");
  });

  it("rejects omitted, mistyped, or wrong-date duplicate evidence", () => {
    const snapshot = buildDemoStaffLabReportSnapshot({
      organizationId: ORG, branchId: BRANCH, filters,
      now: new Date("2026-09-02T04:00:00.000Z"),
    });
    const base = buildSource(snapshot);
    const first = base.records[0]!;
    expect(() => projectStaffLabReportSnapshot({
      row: { ...base, records: [{ ...first, duplicate_matches:
        first.duplicate_matches.slice(0, 1) }, ...base.records.slice(1)] },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("STAFF_LAB_REPORT_SNAPSHOT_INVALID");
    expect(() => projectStaffLabReportSnapshot({
      row: { ...base, records: [{ ...first, duplicate_matches:
        first.duplicate_matches.map((match, index) => index === 0
          ? { ...match, match_kind: "same_staff_type_tested_on_provider" as const }
          : match) }, ...base.records.slice(1)] },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("STAFF_LAB_REPORT_SNAPSHOT_INVALID");
    expect(() => projectStaffLabReportSnapshot({
      row: { ...base, records: [{ ...first, duplicate_matches:
        first.duplicate_matches.map((match, index) => index === 0
          ? { ...match, tested_on: "2026-08-19" }
          : match) }, ...base.records.slice(1)] },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("STAFF_LAB_REPORT_SNAPSHOT_INVALID");
  });

  it("rejects impossible aggregate totals even when records are truncated", () => {
    const snapshot = buildDemoStaffLabReportSnapshot({
      organizationId: ORG, branchId: BRANCH, filters,
      now: new Date("2026-09-02T04:00:00.000Z"),
    });
    const base = buildSource(snapshot);
    expect(() => projectStaffLabReportSnapshot({
      row: { ...base, records_truncated: true, record_total: 201,
        active_total: 202 },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("STAFF_LAB_REPORT_SNAPSHOT_INVALID");
    expect(() => projectStaffLabReportSnapshot({
      row: { ...base, records_truncated: true, record_total: 201,
        missing_evidence_total: 202 },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("STAFF_LAB_REPORT_SNAPSHOT_INVALID");
    expect(() => projectStaffLabReportSnapshot({
      row: { ...base, records_truncated: true, record_total: 201,
        duplicate_warning_total: 202 },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("STAFF_LAB_REPORT_SNAPSHOT_INVALID");
  });
});

function buildSource(
  snapshot: ReturnType<typeof buildDemoStaffLabReportSnapshot>,
): StaffLabReportSnapshotSourceRow {
  return {
    organization_id: snapshot.organizationId, branch_id: snapshot.branchId,
    generated_at: snapshot.generatedAt, snapshot_date: snapshot.snapshotDate,
    records: snapshot.records.map((record) => ({
      record_version_id: record.recordVersionId, report_key: record.reportKey,
      version: record.version, previous_version_id: record.previousVersionId,
      record_status: record.recordStatus, correction_reason: record.correctionReason,
      completion_status: record.completionStatus,
      staff_membership_id: record.staffMembershipId,
      staff_user_id: record.staffUserId, staff_display_name: record.staffDisplayName,
      staff_employee_code: record.staffEmployeeCode, report_type: record.reportType,
      tested_on: record.testedOn, provider_name: record.providerName,
      result_text: record.resultText, valid_through: record.validThrough,
      validity_basis: record.validityBasis, evidence_status: record.evidenceStatus,
      attachment_reference: record.attachmentReference,
      attachment_sha256: record.attachmentSha256,
      validity_status: record.validityStatus,
      exact_duplicate_count: record.exactDuplicateCount,
      key_field_duplicate_count: record.keyFieldDuplicateCount,
      duplicate_warning: record.duplicateWarning,
      duplicate_bases: [...record.duplicateBases],
      duplicate_matches: record.duplicateMatches.map((match) => ({
        report_key: match.reportKey, record_version_id: match.recordVersionId,
        tested_on: match.testedOn, match_kind: match.matchKind,
      })), duplicate_matches_truncated: record.duplicateMatchesTruncated,
      duplicate_basis: record.duplicateBasis,
      medical_interpretation_status: record.medicalInterpretationStatus,
      recorded_by: record.recordedBy,
      recorded_by_display_name: record.recordedByDisplayName,
      recorded_at: record.recordedAt, content_hash: record.contentHash,
    })),
    record_total: snapshot.recordTotal, records_truncated: snapshot.recordsTruncated,
    active_total: snapshot.activeTotal, expired_total: snapshot.expiredTotal,
    missing_evidence_total: snapshot.missingEvidenceTotal,
    duplicate_warning_total: snapshot.duplicateWarningTotal,
    history: snapshot.history.map((record) => ({
      record_version_id: record.recordVersionId, report_key: record.reportKey,
      version: record.version, previous_version_id: record.previousVersionId,
      record_status: record.recordStatus, correction_reason: record.correctionReason,
      completion_status: record.completionStatus, report_type: record.reportType,
      tested_on: record.testedOn, provider_name: record.providerName,
      result_text: record.resultText, valid_through: record.validThrough,
      validity_basis: record.validityBasis, evidence_status: record.evidenceStatus,
      attachment_reference: record.attachmentReference,
      attachment_sha256: record.attachmentSha256,
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
      report_type: option.reportType, record_count: option.recordCount,
    })), type_total: snapshot.typeTotal, types_truncated: snapshot.typesTruncated,
    validity_rule_status: "not_configured",
    valid_through_source_mode: "manual_per_record",
    expiry_reminder_schedule_status: "not_configured",
    expiry_notice_days: null, expiring_total: null,
    duplicate_rule_status: "configured",
    duplicate_basis: "exact_content_or_same_staff_type_tested_on_provider",
    duplicate_resolution: "warning_only_no_auto_merge",
    medical_interpretation_status: "not_evaluated",
    attachment_pipeline_status: "not_configured",
    attachment_scan_status: "not_configured", recent_aal2_max_age_minutes: 15,
  };
}
