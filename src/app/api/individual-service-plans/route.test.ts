import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  requireRecentAal2: vi.fn(),
  readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "f1111111-1111-4111-8111-111111111111";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({ requestId, status: "error", data: null, errors: [{ code: typeof value.code === "string" ? value.code : "ERROR", message: typeof value.message === "string" ? value.message : "error" }] }, {
        status: typeof value.httpStatus === "number" ? value.httpStatus : 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));

import { POST } from "./route";

const org = "a1111111-1111-4111-8111-111111111111";
const branch = "b1111111-1111-4111-8111-111111111111";
const client = "c1111111-1111-4111-8111-111111111111";
const responsible = "d1111111-1111-4111-8111-111111111111";
const key = "e1111111-1111-4111-8111-111111111111";
const actor = {
  organizationId: org, organizationName: "機構", branchId: branch, branchName: "分支",
  userId: responsible, displayName: "護理師", roles: ["nurse"],
  scopes: ["clients.read", "care_plans.read", "care_plans.write", "care_plans.sign"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false,
};
const body = {
  client_id: client, plan_month: "2026-09", previous_plan_id: null, correction_reason: null,
  items: [{ goal: "目標", activity: "活動", frequency: "每週", responsible_user_id: responsible, progress_status: "not_started", progress_note: null }],
};
function request() {
  return new Request("https://example.invalid/api/individual-service-plans", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: "{}" });
}

describe("individual service plan API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(body);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockResolvedValue({ data: [{ plan_id: "f2222222-2222-4222-8222-222222222222", client_id: client, plan_month: "2026-09-01", plan_version: 1, previous_plan_id: null, signed_at: "2026-09-01T01:00:00Z", replayed: false }], error: null });
  });

  it("rejects demo before body parsing and returns a private no-store 403", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    const response = await POST(request());
    const value = await response.json();
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(value.errors[0].code).toBe("DEMO_READ_ONLY");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects missing sign permission before AAL2 and body parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, scopes: ["clients.read", "care_plans.read", "care_plans.write"] });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent AAL2 before body parsing", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("重新驗證"), { code: "AAL2_REQUIRED", httpStatus: 403 }));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("returns an exact persisted receipt and binds tenant scope from the actor", async () => {
    const response = await POST(request());
    const value = await response.json();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(value.data).toMatchObject({ clientId: client, planMonth: "2026-09", planVersion: 1, persisted: true, demo: false });
    expect(stubs.rpc).toHaveBeenCalledWith("record_individual_service_plan", expect.objectContaining({ p_expected_organization_id: org, p_expected_branch_id: branch, p_idempotency_key: key }));
  });

  it("fails closed when the database receipt exposes an unexpected field", async () => {
    stubs.rpc.mockResolvedValue({ data: [{ plan_id: "f2222222-2222-4222-8222-222222222222", client_id: client, plan_month: "2026-09-01", plan_version: 1, previous_plan_id: null, signed_at: "2026-09-01T01:00:00Z", replayed: false, content_hash: "secret" }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
