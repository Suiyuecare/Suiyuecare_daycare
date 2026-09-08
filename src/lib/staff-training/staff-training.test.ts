import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { buildDemoStaffTrainingSnapshot } from "./demo";
import {
  canonicalStaffTrainingDecimal,
  staffTrainingDecimalEqual,
} from "./decimal";
import {
  parseStaffTrainingRecordApiEnvelope,
  parseStaffTrainingRecordInput,
  parseStaffTrainingRecordReceipt,
  parseStaffTrainingRuleApiEnvelope,
} from "./parser";
import {
  projectStaffTrainingSnapshot,
  type StaffTrainingSnapshotSourceRow,
} from "./projection";
import type { StaffTrainingFilters } from "./types";

const ORG = "71000000-0000-4000-8000-000000000001";
const BRANCH = "71000000-0000-4000-8000-000000000002";
const STAFF = "71000000-0000-4000-8000-000000000003";
const USER = "71000000-0000-4000-8000-000000000004";
const KEY = "71000000-0000-4000-8000-000000000005";
const RECORD = "71000000-0000-4000-8000-000000000006";
const REQUEST = "71000000-0000-4000-8000-000000000007";
const filters: StaffTrainingFilters = {
  dateFrom: null, dateTo: null, staffMembershipId: null,
  courseType: null, status: "all", query: "",
};

function source(): StaffTrainingSnapshotSourceRow {
  return {
    organization_id: ORG, branch_id: BRANCH,
    generated_at: "2026-09-01T04:00:00.000Z", snapshot_date: "2026-09-01",
    policy_status: "not_configured", rule_version_id: null, rule_version: null,
    rule_effective_from: null, rule_effective_to: null, window_years: null,
    required_credits: null, expiry_notice_days: null,
    records: [{ record_version_id: RECORD, training_key: KEY, version: 1,
      previous_version_id: null, record_status: "active", correction_reason: null,
      staff_membership_id: STAFF, staff_user_id: USER, staff_display_name: "王小明",
      staff_employee_code: "A-01", course_title: "訓練", training_date: "2026-08-20",
      starts_at: "2026-08-20T01:00:00.000Z", ends_at: "2026-08-20T02:00:00.000Z",
      course_type: "機構自訂", hours: "1.0000", credits: "99999999999999.9999",
      provider_name: "辦理單位", evidence_status: "missing",
      credit_expires_on: null, is_expiring: null, recorded_by: USER,
      recorded_by_display_name: "主管", recorded_at: "2026-08-20T03:00:00.000Z",
      content_hash: "a".repeat(64) }],
    record_total: 1, records_truncated: false, hours_total: "1.0000",
    credits_total: "99999999999999.9999", credited_record_total: 1,
    missing_credit_total: 0, missing_evidence_total: 1, expiring_total: null,
    staff_options: [{ staff_membership_id: STAFF, staff_user_id: USER,
      display_name: "王小明", employee_code: "A-01", is_current: true }],
    staff_total: 1, staff_truncated: false,
    course_type_options: [{ course_type: "機構自訂", record_count: 1 }],
    course_type_total: 1, course_types_truncated: false,
    staff_progress: [{ staff_membership_id: STAFF, staff_user_id: USER,
      display_name: "王小明", employee_code: "A-01", active_record_count: 1,
      known_credits: null, missing_credit_count: null, required_credits: null,
      credit_gap: null, progress_status: "not_configured", window_start: null,
      window_end: null, rule_version: null }],
    progress_total: 1, progress_truncated: false, gap_staff_total: null,
    indeterminate_staff_total: null, pending_rule_proposals: [],
    pending_rule_proposal_total: 0, pending_rule_proposals_truncated: false,
    attachment_pipeline_status: "not_configured",
    attachment_scan_status: "not_configured", external_reporting: "not_implemented",
    progress_scope: "published_rule_window_all_course_types",
  };
}

function createInput() {
  return parseStaffTrainingRecordInput({
    action: "create", training_key: KEY, previous_version_id: null,
    expected_base_version: 0, staff_membership_id: STAFF, course_title: "訓練",
    training_date: "2026-08-20", starts_at: "2026-08-20T09:00:00+08:00",
    ends_at: "2026-08-20T10:00:00+08:00", course_type: "機構自訂",
    hours: "1", credits: "99999999999999.9999", provider_name: "辦理單位",
    evidence_status: "missing", attachment_reference: null,
    attachment_sha256: null, correction_reason: null,
  }, KEY);
}

