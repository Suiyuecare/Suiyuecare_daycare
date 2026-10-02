import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { buildDemoNursingAssessmentSnapshot } from "@/lib/nursing-assessments/demo";
import { readNursingSnapshot } from "@/lib/nursing-assessments/snapshot-client";
import { nursingReadAuthoritySignature } from "@/lib/nursing-assessments/read-authority";
const mocks = vi.hoisted(() => ({ context: vi.fn(), load: vi.fn(), recent: vi.fn(), configured: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false, hasSupabaseConfiguration: mocks.configured,
  hasSupabaseAdminConfiguration: () => false }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.context, hasRecentAal2: vi.fn() }));
vi.mock("@/lib/nursing-assessments/snapshot", () => ({ loadNursingAssessmentSnapshot: mocks.load }));
vi.mock("@/lib/nursing-assessments/reauth", () => ({ getNursingRecentAal2At: mocks.recent }));
import { GET } from "./route";
const id = (n: number) => `51000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { organizationId: id(80), branchId: id(81), userId: id(13) }, nonce = id(42);
function actor(): TenantContext {
  return { ...scope, organizationName: "合成機構", branchName: "合成分支", displayName: "合成護理",
    roles: ["nurse"], scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage", "nursing_assessments.sign"],
    assuranceLevel: "aal2", recentAal2At: null, demo: false };
}
function snapshot() { return { ...buildDemoNursingAssessmentSnapshot(scope.organizationId, scope.branchId), demo: false }; }
function request(overrides: Record<string, string | undefined> = {}, query = "", method = "GET") {
  return new Request("https://example.invalid/api/nursing-assessments/snapshot" + query, { method, headers: {
    "x-organization-id": scope.organizationId, "x-branch-id": scope.branchId, "x-nursing-read-nonce": nonce,
    ...Object.fromEntries(Object.entries(overrides).filter((entry): entry is [string, string] => entry[1] !== undefined)),
  } });
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-27T11:00:00.000Z"));
  vi.resetAllMocks(); mocks.configured.mockReturnValue(true); mocks.context.mockResolvedValue(actor());
  mocks.load.mockResolvedValue(snapshot()); mocks.recent.mockResolvedValue(null); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("authorized audited nursing recovery GET", () => {
  it("uses actual staff authorization and refuses no service/no session before snapshot/evidence", async () => {
    mocks.configured.mockReturnValue(false); expect((await GET(request())).status).toBe(503); expect(mocks.context).not.toHaveBeenCalled();
    mocks.configured.mockReturnValue(true); mocks.context.mockResolvedValue(null); expect((await GET(request())).status).toBe(401);
    expect(mocks.context).toHaveBeenCalledWith("staff"); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.recent).not.toHaveBeenCalled();
  });
  it.each([{ demo: true }, { assuranceLevel: "aal1" }, { scopes: [] }, { scopes: ["clients.read"] },
    { scopes: ["nursing_assessments.read"] }])("refuses denied read authority before RPC %#", async (change) => {
    mocks.context.mockResolvedValue({ ...actor(), ...change }); const response = await GET(request());
    expect(response.status).toBe(403); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.recent).not.toHaveBeenCalled();
  });
  it.each([{ "x-nursing-read-nonce": "" }, { "x-nursing-read-nonce": "bad" },
    { "x-nursing-read-nonce": nonce + "," + nonce }, { "x-branch-id": "" }, { "x-organization-id": "bad" }])("rejects malformed request before RPC %#", async (headers) => {
    expect((await GET(request(headers))).status).toBe(400); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.recent).not.toHaveBeenCalled();
  });
  it.each(["?actor=other", "?idempotency_key=secret", "?status=draft&status=signed"])("accepts no query authority or filter %s", async (query) => {
    expect((await GET(request({}, query))).status).toBe(400); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.recent).not.toHaveBeenCalled();
  });
  it("rejects invocation with a write method before RPC", async () => {
    expect((await GET(request({}, "", "POST"))).status).toBe(400); expect(mocks.load).not.toHaveBeenCalled();
  });
  it.each([{ "idempotency-key": nonce }, { "x-idempotency-key": nonce }, { "content-length": "1" },
    { "content-length": "bad" }, { "transfer-encoding": "chunked" }])("admits no write key/body declaration %#", async (headers) => {
    expect((await GET(request(headers))).status).toBe(400); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.recent).not.toHaveBeenCalled();
  });
  it.each(["x-organization-id", "x-branch-id"])("rejects cross-scope %s before RPC", async (header) => {
    expect((await GET(request({ [header]: nonce }))).status).toBe(403); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.recent).not.toHaveBeenCalled();
  });
  it("allows supervisor read history with no invented nursing manage/sign privilege", async () => {
    const context: TenantContext = { ...actor(), roles: ["branch_supervisor"],
      scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage", "nursing_assessments.sign"] };
    mocks.context.mockResolvedValue(context); const response = await GET(request()); expect(response.status).toBe(200);
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(context); expect(mocks.recent).not.toHaveBeenCalled();
    const body = await response.json(); expect(body.data.capabilities).toEqual({ canManage: false, canSign: false, hasRecentAal2: false });
    expect(body.data.snapshot.clients).toHaveLength(2); expect(body.data.authoritySignature).toBe(nursingReadAuthoritySignature(context));
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("reads drafts without sign evidence when sign scope absent", async () => {
    const context = { ...actor(), scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage"] };
    mocks.context.mockResolvedValue(context); const response = await GET(request()); expect(response.status).toBe(200);
    expect((await response.json()).data.capabilities).toEqual({ canManage: true, canSign: false, hasRecentAal2: false });
    expect(mocks.recent).not.toHaveBeenCalled();
  });
  it("binds exact actual recent evidence to full context signature, not AAL2 or browser time", async () => {
    const recentAal2At = new Date(Date.now() - 60000).toISOString(), context = { ...actor(), recentAal2At };
    mocks.context.mockResolvedValue(context); mocks.recent.mockResolvedValue(recentAal2At);
    const response = await GET(request()); expect(response.status).toBe(200); const data = (await response.json()).data;
    expect(data).toMatchObject({ schemaVersion: 1, actorUserId: scope.userId, nonce, demo: false,
      capabilities: { canManage: true, canSign: true, hasRecentAal2: true } });
    expect(data.authoritySignature).toBe(nursingReadAuthoritySignature(context)); expect(JSON.parse(data.authoritySignature)[4]).toBe(recentAal2At);
    expect(mocks.recent).toHaveBeenCalledExactlyOnceWith(context);
  });
  it.each(["context missing", "evidence missing", "different proof", "future", "stale"])("fails closed on inconsistent recency %s", async (kind) => {
    const recentAt = new Date(Date.now() - 60000).toISOString();
    const contextAt = kind === "context missing" ? null : kind === "future" ? new Date(Date.now() + 1).toISOString()
      : kind === "stale" ? new Date(Date.now() - 900001).toISOString() : recentAt;
    mocks.context.mockResolvedValue({ ...actor(), recentAal2At: contextAt });
    mocks.recent.mockResolvedValue(kind === "evidence missing" ? null : kind === "different proof" ? new Date(Date.now() - 120000).toISOString()
      : kind === "future" || kind === "stale" ? contextAt : recentAt);
    const response = await GET(request()); expect(response.status).toBe(503); expect((await response.json()).data).toBeNull();
  });
  it.each([{ branchId: nonce }, { demo: true }, { privateNote: "CLINICAL_SECRET" }, { staleAfter: "2099-01-01T00:00:00Z" }])("reprojects and redacts malformed backend output %#", async (change) => {
    mocks.load.mockResolvedValue({ ...snapshot(), ...change }); const response = await GET(request()); expect(response.status).toBe(503);
    const body = await response.json(); expect(body.data).toBeNull(); expect(JSON.stringify(body)).not.toContain("CLINICAL_SECRET");
  });
  it("refuses future generation despite the legacy projector's 60-second allowance", async () => {
    const generatedAt = new Date(Date.now() + 30000).toISOString();
    mocks.load.mockResolvedValue({ ...snapshot(), generatedAt, staleAfter: new Date(Date.parse(generatedAt) + 300000).toISOString() });
    expect((await GET(request())).status).toBe(503);
  });
  it.each(["snapshot", "evidence"])("redacts rejected %s without empty/demo fallback", async (which) => {
    (which === "snapshot" ? mocks.load : mocks.recent).mockRejectedValue(new Error("CLINICAL_SECRET"));
    const response = await GET(request()); expect(response.status).toBe(503);
    const body = await response.json(); expect(body.data).toBeNull(); expect(JSON.stringify(body)).not.toContain("CLINICAL_SECRET");
  });
  it("actual GET route and transport retain the same actor nonce with no mutation body", async () => {
    const fetch = vi.fn(async (url: unknown, init: RequestInit) => GET(new Request("https://example.invalid" + url, init))); vi.stubGlobal("fetch", fetch);
    const result = await readNursingSnapshot(scope); expect(result.snapshot.demo).toBe(false); expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![1].method).toBe("GET"); expect(fetch.mock.calls[0]![1].body).toBeUndefined(); expect(mocks.load).toHaveBeenCalledOnce();
  });
});
