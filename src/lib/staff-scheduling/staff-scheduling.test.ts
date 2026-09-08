import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  addStaffSchedulingDays,
  isStaffSchedulingDate,
  staffSchedulingRangeDays,
  staffSchedulingTaipeiDate,
} from "./date";
import {
  buildDemoStaffSchedulingSnapshot,
  buildDemoStaffSchedulingSourceRow,
} from "./demo";
import {
  parseDecideStaffScheduleApiEnvelope,
  parseDecideStaffScheduleInput,
  parseDecideStaffScheduleReceipt,
  parseSubmitStaffScheduleApiEnvelope,
  parseSubmitStaffScheduleInput,
  parseSubmitStaffScheduleReceipt,
} from "./parser";
import { projectStaffSchedulingSnapshot } from "./projection";
import { parseStaffSchedulingFilters } from "./query";

const ORG = "63000000-0000-4000-8000-000000000101";
const BRANCH = "63000000-0000-4000-8000-000000000102";
const KEY = "63000000-0000-4000-8000-000000000103";
const SCHEDULE = "63000000-0000-4000-8000-000000000104";
const VERSION = "63000000-0000-4000-8000-000000000105";
const STAFF = "63000000-0000-4000-8000-000000000106";
const RULE = "63000000-0000-4000-8000-000000000107";
const DECISION = "63000000-0000-4000-8000-000000000108";
const RESULT = "63000000-0000-4000-8000-000000000109";
const REQUEST = "63000000-0000-4000-8000-000000000110";
const HASH = "a".repeat(64);
const filters = { periodStart: "2026-09-02", periodEnd: "2026-09-08",
  staffMembershipId: null, status: "all" as const };
const generatedAt = "2026-09-02T04:00:00.000Z";

function createBody(extra: Record<string, unknown> = {}) {
  return { action: "create", schedule_key: SCHEDULE, previous_version_id: null,
    expected_version: 0, expected_content_hash: null, staff_membership_id: STAFF,
    starts_at: "2026-09-03T01:00:00.000Z",
    ends_at: "2026-09-03T09:00:00.000Z", role_text: "合成人工角色",
    service_need_text: "合成服務需求", facility_code: "ROOM_A",
    vehicle_code: "VAN_A", planned_clients: 6,
    revision_reason: "依人工規則建立合成班表。", ...extra };
}

function decisionInput(decision: "publish" | "override" | "reject" = "publish") {
  return parseDecideStaffScheduleInput({ action: "decide",
    schedule_version_id: VERSION, expected_schedule_key: SCHEDULE,
    expected_version: 1, expected_content_hash: HASH,
    expected_conflict_count: decision === "override" ? 2 : 0,
    expected_rule_version_id: RULE, decision, reason: "合成獨立審核理由" },
  KEY, decision);
}