describe("page-71 staff training projection and parsers", () => {
  it("uses exact scaled decimal math at the numeric boundary", () => {
    expect(canonicalStaffTrainingDecimal("99999999999999.9999"))
      .toBe("99999999999999.9999");
    expect(staffTrainingDecimalEqual("1.1", "1.1000")).toBe(true);
    expect(staffTrainingDecimalEqual("99999999999999.9998",
      "99999999999999.9999")).toBe(false);
  });

  it("projects a bounded snapshot without treating missing policy as zero", () => {
    const projected = projectStaffTrainingSnapshot({ row: source(),
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false });
    expect(projected.creditsTotal).toBe("99999999999999.9999");
    expect(projected.staffProgress[0]).toMatchObject({
      progressStatus: "not_configured", knownCredits: null, creditGap: null,
    });
  });

  it.each([
    (row: StaffTrainingSnapshotSourceRow) => { row.hours_total = "2.0000"; },
    (row: StaffTrainingSnapshotSourceRow) => { row.records[0]!.training_date = "2026-02-31"; },
    (row: StaffTrainingSnapshotSourceRow) => { row.records[0]!.recorded_at = "2026-09-02T04:00:00Z"; },
    (row: StaffTrainingSnapshotSourceRow) => { row.record_total = 2; row.records_truncated = false; },
  ])("fails closed on malformed or stale projection %#", (mutate) => {
    const row = source(); mutate(row);
    expect(() => projectStaffTrainingSnapshot({ row,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false }))
      .toThrow("INVALID_STAFF_TRAINING_PROJECTION");
  });

  it("builds a truthful read-only demo with the selected filters", () => {
    const demo = buildDemoStaffTrainingSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters: { ...filters, status: "missing_evidence" } });
    expect(demo.demo).toBe(true);
    expect(demo.records.every((record) => record.evidenceStatus === "missing")).toBe(true);
  });

  it("rejects invalid calendar dates, extra fields and provided evidence", () => {
    expect(() => parseStaffTrainingRecordInput({
      action: "create", training_key: KEY, previous_version_id: null,
      expected_base_version: 0, staff_membership_id: STAFF, course_title: "訓練",
      training_date: "2026-02-31", starts_at: "2026-02-28T09:00:00+08:00",
      ends_at: "2026-02-28T10:00:00+08:00", course_type: "類型", hours: "1",
      credits: null, provider_name: "單位", evidence_status: "provided",
      attachment_reference: "untrusted", attachment_sha256: "a".repeat(64),
      correction_reason: null, secret: "leak",
    }, KEY)).toThrow(IntegrationError);
  });

  it("correlates record receipts to scope, version and completion time", () => {
    const input = createInput();
    const receipt = { organization_id: ORG, branch_id: BRANCH, training_key: KEY,
      record_version_id: RECORD, version: 1, previous_version_id: null,
      record_status: "active", staff_membership_id: STAFF, content_hash: "a".repeat(64),
      recorded_at: "2026-08-20T10:01:00+08:00", replayed: false };
    expect(parseStaffTrainingRecordReceipt(receipt, input, ORG, BRANCH).persisted).toBe(true);
    expect(() => parseStaffTrainingRecordReceipt({ ...receipt, branch_id: USER }, input,
      ORG, BRANCH)).toThrow("訓練紀錄結果無法與送出內容核對");
    expect(() => parseStaffTrainingRecordReceipt({ ...receipt,
      recorded_at: "2026-08-20T09:59:00+08:00" }, input, ORG, BRANCH))
      .toThrow("訓練紀錄結果無法與送出內容核對");
    expect(() => parseStaffTrainingRecordReceipt({ ...receipt,
      recorded_at: "2200-01-01T00:00:00Z" }, input, ORG, BRANCH))
      .toThrow("訓練紀錄結果無法與送出內容核對");
  });

  it.each([null, "receipt", { receipt: null }, { receipt: { secret: true } }])(
    "rejects primitive or malicious 2xx record envelopes %#", (data) => {
      expect(() => parseStaffTrainingRecordApiEnvelope({ requestId: REQUEST,
        status: "ok", data, errors: [] }, createInput(), ORG, BRANCH))
        .toThrow("訓練紀錄回應內容不完整");
    },
  );

  it("rejects an uncorrelated rule envelope without throwing a TypeError", () => {
    const input = { action: "publish" as const, proposalId: RECORD,
      effectiveFrom: null, effectiveTo: null, windowYears: null,
      requiredCredits: null, expiryNoticeDays: null, idempotencyKey: KEY };
    expect(() => parseStaffTrainingRuleApiEnvelope({ requestId: REQUEST,
      status: "ok", data: { receipt: 7, persisted: true, demo: false }, errors: [] },
    input, ORG, BRANCH)).toThrow("訓練規則回應內容不完整");
  });
});
