import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (
    operation: (requestId: string) => Promise<Response>,
  ) => {
    const requestId = "57900000-0000-4000-8000-000000000099";
    try {
      return await operation(requestId);
    } catch (error) {
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

const organizationId = "57100000-0000-4000-8000-000000000091";
const branchId = "57200000-0000-4000-8000-000000000091";
const clientId = "57300000-0000-4000-8000-000000000091";
const userId = "57400000-0000-4000-8000-000000000091";
const key = "57500000-0000-4000-8000-000000000091";
const requirementId = "57600000-0000-4000-8000-000000000091";
const requirementKey = "57600000-0000-4000-8000-000000000092";
const planId = "57700000-0000-4000-8000-000000000091";
const preparedPlanId = "57700000-0000-4000-8000-000000000092";
const planKey = "57800000-0000-4000-8000-000000000091";
const actor = {
  organizationId, organizationName: "合成機構", branchId, branchName: "合成分支",
  userId, displayName: "合成餐食主管", roles: ["branch_supervisor"],
  scopes: ["clients.read", "attendance.read", "health.read", "meals.read",
    "meals.manage", "meals.confirm"], assuranceLevel: "aal2",
  recentAal2At: "2026-09-02T08:00:00Z", demo: false,
};
const requirementBody = {
  action: "set_requirement", client_id: clientId, previous_version_id: null,
  expected_version: 0, effective_from: "2026-09-02",
  texture_state: "recorded", texture_label: "軟質",
  allergy_status: "none_declared", allergens: [],
  contraindication_status: "unknown", contraindications: [], note: null,
};
const completionBody = {
  action: "complete_plan", plan_version_id: planId, expected_version: 1,
  resolutions: [], actual_portions: [], extra_actual_portions: 0,
  variance_reason: null,
};

function request(method: "POST" | "PATCH", operation?: string) {
  return new Request("https://example.invalid/api/meal-management", {
    method, body: "{}", headers: { "content-type": "application/json",
      "idempotency-key": key, ...(operation ? { "x-meal-operation": operation } : {}) },
  });
}

function requirementReceipt(overrides = {}) {
  return { operation_id: key, action: "set_requirement", entity_type: "requirement",
    entity_id: requirementId, stable_key: requirementKey, version: 1,
    status: "recorded", client_id: clientId, service_date: null, meal_kind: null,
    attendance_count: null, conflict_count: null, planned_portion_total: null,
    actual_portion_total: null, committed_at: "2026-09-02T08:00:00Z",
    replayed: false, ...overrides };
}

describe("Page 57 meal-management API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(requirementBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: requirementReceipt(), error: null });
  });

  it("requires a governed action header before authorization or body parsing", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...actor, demo: true }, "DEMO_READ_ONLY"],
    [{ ...actor, scopes: ["clients.read", "meals.read", "meals.manage"] }, "MEAL_NOT_AUTHORIZED"],
  ])("rejects denied writes before reading sensitive content", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST", "set_requirement"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects stale AAL2 before body parsing", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"), {
      code: "AAL2_REQUIRED", httpStatus: 403,
    }));
    const response = await POST(request("POST", "set_requirement"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds tenant, branch, action, payload, and actor idempotency", async () => {
    const response = await POST(request("POST", "set_requirement"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_meal_management", {
      p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId,
      p_action: "set_requirement",
      p_payload: { client_id: clientId, previous_version_id: null,
        expected_version: 0, effective_from: "2026-09-02",
        texture_state: "recorded", texture_label: "軟質",
        allergy_status: "none_declared", allergens: [],
        contraindication_status: "unknown", contraindications: [], note: null },
      p_idempotency_key: key,
    });
    expect((await response.json()).data).toMatchObject({
      entityId: requirementId, persisted: true, demo: false,
    });
  });

  it("rejects header and body disagreement without calling the database", async () => {
    const response = await POST(request("POST", "save_plan"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("requires confirmation permission before reading a completion body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: actor.scopes.filter((scope) => scope !== "meals.confirm") });
    const response = await PATCH(request("PATCH", "complete_plan"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("correlates a new prepared version and returns replay as HTTP 200", async () => {
    stubs.readJsonObject.mockResolvedValue(completionBody);
    stubs.maybeSingle.mockResolvedValue({ data: {
      operation_id: key, action: "complete_plan", entity_type: "plan",
      entity_id: preparedPlanId, stable_key: planKey, version: 2,
      status: "prepared", client_id: null, service_date: "2026-09-02",
      meal_kind: "lunch", attendance_count: 0, conflict_count: 0,
      planned_portion_total: 0, actual_portion_total: 0,
      committed_at: "2026-09-02T08:00:00Z", replayed: true,
    }, error: null });
    const response = await PATCH(request("PATCH", "complete_plan"));
    expect(response.status).toBe(200);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_meal_management",
      expect.objectContaining({ p_action: "complete_plan", p_payload: {
        plan_version_id: planId, expected_version: 1, resolutions: [],
        actual_portions: [], extra_actual_portions: 0,
        variance_reason: null,
      } }));
  });

  it("fails closed on a mismatched database receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: requirementReceipt({ client_id: planId }),
      error: null });
    const response = await POST(request("POST", "set_requirement"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("MEAL_RECEIPT_INVALID");
  });

  it.each([
    ["42501", 403, "MEAL_NOT_AUTHORIZED"],
    ["40001", 409, "MEAL_VERSION_CONFLICT"],
    ["23505", 409, "MEAL_IDEMPOTENCY_CONFLICT"],
    ["23514", 409, "MEAL_STATE_CONFLICT"],
    ["22023", 400, "INVALID_MEAL_OPERATION"],
    ["XX000", 500, "MEAL_SAVE_FAILED"],
  ])("maps database code %s without leaking details", async (code, status, expected) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request("POST", "set_requirement"));
    expect(response.status).toBe(status);
    expect((await response.json()).errors[0].code).toBe(expected);
  });
});
