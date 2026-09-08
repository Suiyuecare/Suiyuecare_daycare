import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn() }));

vi.mock("@/lib/integrations/http", () => ({ authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject, requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "52000000-0000-4000-8000-000000000001";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] },
      { status: value.httpStatus ?? 500 });
    }
  } }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));

import { POST } from "./route";

const ORG = "52010000-0000-4000-8000-000000000001";
const BRANCH = "52020000-0000-4000-8000-000000000001";
const USER = "52030000-0000-4000-8000-000000000001";
const CLIENT = "52040000-0000-4000-8000-000000000001";
const PLAN_KEY = "52050000-0000-4000-8000-000000000001";
const PLAN_ID = "52060000-0000-4000-8000-000000000001";
const AUTH = "52070000-0000-4000-8000-000000000001";
const GOAL = "52080000-0000-4000-8000-000000000001";
const MEASURE = "52090000-0000-4000-8000-000000000001";
const IDEM = "520a0000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);
const actor = { organizationId: ORG, organizationName: "合成機構", branchId: BRANCH,
  branchName: "合成分支", userId: USER, displayName: "合成個管員",
  roles: ["case_manager_social_worker"], scopes: ["clients.read", "care_plans.read",
    "care_plans.write", "care_plans.approve", "care_plans.sign"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false };
const provenance = { schema_version: 1, source_system: "local", capture_method: "staff_entry",
  authority: "facility", workflow: "page52_client_service_plan_v1",
  legal_rule_status: "not_configured", claim_eligibility_status: "blocked_not_configured" };
const body = { action: "create_draft", client_id: CLIENT, plan_key: PLAN_KEY,
  expected_terminal_id: null, expected_terminal_version: 0,
  expected_terminal_payload_hash: null, expected_authorized_care_plan_id: AUTH,
  expected_authorized_content_hash: HASH, effective_from: "2026-09-01",
  effective_to: "2026-12-31", review_due_on: "2026-10-31",
  responsible_user_id: USER, goals: [{ goal_id: GOAL, item_order: 1,
    goal: "維持日間活動參與", target_outcome: "依人工檢討調整支持" }],
  planned_services: [{ measure_id: MEASURE, item_order: 1, goal_id: GOAL,
    measure: "提供結構化活動支持", frequency: "服務日依計畫執行", responsible_user_id: USER }],
  reason: "建立個案服務計畫初稿" };
const receipt = { operation_id: IDEM, action: "create_draft", plan_id: PLAN_ID,
  plan_key: PLAN_KEY, version: 1, previous_version_id: null, status: "draft",
  client_id: CLIENT, authorized_care_plan_id: AUTH, authorized_content_hash: HASH,
  previous_payload_hash: null, payload_hash: "b".repeat(64), committed_at: "2026-09-08T01:00:00Z",
  replayed: false, legal_rule_status: "not_configured",
  claim_eligibility_status: "blocked_not_configured", persisted_payload: {
    schema_version: 1, organization_id: ORG, branch_id: BRANCH, client_id: CLIENT,
    plan_key: PLAN_KEY, version: 1, previous_version_id: null, status: "draft",
    authorized_care_plan_id: AUTH, authorized_content_hash: HASH,
    effective_from: "2026-09-01", effective_to: "2026-12-31", review_due_on: "2026-10-31",
    responsible_user_id: USER, source_system: "local", source_record_id: null,
    source_provenance: provenance, goals: body.goals,
    planned_services: [{ ...body.planned_services[0], responsible_display_name: "合成個管員",
      qualification_status: "active_membership_only" }], reason: body.reason } };

function request(operation?: string) {
  return new Request("https://example.invalid/api/client-service-plans", { method: "POST", body: "{}",
    headers: { "content-type": "application/json", "idempotency-key": IDEM,
      ...(operation ? { "x-client-service-plan-operation": operation } : {}) } });
}

describe("Page 52 client service plan API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined); stubs.readJsonObject.mockResolvedValue(body);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: receipt, error: null });
  });

  it("requires a governed action before authentication or body parsing", async () => {
    const response = await POST(request()); expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it.each([[{ ...actor, demo: true }, "DEMO_READ_ONLY"],
    [{ ...actor, assuranceLevel: "aal1" }, "CLIENT_SERVICE_PLAN_NOT_AUTHORIZED"],
    [{ ...actor, scopes: ["clients.read", "care_plans.read"] }, "CLIENT_SERVICE_PLAN_NOT_AUTHORIZED"]])
  ("rejects demo, AAL1 or incomplete scope before reading care content", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("create_draft")); expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it.each(["approve","sign","void"])("requires recent same-session AAL2 before parsing %s", async (action) => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    const response = await POST(request(action)); expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds tenant scope and sends only structured content without signature evidence", async () => {
    const response = await POST(request("create_draft")); expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_client_service_plan_workflow",
      expect.objectContaining({ p_expected_organization_id: ORG, p_expected_branch_id: BRANCH,
        p_client_id: CLIENT, p_goals: [{ goal_id: GOAL, item_order: 1,
          goal: "維持日間活動參與", target_outcome: "依人工檢討調整支持" }],
        p_idempotency_key: IDEM }));
    const sent = stubs.rpc.mock.calls[0]![1];
    expect(sent).not.toHaveProperty("p_signed_at");
    expect(sent).not.toHaveProperty("p_signature_hash");
    expect((await response.json()).data).toMatchObject({ planId: PLAN_ID,
      legalRuleStatus: "not_configured", claimEligibilityStatus: "blocked_not_configured" });
  });

  it("rejects header/body disagreement without touching the database", async () => {
    const response = await POST(request("revise_draft")); expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("correlates exact replay and returns 200", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, replayed: true }, error: null });
    const response = await POST(request("create_draft")); expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ replayed: true, persisted: true, demo: false });
  });

  it("fails closed when the persisted content differs from the submitted goal", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, persisted_payload: {
      ...receipt.persisted_payload, goals: [{ ...body.goals[0], goal: "不同目標" }] } }, error: null });
    const response = await POST(request("create_draft")); expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("CLIENT_SERVICE_PLAN_RECEIPT_INVALID");
  });

  it.each([["42501", 403, "CLIENT_SERVICE_PLAN_NOT_AUTHORIZED"],
    ["40001", 409, "CLIENT_SERVICE_PLAN_VERSION_CONFLICT"],
    ["23505", 409, "CLIENT_SERVICE_PLAN_IDEMPOTENCY_CONFLICT"],
    ["23514", 409, "CLIENT_SERVICE_PLAN_STATE_CONFLICT"],
    ["23P01", 409, "CLIENT_SERVICE_PLAN_STATE_CONFLICT"],
    ["22023", 400, "INVALID_CLIENT_SERVICE_PLAN_OPERATION"],
    ["XX000", 409, "CLIENT_SERVICE_PLAN_RESULT_UNCERTAIN"]])
  ("maps database code %s without exposing database detail", async (code, status, expected) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code, message: "sensitive database detail" } });
    const response = await POST(request("create_draft")); expect(response.status).toBe(status);
    const payload = await response.json(); expect(payload.errors[0].code).toBe(expected);
    expect(JSON.stringify(payload)).not.toContain("sensitive database detail");
  });
});
