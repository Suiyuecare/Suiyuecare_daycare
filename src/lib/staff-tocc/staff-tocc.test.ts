import { describe, expect, it } from "vitest";

import { buildDemoStaffToccSnapshot } from "./demo";
import {
  parseStaffToccRecordApiEnvelope,
  parseStaffToccRecordInput,
  parseStaffToccRecordReceipt,
} from "./parser";
import { projectStaffToccSnapshot, type StaffToccSnapshotSourceRow } from "./projection";
import type { StaffToccFilters } from "./types";

const ORG = "74000000-0000-4000-8000-000000000001";
const BRANCH = "74000000-0000-4000-8000-000000000002";
const KEY = "74000000-0000-4000-8000-000000000003";
const TOCC = "74071000-0000-4000-8000-000000000001";
const STAFF = "74040000-0000-4000-8000-000000000001";
const VERSION = "74070000-0000-4000-8000-000000000001";
const filters: StaffToccFilters = {
  staffMembershipId: null, validityStatus: "all", attentionStatus: "all",
  dispositionStatus: "all", dateFrom: null, dateTo: null, query: "",
};
const inputBody = {
  action: "create", tocc_key: TOCC, previous_version_id: null,
  expected_base_version: 0, staff_membership_id: STAFF,
  assessed_on: "2026-08-01", valid_through: "2026-08-31",
  validity_source: "人工輸入效期來源", result_text: "來源結果文字",
  manual_attention_flag: true, attention_note: "人工標記原因",
  evidence_status: "missing", attachment_reference: null,
  attachment_sha256: null, disposition_status: "pending",
  disposition_note: "人工處置待辦", correction_reason: null,
} as const;
const receipt = {
  organization_id: ORG, branch_id: BRANCH, tocc_key: TOCC,
  record_version_id: VERSION, version: 1, previous_version_id: null,
  record_status: "active", staff_membership_id: STAFF,
  content_hash: "a".repeat(64), evaluated_on: "2026-09-02",
  expiry_warning: true, manual_attention_warning: true,
  warning_basis: "manual_valid_through_and_manual_attention_flag",
  recorded_at: "2026-09-02T04:00:00.000Z", replayed: false,
} as const;