describe("Page 63 deterministic staff scheduling contracts", () => {
  it("parses a strict bounded period and scalar filters", () => {
    expect(parseStaffSchedulingFilters({ from: "2026-09-02", to: "2026-09-08",
      staff: STAFF.toUpperCase(), status: "conflicted" },
    new Date(generatedAt))).toEqual({ filters: { periodStart: "2026-09-02",
      periodEnd: "2026-09-08", staffMembershipId: STAFF, status: "conflicted" },
    invalid: false });
    expect(parseStaffSchedulingFilters({ from: ["2026-09-02"] }).invalid).toBe(true);
    expect(parseStaffSchedulingFilters({ to: "2026-12-31" },
      new Date(generatedAt)).invalid).toBe(true);
    expect(parseStaffSchedulingFilters({ staff: "not-a-uuid" }).invalid).toBe(true);
    expect(parseStaffSchedulingFilters({ ai: "on" }).invalid).toBe(true);
  });

  it("uses real Taiwan calendar dates and exact inclusive range days", () => {
    expect(isStaffSchedulingDate("2024-02-29")).toBe(true);
    expect(isStaffSchedulingDate("2025-02-29")).toBe(false);
    expect(staffSchedulingTaipeiDate(new Date(generatedAt))).toBe("2026-09-02");
    expect(addStaffSchedulingDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(staffSchedulingRangeDays("2026-09-02", "2026-09-08")).toBe(7);
  });

  it("projects a synthetic read-only deterministic snapshot", () => {
    const snapshot = buildDemoStaffSchedulingSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters, now: new Date(generatedAt) });
    expect(snapshot.demo).toBe(true);
    expect(snapshot.aiStatus).toBe("not_used");
    expect(snapshot.decisionEngine).toBe("deterministic_rule_assisted");
    expect(snapshot.automaticPublishStatus).toBe("disabled");
    expect(snapshot.qualificationProjection).toBe("page72_terminal");
    expect(snapshot.readyTotal).toBe(1);
    expect(snapshot.conflictedTotal).toBe(1);
  });

  it("rejects tenant drift, forged totals, and partial rule states", () => {
    const source = buildDemoStaffSchedulingSourceRow({ organizationId: ORG,
      branchId: BRANCH, filters, now: new Date(generatedAt) });
    for (const row of [{ ...source, organization_id: STAFF },
      { ...source, record_total: 3 },
      { ...source, vehicle_rule_status: "not_configured" as const }]) {
      expect(() => projectStaffSchedulingSnapshot({ row,
        expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: true }))
        .toThrow("STAFF_SCHEDULING_SNAPSHOT_INVALID");
    }
  });

  it("rejects a forged latest record that is missing or drifting from history", () => {
    const source = buildDemoStaffSchedulingSourceRow({ organizationId: ORG,
      branchId: BRANCH, filters, now: new Date(generatedAt) });
    expect(() => projectStaffSchedulingSnapshot({ row: { ...source,
      history: source.history.slice(1), history_total: source.history_total - 1 },
    expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: true }))
      .toThrow("STAFF_SCHEDULING_SNAPSHOT_INVALID");
    expect(() => projectStaffSchedulingSnapshot({ row: { ...source,
      history: source.history.map((item, index) => index === 0
        ? { ...item, content_hash: "f".repeat(64) } : item) },
    expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: true }))
      .toThrow("STAFF_SCHEDULING_SNAPSHOT_INVALID");
  });

  it("rejects omitted conflict details, duplicate staff, and invalid AI claims", () => {
    const source = buildDemoStaffSchedulingSourceRow({ organizationId: ORG,
      branchId: BRANCH, filters, now: new Date(generatedAt) });
    const conflicted = source.records[1]!;
    expect(() => projectStaffSchedulingSnapshot({ row: { ...source,
      records: [source.records[0]!, { ...conflicted, conflicts: [] }] },
    expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: true }))
      .toThrow("STAFF_SCHEDULING_SNAPSHOT_INVALID");
    expect(() => projectStaffSchedulingSnapshot({ row: { ...source,
      staff_options: [source.staff_options[0]!, source.staff_options[0]!] },
    expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: true }))
      .toThrow("STAFF_SCHEDULING_SNAPSHOT_INVALID");
    expect(() => projectStaffSchedulingSnapshot({ row: { ...source,
      ai_status: "enabled" as "not_used" }, expectedOrganizationId: ORG,
    expectedBranchId: BRANCH, filters, demo: true }))
      .toThrow("STAFF_SCHEDULING_SNAPSHOT_INVALID");
  });

  it("keeps the selected status and staff filter bound to one snapshot", () => {
    const snapshot = buildDemoStaffSchedulingSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters: { ...filters, status: "ready" },
      now: new Date(generatedAt) });
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0]?.status).toBe("draft_ready");
    expect(snapshot.recordTotal).toBe(1);
    expect(snapshot.historyTotal).toBe(2);
  });

  it("strictly parses create/revise inputs and rejects unknown fields", () => {
    const input = parseSubmitStaffScheduleInput(createBody(), KEY);
    expect(input.action).toBe("create");
    expect(input.expectedVersion).toBe(0);
    expect(() => parseSubmitStaffScheduleInput(createBody({ ai_score: 0.9 }), KEY))
      .toThrow(IntegrationError);
    expect(() => parseSubmitStaffScheduleInput(createBody({
      previous_version_id: VERSION, expected_version: 1,
    }), KEY)).toThrow(IntegrationError);
  });

  it("rejects reversed or over-seven-day schedule intervals", () => {
    expect(() => parseSubmitStaffScheduleInput(createBody({
      ends_at: "2026-09-03T00:59:00.000Z",
    }), KEY)).toThrow("結束時間必須晚於開始時間");
    expect(() => parseSubmitStaffScheduleInput(createBody({
      ends_at: "2026-09-11T01:00:00.001Z",
    }), KEY)).toThrow("單一班次不得超過 7 天");
  });

  it("requires a decision matching the exact conflict count", () => {
    expect(decisionInput("publish").expectedConflictCount).toBe(0);
    expect(decisionInput("override").expectedConflictCount).toBe(2);
    expect(() => parseDecideStaffScheduleInput({ action: "decide",
      schedule_version_id: VERSION, expected_schedule_key: SCHEDULE,
      expected_version: 1, expected_content_hash: HASH,
      expected_conflict_count: 1, expected_rule_version_id: RULE,
      decision: "publish", reason: "不應發布" }, KEY, "publish"))
      .toThrow("審核決定與衝突數不一致");
  });

  it("correlates create receipts to tenant, target, version, and conflict state", () => {
    const input = parseSubmitStaffScheduleInput(createBody(), KEY);
    const receipt = { organization_id: ORG, branch_id: BRANCH,
      schedule_key: SCHEDULE, schedule_version_id: VERSION, schedule_version: 1,
      schedule_status: "draft_ready", staff_membership_id: STAFF,
      rule_version_id: RULE, conflict_count: 0, content_hash: HASH,
      committed_at: generatedAt, replayed: false };
    expect(parseSubmitStaffScheduleReceipt(receipt, input, ORG, BRANCH)
      .scheduleVersionId).toBe(VERSION);
    expect(() => parseSubmitStaffScheduleReceipt({ ...receipt,
      schedule_status: "draft_conflicted" }, input, ORG, BRANCH))
      .toThrow("無法與送出內容核對");
    expect(() => parseSubmitStaffScheduleReceipt({ ...receipt, branch_id: STAFF },
      input, ORG, BRANCH)).toThrow("無法與送出內容核對");
  });

  it("correlates independent decisions to exact draft, rule, and next version", () => {
    const input = decisionInput("override");
    const receipt = { organization_id: ORG, branch_id: BRANCH,
      schedule_key: SCHEDULE, decided_version_id: VERSION, expected_version: 1,
      decision_id: DECISION, decision: "override", result_version_id: RESULT,
      result_version: 2, result_status: "published", review_mode: "override",
      conflict_count: 2, rule_version_id: RULE, content_hash: HASH,
      decided_at: generatedAt, replayed: false };
    expect(parseDecideStaffScheduleReceipt(receipt, input, ORG, BRANCH).reviewMode)
      .toBe("override");
    expect(() => parseDecideStaffScheduleReceipt({ ...receipt,
      rule_version_id: STAFF }, input, ORG, BRANCH))
      .toThrow("無法與待審版本核對");
    expect(() => parseDecideStaffScheduleReceipt({ ...receipt,
      result_version: 3 }, input, ORG, BRANCH))
      .toThrow("無法與待審版本核對");
  });

  it("requires HTTP 201 for new receipts and 200 only for exact replay", () => {
    const input = parseSubmitStaffScheduleInput(createBody(), KEY);
    const receipt = { organizationId: ORG, branchId: BRANCH,
      scheduleKey: SCHEDULE, scheduleVersionId: VERSION, scheduleVersion: 1,
      scheduleStatus: "draft_ready", staffMembershipId: STAFF,
      ruleVersionId: RULE, conflictCount: 0, contentHash: HASH,
      committedAt: generatedAt, replayed: false, persisted: true, demo: false };
    const response = { requestId: REQUEST, status: "ok", data: {
      receipt, persisted: true, demo: false }, errors: [] };
    expect(parseSubmitStaffScheduleApiEnvelope(response, input, ORG, BRANCH, 201)
      .scheduleKey).toBe(SCHEDULE);
    expect(() => parseSubmitStaffScheduleApiEnvelope(response, input, ORG, BRANCH, 200))
      .toThrow("HTTP 狀態與操作回執不一致");
  });

  it("rejects decision API envelopes with unknown keys or drifted HTTP status", () => {
    const input = decisionInput("reject");
    const receipt = { organizationId: ORG, branchId: BRANCH,
      scheduleKey: SCHEDULE, decidedVersionId: VERSION, expectedVersion: 1,
      decisionId: DECISION, decision: "reject", resultVersionId: RESULT,
      resultVersion: 2, resultStatus: "voided", reviewMode: "rejected",
      conflictCount: 0, ruleVersionId: RULE, contentHash: HASH,
      decidedAt: generatedAt, replayed: false, persisted: true, demo: false };
    const response = { requestId: REQUEST, status: "ok", data: {
      receipt, persisted: true, demo: false }, errors: [] };
    expect(parseDecideStaffScheduleApiEnvelope(response, input, ORG, BRANCH, 201)
      .resultStatus).toBe("voided");
    expect(() => parseDecideStaffScheduleApiEnvelope({ ...response,
      data: { ...response.data, leaked: true } }, input, ORG, BRANCH, 201))
      .toThrow("回應內容不完整");
    expect(() => parseDecideStaffScheduleApiEnvelope(response, input, ORG, BRANCH, 200))
      .toThrow("HTTP 狀態與操作回執不一致");
  });
});
