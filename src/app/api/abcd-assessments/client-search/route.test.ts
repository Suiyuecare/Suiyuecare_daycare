import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ getTenantContext: vi.fn(),
  authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: stubs.getTenantContext }));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest, readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "21820000-0000-4000-8000-000000000001";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] },
      { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));

import { POST } from "./route";

const organizationId = "21800000-0000-4000-8000-000000000001";
const branchId = "21800000-0000-4000-8000-000000000002";
const clientId = "21810000-0000-4000-8000-000000000001";
const actor = { organizationId, branchId, scopes: ["clients.read", "abcd_assessments.read"],
  assuranceLevel: "aal2", demo: false };
const data = { organization_id: organizationId, branch_id: branchId, has_more: false,
  clients: [{ client_id: clientId, display_name: "合成個案甲", client_code: "SYN-01",
    client_code_truncated: false }] };
const request = () => new Request("https://example.invalid/api/abcd-assessments/client-search",
  { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });

describe("ABCD assessment client search API", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.getTenantContext.mockResolvedValue(actor);
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.readJsonObject.mockResolvedValue({ query: "合成" });
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockResolvedValue({ data, error: null });
  });

  it("checks active staff and both read scopes before reading search text", async () => {
    stubs.getTenantContext.mockResolvedValueOnce(null);
    const anonymous = await POST(request()); expect(anonymous.status).toBe(401);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, scopes: ["clients.read"] });
    const denied = await POST(request()); expect(denied.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    const demo = await POST(request()); expect(demo.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("lets the guarded search RPC evaluate a Google AAL1 list without a null-client preflight", async () => {
    const routineActor = { ...actor, assuranceLevel: "aal1" };
    stubs.getTenantContext.mockResolvedValue(routineActor);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.rpc).toHaveBeenCalledWith("abcd_assessment_client_search", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId, p_query: "合成",
    });
  });

  it("rejects an AAL1 account without both read scopes before touching the query", async () => {
    stubs.getTenantContext.mockResolvedValue({ ...actor, assuranceLevel: "aal1",
      scopes: ["clients.read"] });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("uses scoped database authorization and returns a private bounded result", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(stubs.rpc).toHaveBeenCalledWith("abcd_assessment_client_search", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId, p_query: "合成",
    });
    expect((await response.json()).data).toMatchObject({ organizationId, branchId,
      clients: [{ clientId, displayName: "合成個案甲", clientCode: "SYN-01" }] });
  });

  it.each(["", "A", "a".repeat(65), "a\nb", "ab%".repeat(30)])
  ("rejects invalid query %s before a database call", async (query) => {
    stubs.readJsonObject.mockResolvedValue({ query });
    const response = await POST(request()); expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it.each([["42501", 403, "ABCD_CLIENT_SEARCH_NOT_AUTHORIZED"],
    ["P4290", 429, "ABCD_CLIENT_SEARCH_RATE_LIMITED"],
    ["22023", 400, "INVALID_ABCD_CLIENT_SEARCH"],
    ["XX000", 503, "ABCD_CLIENT_SEARCH_UNAVAILABLE"]])
  ("maps database %s to safe %s without provider details", async (code, status, publicCode) => {
    stubs.rpc.mockResolvedValue({ data: null, error: { code, message: "private SQL detail" } });
    const response = await POST(request()); expect(response.status).toBe(status);
    const body = await response.json(); expect(body.errors[0].code).toBe(publicCode);
    expect(JSON.stringify(body)).not.toContain("private SQL detail");
  });

  it("rejects a cross-branch or oversized database result", async () => {
    stubs.rpc.mockResolvedValue({ data: { ...data, branch_id: organizationId }, error: null });
    const branch = await POST(request()); expect(branch.status).toBe(502);
    stubs.rpc.mockResolvedValue({ data: { ...data, clients: Array.from({ length: 21 },
      (_, index) => ({ ...data.clients[0], client_id: `21810000-0000-4000-8000-${String(index).padStart(12, "0")}` })) },
    error: null });
    const oversized = await POST(request()); expect(oversized.status).toBe(502);
  });
});