describe("page-74 staff TOCC contracts", () => {
  it("parses manually supplied validity, result, flag and disposition facts", () => {
    expect(parseStaffToccRecordInput(inputBody, KEY)).toMatchObject({
      action: "create", validThrough: "2026-08-31",
      validitySource: "人工輸入效期來源", manualAttentionFlag: true,
      attentionNote: "人工標記原因", dispositionStatus: "pending",
      attachmentReference: null,
    });
  });

  it.each([
    { ...inputBody, valid_through: "2026-07-31" },
    { ...inputBody, manual_attention_flag: false },
    { ...inputBody, disposition_status: "not_recorded" },
    { ...inputBody, evidence_status: "provided",
      attachment_reference: "browser-path", attachment_sha256: "a".repeat(64) },
  ])("rejects misaligned dates, flags, disposition or untrusted attachment %#", (body) => {
    expect(() => parseStaffToccRecordInput(body, KEY)).toThrow();
  });

  it("correlates evaluated date and both warning booleans", () => {
    const input = parseStaffToccRecordInput(inputBody, KEY);
    expect(parseStaffToccRecordReceipt(receipt, input, ORG, BRANCH)).toMatchObject({
      evaluatedOn: "2026-09-02", expiryWarning: true,
      manualAttentionWarning: true, warningBasis:
        "manual_valid_through_and_manual_attention_flag",
    });
    expect(() => parseStaffToccRecordReceipt({ ...receipt,
      evaluated_on: "2026-08-30", expiry_warning: true,
    }, input, ORG, BRANCH)).toThrow();
  });

  it("requires HTTP status to agree with replay status", () => {
    const input = parseStaffToccRecordInput(inputBody, KEY);
    const apiReceipt = {
      organizationId: ORG, branchId: BRANCH, toccKey: TOCC,
      recordVersionId: VERSION, version: 1, previousVersionId: null,
      recordStatus: "active", staffMembershipId: STAFF,
      contentHash: "a".repeat(64), evaluatedOn: "2026-09-02",
      expiryWarning: true, manualAttentionWarning: true,
      warningBasis: "manual_valid_through_and_manual_attention_flag",
      recordedAt: "2026-09-02T04:00:00.000Z", replayed: false,
      persisted: true, demo: false,
    } as const;
    const envelope = { requestId: KEY, status: "ok", errors: [],
      data: { receipt: apiReceipt, persisted: true, demo: false } };
    expect(parseStaffToccRecordApiEnvelope(envelope, input, ORG, BRANCH, 201))
      .toMatchObject({ toccKey: TOCC });
    expect(() => parseStaffToccRecordApiEnvelope(envelope, input, ORG, BRANCH, 200))
      .toThrow();
  });

  it("builds synthetic-only warnings without interpreting result wording", () => {
    const snapshot = buildDemoStaffToccSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters, now: new Date("2026-09-02T04:00:00.000Z"),
    });
    expect(snapshot).toMatchObject({ demo: true, activeTotal: 2,
      expiredTotal: 1, manualAttentionTotal: 1, actionRequiredTotal: 1,
      validityRuleStatus: "not_configured",
      expiryReminderScheduleStatus: "not_configured",
      attachmentPipelineStatus: "not_configured",
      medicalInterpretationStatus: "not_evaluated",
    });
    const positiveLike = snapshot.records.find((record) =>
      record.resultText.includes("positive-like"));
    expect(positiveLike).toMatchObject({ manualAttentionFlag: false,
      manualAttentionWarning: false, warningReasons: [],
      medicalInterpretationStatus: "not_evaluated",
    });
  });

  it("applies bounded filters consistently", () => {
    const snapshot = buildDemoStaffToccSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters: { ...filters, attentionStatus: "flagged" },
      now: new Date("2026-09-02T04:00:00.000Z"),
    });
    expect(snapshot.recordTotal).toBe(1);
    expect(snapshot.records[0]).toMatchObject({ manualAttentionWarning: true,
      actionRequired: true,
    });
  });

  it("fails closed when a projected warning disagrees with manual facts", () => {
    const snapshot = buildDemoStaffToccSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters, now: new Date("2026-09-02T04:00:00.000Z"),
    });
    const first = snapshot.records[0]!;
    const source: StaffToccSnapshotSourceRow = {
      organization_id: snapshot.organizationId, branch_id: snapshot.branchId,
      generated_at: snapshot.generatedAt, snapshot_date: snapshot.snapshotDate,
      records: [{
        record_version_id: first.recordVersionId, tocc_key: first.toccKey,
        version: first.version, previous_version_id: first.previousVersionId,
        record_status: first.recordStatus, correction_reason: first.correctionReason,
        staff_membership_id: first.staffMembershipId, staff_user_id: first.staffUserId,
        staff_display_name: first.staffDisplayName,
        staff_employee_code: first.staffEmployeeCode, assessed_on: first.assessedOn,
        valid_through: first.validThrough, validity_source: first.validitySource,
        result_text: first.resultText, manual_attention_flag: first.manualAttentionFlag,
        attention_note: first.attentionNote, evidence_status: first.evidenceStatus,
        disposition_status: first.dispositionStatus,
        disposition_note: first.dispositionNote, validity_status: first.validityStatus,
        expiry_warning: !first.expiryWarning,
        manual_attention_warning: first.manualAttentionWarning,
        action_required: first.actionRequired, warning_reasons: [...first.warningReasons],
        warning_basis: first.warningBasis,
        medical_interpretation_status: first.medicalInterpretationStatus,
        recorded_by: first.recordedBy,
        recorded_by_display_name: first.recordedByDisplayName,
        recorded_at: first.recordedAt, content_hash: first.contentHash,
      }], record_total: 1, records_truncated: false,
      active_total: 0, expired_total: 1, manual_attention_total: 0,
      action_required_total: 0, history: [], history_total: 0,
      history_truncated: false, staff_options: [], staff_total: 0,
      staff_truncated: false, validity_rule_status: "not_configured",
      valid_through_source_mode: "manual_per_record",
      warning_basis: "manual_valid_through_and_manual_attention_flag",
      medical_interpretation_status: "not_evaluated",
      expiry_reminder_schedule_status: "not_configured",
      expiry_notice_days: null, expiring_total: null,
      attachment_pipeline_status: "not_configured",
      attachment_scan_status: "not_configured",
    };
    expect(() => projectStaffToccSnapshot({ row: source,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("STAFF_TOCC_SNAPSHOT_INVALID");
  });
});
