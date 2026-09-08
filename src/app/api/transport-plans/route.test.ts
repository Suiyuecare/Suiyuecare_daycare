import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn(),
  maybeSingle: vi.fn() }));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "47990000-0000-4000-8000-000000000001";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] },
      { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { PATCH, POST } from "./route";

const organizationId = "47910000-0000-4000-8000-000000000001";
const branchId = "47920000-0000-4000-8000-000000000001";
const userId = "47930000-0000-4000-8000-000000000001";
const key = "47940000-0000-4000-8000-000000000001";
const tripId = "47950000-0000-4000-8000-000000000001";
const tripKey = "47960000-0000-4000-8000-000000000001";
const driverId = "47970000-0000-4000-8000-000000000001";
const clientId = "47980000-0000-4000-8000-000000000001";
const ruleId = "47990000-0000-4000-8000-000000000002";
const hash = "b".repeat(64);
const actor = { organizationId, organizationName: "合成機構", branchId,
  branchName: "合成分支", userId, displayName: "合成交通主管",
  roles: ["branch_supervisor"], scopes: ["clients.read", "transport_plans.read",
    "transport_plans.manage", "transport_plans.approve", "transport_plans.override"],
  assuranceLevel: "aal2", recentAal2At: "2026-09-07T08:00:00Z", demo: false };
const saveBody = { action: "save_trip", mode: "create", trip_key: null,
  previous_version_id: null, expected_version: 0, expected_content_hash: null,
  direction: "pickup", service_date: "2026-09-07",
  starts_at: "2026-09-07T08:00:00+08:00", ends_at: "2026-09-07T09:00:00+08:00",
  vehicle_code: "VAN-A", driver_membership_id: driverId,
  pickup_label: "合成集合點", dropoff_label: "合成中心",
  passengers: [{ client_id: clientId, pickup_label: "合成住址", dropoff_label: "合成中心" }],
  revision_reason: "依人工規則建立合成趟次" };
const saveReceipt = { operation_id: key, action: "save_trip", decision: null,
  trip_version_id: tripId, trip_key: tripKey, version: 1, status: "draft_ready",
  conflict_count: 0, content_hash: hash, rule_version_id: ruleId,
  committed_at: "2026-09-07T08:00:00Z", replayed: false };

function request(method: "POST" | "PATCH", operation?: string) {
  return new Request("https://example.invalid/api/transport-plans", { method, body: "{}",
    headers: { "content-type": "application/json", "idempotency-key": key,
      ...(operation ? { "x-transport-plan-operation": operation } : {}) } });
}

describe("Page 47 transport-plan API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(saveBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: saveReceipt, error: null });
  });

  it("requires the governed header before authority or content parsing", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...actor, demo: true }, "DEMO_READ_ONLY"],
    [{ ...actor, scopes: ["clients.read", "transport_plans.read"] },
      "TRANSPORT_PLAN_NOT_AUTHORIZED"],
  ])("rejects denied writes before reading location content", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST", "save_trip"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent AAL2 before reading the trip body", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    const response = await POST(request("POST", "save_trip"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds tenant, branch, action, payload and idempotency", async () => {
    const response = await POST(request("POST", "save_trip"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_transport_trip_plan", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_action: "save_trip", p_payload: expect.objectContaining({
        mode: "create", vehicle_code: "VAN-A", driver_membership_id: driverId,
        passengers: [{ client_id: clientId, pickup_label: "合成住址",
          dropoff_label: "合成中心" }],
      }), p_idempotency_key: key,
    });
    expect((await response.json()).data).toMatchObject({
      tripVersionId: tripId, persisted: true, demo: false,
    });
  });

  it("rejects header and body disagreement without touching the database", async () => {
    const response = await POST(request("POST", "publish_trip"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("requires override permission before reading conflict details", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: actor.scopes.filter((scope) => scope !== "transport_plans.override") });
    const response = await PATCH(request("PATCH", "override_trip"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("correlates one independent override and returns replay as 200", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "decide_trip", decision: "override",
      trip_version_id: tripId, expected_trip_key: tripKey, expected_version: 1,
      expected_content_hash: hash, expected_conflict_count: 2,
      expected_rule_version_id: ruleId, reason: "逐項核對衝突後限此趟次發布" });
    stubs.maybeSingle.mockResolvedValue({ data: { ...saveReceipt,
      action: "decide_trip", decision: "override", status: "published",
      conflict_count: 2, replayed: true }, error: null });
    const response = await PATCH(request("PATCH", "override_trip"));
    expect(response.status).toBe(200);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_transport_trip_plan",
      expect.objectContaining({ p_action: "decide_trip", p_payload:
        expect.objectContaining({ decision: "override", expected_conflict_count: 2 }) }));
  });

  it("fails closed on a mismatched database receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: { ...saveReceipt, version: 2 }, error: null });
    const response = await POST(request("POST", "save_trip"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("TRANSPORT_PLAN_RECEIPT_INVALID");
  });

  it.each([
    ["42501", 403, "TRANSPORT_PLAN_NOT_AUTHORIZED"],
    ["55000", 503, "TRANSPORT_PLAN_RULES_NOT_CONFIGURED"],
    ["40001", 409, "TRANSPORT_PLAN_VERSION_CONFLICT"],
    ["23505", 409, "TRANSPORT_PLAN_IDEMPOTENCY_CONFLICT"],
    ["23514", 409, "TRANSPORT_PLAN_STATE_CONFLICT"],
    ["22023", 400, "INVALID_TRANSPORT_PLAN_OPERATION"],
    ["XX000", 409, "TRANSPORT_PLAN_RESULT_UNCERTAIN"],
  ])("maps database code %s without leaking details", async (code, status, expected) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request("POST", "save_trip"));
    expect(response.status).toBe(status);
    expect((await response.json()).errors[0].code).toBe(expected);
  });
});
