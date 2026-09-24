import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), client: vi.fn(), rpc: vi.fn(), abort: vi.fn(), single: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.actor }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { GET } from "./route";
const clientId = "c1600000-0000-4000-8000-000000000001";
const documentId = "d1600000-0000-4000-8000-000000000001";
const actor = { organizationId: "a1600000-0000-4000-8000-000000000001", branchId: "b1600000-0000-4000-8000-000000000001", scopes: ["clients.read", "clients.manage", "clients.demographics.read", "health.read"], demo: false };
const url = "https://example.invalid/api/client-documents/history";
const row = { id: documentId, category: "identity_front", version: 1, scanStatus: "clean", documentLabel: "合成附件", provider: null, documentDate: null, validUntil: null, periodFrom: null, periodTo: null, createdAt: "2026-09-14T00:00:00Z", reviewRevision: 0, disposition: "unreviewed", reviewReason: null, reviewedAt: null, canDownload: true, canManage: true, historicalOnly: false };
function page() { return { organizationId: actor.organizationId, branchId: actor.branchId, clientId, category: null, snapshotId: "e1600000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString(), rows: [row], nextCursor: null, pageSize: 50 }; }
function result(payload: unknown) { mocks.single.mockResolvedValue({ data: { payload }, error: null }); }
function request(query = `client=${clientId}`) { return new Request(`${url}?${query}`); }
beforeEach(() => { vi.resetAllMocks(); mocks.actor.mockResolvedValue(actor); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockReturnValue({ abortSignal: mocks.abort }); mocks.abort.mockReturnValue({ maybeSingle: mocks.single }); result(page()); });
afterEach(() => vi.useRealTimers());

describe("scoped document history API", () => {
  it("authenticates before query parsing and sends private structured errors", async () => {
    mocks.actor.mockResolvedValue(null); const response = await GET(request("invalid=anything"));
    expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect((await response.json()).requestId).toEqual(expect.any(String)); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...actor, demo: true }, { ...actor, branchId: null }, { ...actor, scopes: [] }])("rejects demo or missing context before RPC", async (value) => {
    mocks.actor.mockResolvedValue(value); expect((await GET(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([`client=${clientId}&client=${clientId}`, `client=${clientId}&organizationId=${actor.organizationId}`, `client=${clientId}&limit=101`, `client=${clientId}&cursor=not-a-uuid`, `client=${clientId}&category=unknown`])("rejects strict malformed query %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("checks requested category scope before reading business data", async () => {
    expect((await GET(request(`client=${clientId}&category=medication_plan`))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses actor scope only and bounded same-session metadata RPC", async () => {
    const response = await GET(request()); expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("client_document_history", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: clientId, p_category: null, p_cursor: null, p_limit: 50 });
    expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal)); expect((await response.json()).data.snapshot.rows).toHaveLength(1);
  });
  it("forwards opaque cursor unchanged with exact client and filter", async () => {
    const cursor = "f1600000-0000-4000-8000-000000000001"; result({ ...page(), category: "identity_front", pageSize: 25 });
    expect((await GET(request(`client=${clientId}&category=identity_front&cursor=${cursor}&limit=25`))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("client_document_history", expect.objectContaining({ p_cursor: cursor, p_category: "identity_front", p_limit: 25 }));
  });
  it.each([["42501", 403], ["22023", 400], ["55000", 409], ["54000", 409], ["57014", 503]])("maps %s without sensitive SQL error text", async (code, status) => {
    mocks.single.mockResolvedValue({ data: null, error: { code, message: "private-health-data" } }); const response = await GET(request());
    expect(response.status).toBe(status); expect(await response.text()).not.toContain("private-health-data");
  });
  it.each([{ clientId: documentId }, { organizationId: clientId }, { branchId: clientId }, { category: "health_exam" }, { pageSize: 25 }, { nextCursor: "bad" }, { objectPath: "secret" }])("rejects malformed or mismatched scoped response", async (bad) => {
    result({ ...page(), ...bad }); const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  });
  it("rejects repeated identity and overbroad category grants from a stale RPC", async () => {
    result({ ...page(), rows: [row, row] }); expect((await GET(request())).status).toBe(503);
    result({ ...page(), rows: [{ ...row, category: "medication_plan" }] }); expect((await GET(request())).status).toBe(403);
    mocks.actor.mockResolvedValue({ ...actor, scopes: ["clients.read", "clients.manage"] }); result(page()); expect((await GET(request())).status).toBe(403);
  });
  it("does not claim write permission from overbroad response flags", async () => {
    result({ ...page(), rows: [{ ...row, category: "health_exam" }] }); expect((await GET(request())).status).toBe(403);
  });
  it("preserves clean inactive attachments as explicitly historical download evidence", async () => {
    result({ ...page(), rows: [{ ...row, disposition: "inactive", historicalOnly: true, reviewRevision: 1, reviewReason: "合成舊附件停用", reviewedAt: new Date().toISOString() }] });
    const response = await GET(request()); expect(response.status).toBe(200);
    expect((await response.json()).data.snapshot.rows[0]).toMatchObject({ canDownload: true, historicalOnly: true, disposition: "inactive" });
  });
  it("refuses cursor loops, phantom next pages and nonclean download flags", async () => {
    const cursor = "f1600000-0000-4000-8000-000000000001";
    result({ ...page(), pageSize: 1, nextCursor: cursor });
    expect((await GET(request(`client=${clientId}&cursor=${cursor}&limit=1`))).status).toBe(503);
    result({ ...page(), nextCursor: cursor }); expect((await GET(request())).status).toBe(503);
    result({ ...page(), rows: [{ ...row, scanStatus: "infected" }] }); expect((await GET(request())).status).toBe(503);
  });
  it("bounds query length after authenticating", async () => {
    expect((await GET(request(`client=${clientId}&cursor=${"x".repeat(2048)}`))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects reordered rows from a malformed history response", async () => {
    result({ ...page(), rows: [row, { ...row, id: clientId, version: 2, createdAt: "2026-09-15T00:00:00Z" }] });
    expect((await GET(request())).status).toBe(503);
  });
  it("bounds hung metadata RPC and never returns zero-filled history", async () => {
    vi.useFakeTimers(); mocks.single.mockReturnValue(new Promise(() => {})); const pending = GET(request());
    await vi.advanceTimersByTimeAsync(10_000); const response = await pending; expect(response.status).toBe(503); expect((await response.json()).data).toBeNull();
  });
  it("handles unconfigured client or thrown transport errors without details", async () => {
    mocks.client.mockResolvedValue(null); expect((await GET(request())).status).toBe(503);
    mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.single.mockRejectedValue(new Error("sensitive bearer token"));
    const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("bearer");
  });
});
