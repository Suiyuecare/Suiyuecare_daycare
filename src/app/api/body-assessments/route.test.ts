import { beforeEach, describe, expect, it, vi } from "vitest";
const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(), requireRecentAal2: vi.fn(),
  createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/lib/integrations/http", () => ({ authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject, requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (fn: (id: string) => Promise<Response>) => {
    try { return await fn("19000000-1111-4000-8000-000000000001"); } catch (error) {
      const value = error as { httpStatus?: number; code?: string }; return Response.json({ status: "error", data: null,
        errors: [{ code: value.code }] }, { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));
import { POST } from "./route";
const key = "19000000-1111-4000-8000-000000000001";
const clientId = "19000000-1111-4000-8000-000000000002";
const actor = { organizationId: "19000000-2222-4000-8000-000000000001", branchId: "19000000-3333-4000-8000-000000000001",
  userId: key, demo: false, scopes: ["clients.read", "body_assessments.read", "body_assessments.manage", "body_assessments.sign"] };
const body = { action: "create", client_id: clientId, assessment_key: null, previous_version_id: null, expected_version: 0,
  expected_content_hash: null, observed_at: "2026-09-07T01:00:00.000Z", instrument: "manual_nonstandard_body_observation_v1",
  observations: [{ area: "back", state: "missing", reason: "個案本次不願受評", description: null, disposition: null }], reason: "建立人工身體觀察" };
const receipt = { operation_id: key, organization_id: actor.organizationId, branch_id: actor.branchId, actor_user_id: key,
  client_id: clientId, idempotency_key: key, request_payload: body, assessment_key: key, version_id: clientId,
  version: 1, record_state: "draft", content_hash: "a".repeat(64), committed_at: "2026-09-07T01:01:00.000Z", replayed: false };
function request(operation: string | null = "create") { return new Request("https://example.invalid/api/body-assessments", { method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": key, ...(operation ? { "x-body-assessment-operation": operation } : {}) }, body: "{}" }); }
beforeEach(() => { vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor); stubs.readJsonObject.mockResolvedValue(body);
  stubs.requireRecentAal2.mockResolvedValue(undefined); stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
  stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle }); stubs.maybeSingle.mockResolvedValue({ data: receipt, error: null }); });
describe("Page 19 body assessment route", () => {
  it("rejects undeclared operation before authorization and narrative parsing", async () => {
    expect((await POST(request(null))).status).toBe(400); expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
  });
  it.each([{ ...actor, demo: true }, { ...actor, scopes: ["body_assessments.manage"] }])("denies demo and incomplete scopes before parsing", async (denied) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied); expect((await POST(request())).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });
  it("requires recent AAL2 before reading a sign request", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("AAL2"), { httpStatus: 403 }));
    expect((await POST(request("sign"))).status).toBe(403); expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });
  it("rejects header-body mismatch without touching database", async () => {
    expect((await POST(request("revise"))).status).toBe(400); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("writes through tenant-scoped RPC and only accepts matching receipt", async () => {
    expect((await POST(request())).status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_body_assessment", { p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId, p_payload: body, p_idempotency_key: key });
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, actor_user_id: clientId }, error: null });
    expect((await POST(request())).status).toBe(502);
  });
  it("maps stale version failure without returning database detail", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "40001", message: "hidden narrative" } });
    const response = await POST(request()); expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("hidden narrative");
  });
  it("fails closed when formal Supabase service is absent", async () => {
    stubs.createServerSupabaseClient.mockResolvedValue(null); expect((await POST(request())).status).toBe(503);
  });
});
