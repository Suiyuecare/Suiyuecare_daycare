import { describe, expect, it } from "vitest";

import { buildDemoClientServicePlanSnapshot } from "./demo";
import { clientServicePlanMutationArgs, parseClientServicePlanApiEnvelope,
  parseClientServicePlanMutation, parseClientServicePlanReceipt } from "./parser";
import { emptyClientServicePlanFilters, parseClientServicePlanFilters } from "./query";

const ORG = "52310000-0000-4000-8000-000000000001";
const BRANCH = "52320000-0000-4000-8000-000000000001";
const CLIENT = "52330000-0000-4000-8000-000000000001";
const USER = "52340000-0000-4000-8000-000000000001";
const PLAN = "52350000-0000-4000-8000-000000000001";
const VERSION = "52360000-0000-4000-8000-000000000001";
const AUTH = "52370000-0000-4000-8000-000000000001";
const GOAL = "52380000-0000-4000-8000-000000000001";
const MEASURE = "52390000-0000-4000-8000-000000000001";
const KEY = "523a0000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);

function body(overrides: Record<string, unknown> = {}) {
  return { action: "create_draft", client_id: CLIENT, plan_key: PLAN,
    expected_terminal_id: null, expected_terminal_version: 0,
    expected_terminal_payload_hash: null, expected_authorized_care_plan_id: AUTH,
    expected_authorized_content_hash: HASH, effective_from: "2026-09-01",
    effective_to: "2026-12-31", review_due_on: "2026-10-31", responsible_user_id: USER,
    goals: [{ goal_id: GOAL, item_order: 1, goal: "維持社區活動參與",
      target_outcome: "由人工檢討參與情形" }],
    planned_services: [{ measure_id: MEASURE, item_order: 1, goal_id: GOAL,
      measure: "提供結構化活動支持", frequency: "服務日依計畫執行", responsible_user_id: USER }],
    reason: "建立個案服務計畫初稿", ...overrides };
}

const provenance = { schema_version: 1, source_system: "local", capture_method: "staff_entry",
  authority: "facility", workflow: "page52_client_service_plan_v1",
  legal_rule_status: "not_configured", claim_eligibility_status: "blocked_not_configured" };

function receipt(overrides: Record<string, unknown> = {}) {
  const value = body();
  return { operation_id: KEY, action: "create_draft", plan_id: VERSION, plan_key: PLAN,
    version: 1, previous_version_id: null, status: "draft", client_id: CLIENT,
    authorized_care_plan_id: AUTH, authorized_content_hash: HASH,
    previous_payload_hash: null, payload_hash: "b".repeat(64),
    persisted_payload: { schema_version: 1, organization_id: ORG, branch_id: BRANCH,
      client_id: CLIENT, plan_key: PLAN, version: 1, previous_version_id: null,
      status: "draft", authorized_care_plan_id: AUTH, authorized_content_hash: HASH,
      effective_from: value.effective_from, effective_to: value.effective_to,
      review_due_on: value.review_due_on, responsible_user_id: USER,
      source_system: "local", source_record_id: null, source_provenance: provenance,
      goals: value.goals, planned_services: [{ ...(value.planned_services as object[])[0],
        responsible_display_name: "合成個管員", qualification_status: "active_membership_only" }],
      reason: value.reason }, committed_at: "2026-09-08T01:00:00Z", replayed: false,
    legal_rule_status: "not_configured", claim_eligibility_status: "blocked_not_configured",
    ...overrides };
}

