import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(), requireRecentAal2: vi.fn(),
  createServerSupabaseClient: vi.fn(), rpc: vi.fn(),
}));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "68000000-0000-4000-8000-000000000010";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({ requestId, status: "error", data: null, errors: [{
        code: typeof value.code === "string" ? value.code : "ERROR",
        message: typeof value.message === "string" ? value.message : "error",
      }] }, { status: typeof value.httpStatus === "number" ? value.httpStatus : 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));
import { GET } from "./route";

const org = "68000000-0000-4000-8000-000000000001";
const branch = "68000000-0000-4000-8000-000000000002";
const user = "68000000-0000-4000-8000-000000000003";
const key = "68000000-0000-4000-8000-000000000004";
const nonce = "68000000-0000-4000-8000-000000000005";
const versionId = "68000000-0000-4000-8000-000000000006";
const chain = "68000000-0000-4000-8000-000000000007";
const actor = { organizationId: org, branchId: branch, userId: user, demo: false,
  scopes: ["announcements.read", "announcements.manage", "announcements.publish"], assuranceLevel: "aal2" };
const proof = { schemaVersion: 1, status: "committed", persisted: true, demo: false,
  organizationId: org, branchId: branch, actorUserId: user, action: "read", idempotencyKey: key, nonce,
  verifiedAt: "2026-09-26T12:00:00.000Z", evidence: {
    announcementKey: chain, versionId, version: 2, sourceVersionId: versionId, releaseVersionId: versionId,
    effectiveAt: "2026-09-25T10:00:00.000Z", recordedAt: "2026-09-26T10:00:00.000Z",
  } };
function request(action = "read", overrides: Record<string, string> = {}, search = "") {
  return new Request(`https://example.invalid/api/staff-announcements/receipt${search}`, {
    headers: { "X-Organization-Id": org, "X-Branch-Id": branch, "Idempotency-Key": key,
      "X-Receipt-Nonce": nonce, "X-Announcement-Action": action, ...overrides },
  });
}

describe("own announcement receipt GET authorization and no-write boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockResolvedValue({ data: structuredClone(proof), error: null });
  });
  it("authenticates before parsing operation headers", async () => {
    stubs.authorizeStaffRequest.mockRejectedValue(Object.assign(new Error("login"), { code: "AUTH_REQUIRED", httpStatus: 401 }));
    expect((await GET(request("invalid"))).status).toBe(401);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("rejects demo with no fabricated receipt", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    expect((await GET(request("invalid"))).status).toBe(403);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["read", []], ["draft", ["announcements.read"]],
    ["publish", ["announcements.read", "announcements.manage"]],
    ["withdraw", ["announcements.read", "announcements.publish"]],
  ])("does not use the key as %s authorization", async (action, scopes) => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, scopes });
    expect((await GET(request(action))).status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it.each(["publish", "withdraw"])("rechecks recent AAL2 for %s before RPC", async (action) => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"), { code: "AAL2_REQUIRED", httpStatus: 403 }));
    expect((await GET(request(action))).status).toBe(403);
    expect(stubs.requireRecentAal2).toHaveBeenCalledExactlyOnceWith(actor);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("does not invent recent-AAL2 requirement for a read receipt", async () => {
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.rpc).toHaveBeenCalledExactlyOnceWith("staff_announcement_operation_receipt", {
      p_organization_id: org, p_branch_id: branch, p_action: "read", p_idempotency_key: key, p_nonce: nonce,
    });
    expect(result.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await result.json()).data.evidence.effectiveAt).toBe(proof.evidence.effectiveAt);
  });
  it.each(["X-Organization-Id", "X-Branch-Id"])("rejects cross-scope %s before any database call", async (header) => {
    expect((await GET(request("read", { [header]: "68000000-0000-4000-8000-000000000099" }))).status).toBe(403);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it.each(["X-Organization-Id", "X-Branch-Id", "Idempotency-Key", "X-Receipt-Nonce"])("bounds and validates %s", async (header) => {
    expect((await GET(request("read", { [header]: "bad" }))).status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("rejects unknown action", async () => {
    expect((await GET(request("delete"))).status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("rejects operation identifiers in query strings", async () => {
    expect((await GET(request("read", {}, `?idempotency_key=${key}`))).status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("never reads a body or accepts a caller's actor identity", async () => {
    const req = request("read", { "X-Actor-Id": "68000000-0000-4000-8000-000000000099" });
    const text = vi.spyOn(req, "text"); const json = vi.spyOn(req, "json");
    expect((await GET(req)).status).toBe(200);
    expect(text).not.toHaveBeenCalled(); expect(json).not.toHaveBeenCalled();
    expect(stubs.rpc.mock.calls[0][1]).not.toHaveProperty("p_actor_user_id");
  });
  it("reports missing evidence as not_found, not as write failure or success", async () => {
    stubs.rpc.mockResolvedValue({ data: { ...proof, status: "not_found", persisted: false, evidence: null }, error: null });
    const result = await GET(request()); expect(result.status).toBe(200);
    expect((await result.json()).data).toMatchObject({ status: "not_found", persisted: false, evidence: null });
    expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it("fails closed with no internal database error disclosure", async () => {
    stubs.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "private secret token" } });
    const result = await GET(request()); expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain("private secret token");
  });
  it("reports retracted authority as 403", async () => {
    stubs.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private" } });
    expect((await GET(request())).status).toBe(403);
  });
  it("reports absent service configuration, without fallback or service-role", async () => {
    stubs.createServerSupabaseClient.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(503);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it.each(["actorUserId", "organizationId", "branchId", "idempotencyKey", "nonce"])("rejects an incorrectly bound successful %s", async (field) => {
    stubs.rpc.mockResolvedValue({ data: { ...proof, [field]: "68000000-0000-4000-8000-000000000099" }, error: null });
    const result = await GET(request()); expect(result.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await result.json())).not.toContain("evidence");
  });
  it("rejects sensitive extra response fields without forwarding them", async () => {
    stubs.rpc.mockResolvedValue({ data: { ...proof, body: "private body" }, error: null });
    const result = await GET(request()); expect(result.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await result.json())).not.toContain("private body");
  });
});
