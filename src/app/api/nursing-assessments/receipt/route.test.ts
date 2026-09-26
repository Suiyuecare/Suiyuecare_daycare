import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { buildDemoNursingAssessmentSnapshot } from "@/lib/nursing-assessments/demo";
import { readNursingOperationReceipt } from "@/lib/nursing-assessments/operation-receipt-client";
const mocks = vi.hoisted(() => ({ context: vi.fn(), configured: vi.fn(), server: vi.fn(), rpc: vi.fn(), recent: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false, hasSupabaseConfiguration: mocks.configured, hasSupabaseAdminConfiguration: () => false }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.context, hasRecentAal2: mocks.recent }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.server }));
vi.mock("@/lib/nursing-assessments/reauth", () => ({ getNursingRecentAal2At: mocks.recent, requireNursingRecentAal2: mocks.recent }));
import { GET } from "./route";
const id = (n: number) => `51000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { organizationId: id(80), branchId: id(81), userId: id(13) }, clientId = id(1), key = id(40), nonce = id(41);
function actor(): TenantContext { return { ...scope, organizationName: "合成機構", branchName: "合成分支", displayName: "合成主管",
  roles: ["branch_supervisor"], scopes: ["clients.read", "nursing_assessments.read"], assuranceLevel: "aal2", recentAal2At: null, demo: false }; }
function fixture() {
  const source = buildDemoNursingAssessmentSnapshot(scope.organizationId, scope.branchId).clients[0]!.versions[0]!;
  const request = { action: "create_draft" as const, clientId, content: source.content };
  const data = { schemaVersion: 1, organizationId: scope.organizationId, branchId: scope.branchId, actorUserId: scope.userId,
    clientId, action: request.action, idempotencyKey: key, nonce, verifiedAt: new Date().toISOString(), status: "committed",
    persisted: true, demo: false, receipt: { operationId: id(90), organizationId: scope.organizationId, branchId: scope.branchId,
      actorUserId: scope.userId, idempotencyKey: key, request, result: { ...source, versionId: id(91) }, replayed: false, persisted: true, demo: false } };
  return { request, data };
}
function request(headers: Record<string, string | undefined> = {}, query = "", method = "GET") {
  return new Request("https://example.invalid/api/nursing-assessments/receipt" + query, { method, headers: {
    "x-organization-id": scope.organizationId, "x-branch-id": scope.branchId, "x-client-id": clientId,
    "x-nursing-operation": "create_draft", "idempotency-key": key, "x-nursing-receipt-nonce": nonce,
    ...Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined)) } });
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-27T11:00:00Z")); vi.resetAllMocks();
  mocks.configured.mockReturnValue(true); mocks.context.mockResolvedValue(actor()); mocks.server.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: fixture().data, error: null }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe("authorized read-only original nursing operation GET", () => {
  it("uses real authorization then own-actor bound RPC only, with no write role or new MFA", async () => {
    const response = await GET(request()); expect(response.status).toBe(200);
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith("staff"); expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("nursing_assessment_operation_receipt", {
      p_organization_id: scope.organizationId, p_branch_id: scope.branchId, p_client_id: clientId,
      p_action: "create_draft", p_idempotency_key: key, p_nonce: nonce });
    expect(mocks.recent).not.toHaveBeenCalled(); expect((await response.json()).data).toEqual(fixture().data);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("refuses missing service/session before RPC", async () => {
    mocks.configured.mockReturnValue(false); expect((await GET(request())).status).toBe(503); expect(mocks.context).not.toHaveBeenCalled();
    mocks.configured.mockReturnValue(true); mocks.context.mockResolvedValue(null); expect((await GET(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ demo: true }, { assuranceLevel: "aal1" }, { scopes: [] }, { scopes: ["clients.read"] }, { scopes: ["nursing_assessments.read"] }])("denies missing read authority %#", async (change) => {
    mocks.context.mockResolvedValue({ ...actor(), ...change }); expect((await GET(request())).status).toBe(403);
    expect(mocks.server).not.toHaveBeenCalled(); expect(mocks.recent).not.toHaveBeenCalled();
  });
  it.each(["x-organization-id", "x-branch-id", "x-client-id", "idempotency-key", "x-nursing-receipt-nonce"])("rejects malformed %s", async (header) => {
    expect((await GET(request({ [header]: "bad" }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["", "delete", "create_draft,sign"])("rejects invalid operation %s", async (action) => {
    expect((await GET(request({ "x-nursing-operation": action }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["?actor=other", "?idempotency_key=secret", "?nonce=secret"])("accepts no query %s", async (query) => {
    expect((await GET(request({}, query))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ "x-idempotency-key": key }, { "transfer-encoding": "chunked" }, { "content-length": "1" },
    { "content-length": "bad" }, { "content-length": "00" }])("rejects alternate key/body declarations %#", async (headers) => {
    expect((await GET(request(headers))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects wrong method or actual body before RPC", async () => {
    expect((await GET(request({}, "", "POST"))).status).toBe(400);
    const forged = request(); Object.defineProperty(forged, "body", { value: new ReadableStream() });
    expect((await GET(forged)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["x-organization-id", "x-branch-id"])("rejects cross scope %s before RPC", async (header) => {
    expect((await GET(request({ [header]: id(999) }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not use spoofed actor headers as lookup authority", async () => {
    expect((await GET(request({ "x-actor-user-id": id(999) }))).status).toBe(200);
    expect(mocks.rpc.mock.calls[0]![1]).not.toHaveProperty("p_actor_user_id");
    const data = fixture().data; data.actorUserId = id(999); mocks.rpc.mockResolvedValue({ data, error: null });
    expect((await GET(request())).status).toBe(503);
  });
  it.each(["sign", "correct"])("read of old %s requires no manage/sign or fresh MFA", async (action) => {
    const data = { ...fixture().data, status: "not_found", persisted: false, receipt: null, action };
    mocks.rpc.mockResolvedValue({ data, error: null }); const response = await GET(request({ "x-nursing-operation": action }));
    expect(response.status).toBe(200); expect((await response.json()).data).toEqual(data); expect(mocks.recent).not.toHaveBeenCalled();
  });
  it.each([["42501", 403], ["22023", 400], ["23505", 503], ["XX000", 503]])("redacts database %s to HTTP %d", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "CLINICAL_SECRET", details: "SECRET", hint: "SECRET" } });
    const response = await GET(request()); expect(response.status).toBe(status); const text = await response.text();
    expect(text).not.toContain("SECRET"); expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each(["missing server", "server rejects", "RPC rejects", "malformed result"])("generic safe unavailable for %s", async (kind) => {
    if (kind === "missing server") mocks.server.mockResolvedValue(null);
    if (kind === "server rejects") mocks.server.mockRejectedValue(new Error("CLINICAL_SECRET"));
    if (kind === "RPC rejects") mocks.rpc.mockRejectedValue(new Error("CLINICAL_SECRET"));
    if (kind === "malformed result") mocks.rpc.mockResolvedValue({ data: { secret: "CLINICAL_SECRET" }, error: null });
    const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("SECRET");
  });
  it.each([null, undefined, {}, { data: null }, { error: null }])("redacts malformed RPC transport result %#", async (value) => {
    mocks.rpc.mockResolvedValue(value); const response = await GET(request());
    expect(response.status).toBe(503); expect((await response.json()).data).toBeNull();
  });
  it.each([{ nonce: id(999) }, { clientId: id(999) }, { demo: true }, { action: "sign" }, { persisted: false },
    { verifiedAt: "2026-09-27T11:01:00.001Z" }, { verifiedAt: "2026-09-27T10:58:59.999Z" }])("revalidates entire DB proof %#", async (change) => {
    mocks.rpc.mockResolvedValue({ data: { ...fixture().data, ...change }, error: null });
    expect((await GET(request())).status).toBe(503);
  });
  it("real route plus manual client match complete original request and bound nonce", async () => {
    const input = fixture(); vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => GET(new Request("https://example.invalid" + url, init))));
    expect((await readNursingOperationReceipt(scope, { key, nonce, request: input.request })).status).toBe("committed");
    expect(mocks.rpc).toHaveBeenCalledOnce(); expect(mocks.recent).not.toHaveBeenCalled();
  });
});