describe("Page 52 query and mutation contracts", () => {
  it("parses a bounded Taipei-date filter and rejects duplicate parameters", () => {
    expect(parseClientServicePlanFilters(new URLSearchParams(
      `client=${CLIENT}&status=review_due&as_of=2026-09-08&q=SYN`))).toEqual({
      clientId: CLIENT, status: "review_due", asOf: "2026-09-08", query: "SYN" });
    expect(() => parseClientServicePlanFilters(new URLSearchParams("status=draft&status=signed")))
      .toThrow("INVALID_CLIENT_SERVICE_PLAN_FILTERS");
  });

  it("uses Asia/Taipei for the default inspection date", () => {
    expect(emptyClientServicePlanFilters(new Date("2026-09-07T16:05:00Z")).asOf).toBe("2026-09-08");
  });

  it("normalizes a strict structured draft and adapter without evidence fields", () => {
    const input = parseClientServicePlanMutation(body(), KEY);
    expect(input).toMatchObject({ action: "create_draft", planKey: PLAN,
      expectedTerminalVersion: 0, goals: [{ goalId: GOAL, itemOrder: 1 }] });
    const args = clientServicePlanMutationArgs(input);
    expect(args).toMatchObject({ p_action: "create_draft", p_client_id: CLIENT,
      p_expected_authorized_care_plan_id: AUTH, p_idempotency_key: KEY });
    expect(args).not.toHaveProperty("p_signature_evidence");
  });

  it.each([
    { signed_at: "2026-09-08T01:00:00Z" },
    { effective_to: "2026-08-31" },
    { review_due_on: "2027-01-01" },
    { goals: [{ goal_id: GOAL, item_order: 2, goal: "目標", target_outcome: "成果" }] },
    { planned_services: [] },
  ])("rejects invented evidence, invalid periods, gaps and empty measures", (override) => {
    expect(() => parseClientServicePlanMutation(body(override), KEY)).toThrow();
  });

  it("requires exact non-create terminal identity/hash and null content for a state action", () => {
    expect(() => parseClientServicePlanMutation(body({ action: "approve" }), KEY)).toThrow();
    const input = parseClientServicePlanMutation({ action: "approve", client_id: CLIENT,
      plan_key: PLAN, expected_terminal_id: VERSION, expected_terminal_version: 1,
      expected_terminal_payload_hash: "c".repeat(64), expected_authorized_care_plan_id: AUTH,
      expected_authorized_content_hash: HASH, effective_from: null, effective_to: null,
      review_due_on: null, responsible_user_id: null, goals: null, planned_services: null,
      reason: "主管確認目標措施與負責人" }, KEY);
    expect(input).toMatchObject({ action: "approve", expectedTerminalId: VERSION,
      expectedTerminalPayloadHash: "c".repeat(64), goals: null });
  });

  it("accepts an exact database receipt and rejects persisted goal divergence", () => {
    const input = parseClientServicePlanMutation(body(), KEY);
    expect(parseClientServicePlanReceipt(receipt(), input, ORG, BRANCH)).toMatchObject({
      planId: VERSION, status: "draft", persisted: true, demo: false,
      claimEligibilityStatus: "blocked_not_configured" });
    const changed = receipt();
    (changed.persisted_payload as { goals: Array<{ goal: string }> }).goals[0]!.goal = "不同目標";
    expect(() => parseClientServicePlanReceipt(changed, input, ORG, BRANCH)).toThrow();
  });

  it("requires exact API envelope, status code and replay semantics", () => {
    const input = parseClientServicePlanMutation(body(), KEY);
    const database = parseClientServicePlanReceipt(receipt(), input, ORG, BRANCH);
    const envelope = { requestId: "523b0000-0000-4000-8000-000000000001",
      status: "ok", data: database, errors: [] };
    expect(parseClientServicePlanApiEnvelope(envelope, 201, input, ORG, BRANCH).replayed).toBe(false);
    expect(() => parseClientServicePlanApiEnvelope(envelope, 200, input, ORG, BRANCH)).toThrow();
    expect(() => parseClientServicePlanApiEnvelope({ ...envelope, unexpected: true }, 201,
      input, ORG, BRANCH)).toThrow();
  });

  it("keeps demo records synthetic, read-only, claim-blocked and exposes legacy mapping", () => {
    const filters = { clientId: null, status: "all" as const, asOf: "2026-09-08", query: null };
    const snapshot = buildDemoClientServicePlanSnapshot(filters);
    expect(snapshot.demo).toBe(true);
    expect(snapshot.claimEligibilityStatus).toBe("blocked_not_configured");
    expect(snapshot.plans.some((plan) => plan.contentMappingStatus === "needs_mapping" &&
      plan.unmappedContent !== null)).toBe(true);
    expect(snapshot.plans.some((plan) => plan.streamOperationalStatus === "signed_current" &&
      plan.publishedStatus === "signed")).toBe(true);
  });

  it("filters demo heads and keeps complete-set totals consistent", () => {
    const snapshot = buildDemoClientServicePlanSnapshot({ clientId: null,
      status: "needs_mapping", asOf: "2026-09-08", query: null });
    expect(snapshot.plans).toHaveLength(1);
    expect(snapshot.metrics.planTotal).toBe(1);
    expect(snapshot.metrics.needsMappingTotal).toBe(1);
    expect(snapshot.plans[0]!.goals).toEqual([]);
  });
});
