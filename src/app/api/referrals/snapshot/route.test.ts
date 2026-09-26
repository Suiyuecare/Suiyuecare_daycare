import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "@/lib/integrations/errors";
import { buildDemoReferralManagementSnapshot } from "@/lib/referral-management/demo";
import { serializeReferralReadFilters } from "@/lib/referral-management/snapshot-client";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), recent: vi.fn(), load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ hasRecentAal2: mocks.recent }));
vi.mock("@/lib/integrations/http", () => ({ authorizeStaffRequest: mocks.authorize,
  handleIntegrationRoute: async (fn: (id: string) => Promise<Response>) => {
    const id = "39000000-0000-4000-8000-000000000045";
    try { return await fn(id); }
    catch (error) { const e = error as IntegrationError; return Response.json({ requestId: id, status: "error", data: null,
      errors: [{ code: e.code ?? "UNKNOWN", message: e.message }] }, { status: e.httpStatus ?? 500, headers: { "Cache-Control": "private, no-store, max-age=0" } }); }
  } }));
vi.mock("@/lib/referral-management/snapshot", () => ({ loadReferralManagementSnapshot: mocks.load,
  ReferralManagementSnapshotError: class extends Error {} }));
import { GET } from "./route";
const actor = { organizationId: "39000000-0000-4000-8000-000000000040", branchId: "39000000-0000-4000-8000-000000000041",
  userId: "39200000-0000-4000-8000-000000000001", displayName: "合成社工", organizationName: "合成機構", branchName: "合成分支",
  roles: ["case_manager_social_worker"], scopes: ["clients.read", "referral_management.read"], assuranceLevel: "aal1", recentAal2At: null, demo: false };
const nonce = "39000000-0000-4000-8000-000000000042";
const filters = { clientId: null, receivingUnitMode: "all" as const, receivingUnitCode: null, status: "all" as const, recentFrom: null, recentTo: null, query: "" };
const malformedHeaders: Record<string, string>[] = [
  { "x-referral-read-nonce": "bad" }, { "x-referral-read-nonce": "" }, { "x-referral-read-filters": "%zz" },
  { "x-referral-read-filters": "x".repeat(4097) },
  { "x-referral-read-filters": encodeURIComponent(JSON.stringify({ ...filters, actorUserId: actor.userId })) },
];
function request(headers: Record<string, string> = {}, query = "") { return new Request(`https://example.invalid/api/referrals/snapshot${query}`, {
  headers: { "x-organization-id": actor.organizationId, "x-branch-id": actor.branchId, "x-referral-read-nonce": nonce,
    "x-referral-read-filters": serializeReferralReadFilters(filters), ...headers },
}); }
beforeEach(() => { vi.resetAllMocks(); mocks.authorize.mockResolvedValue(actor); mocks.recent.mockResolvedValue(false);
  mocks.load.mockResolvedValue({ ...buildDemoReferralManagementSnapshot({ ...actor, filters }), demo: false }); });
describe("explicit referral recovery GET", () => {
  it("authorizes before headers/filters and rejects demo without calling data or recent evidence", async () => {
    mocks.authorize.mockResolvedValue({ ...actor, demo: true });
    const response = await GET(request({ "x-referral-read-filters": "bad" }));
    expect(response.status).toBe(403); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.recent).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
  it.each([{ scopes: [] }, { scopes: ["clients.read"] }, { scopes: ["referral_management.read"] }])("rejects missing read permission before parsing %#", async ({ scopes }) => {
    mocks.authorize.mockResolvedValue({ ...actor, scopes });
    expect((await GET(request({ "x-referral-read-filters": "bad" }))).status).toBe(403);
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.recent).not.toHaveBeenCalled();
  });
  it("does not replace an authentication failure with empty or demo data", async () => {
    mocks.authorize.mockRejectedValue(new IntegrationError("AUTH_REQUIRED", "未登入", 401));
    expect((await GET(request())).status).toBe(401); expect(mocks.load).not.toHaveBeenCalled();
  });
  it.each(malformedHeaders)("rejects malformed headers before DB %#", async headers => {
    expect((await GET(request(headers))).status).toBe(400); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.recent).not.toHaveBeenCalled();
  });
  it.each(["?actorUserId=other", "?status=draft&status=all", "?q=unvalidated"])("does not accept URL filters or identity %#", async query => {
    expect((await GET(request({}, query))).status).toBe(400); expect(mocks.load).not.toHaveBeenCalled();
  });
  it.each(["x-organization-id", "x-branch-id"])("rejects wrong scoped header %#", async name => {
    expect((await GET(request({ [name]: nonce }))).status).toBe(403); expect(mocks.load).not.toHaveBeenCalled();
  });
  it("loads only the original read RPC through its loader without demanding write permission/MFA", async () => {
    const response = await GET(request()); expect(response.status).toBe(200);
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(actor, filters, false);
    const body = await response.json(); expect(body.data).toMatchObject({ schemaVersion: 1, organizationId: actor.organizationId,
      branchId: actor.branchId, actorUserId: actor.userId, nonce, filters, demo: false });
    expect(body.data.snapshot.demo).toBe(false); expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
  it("passes actual generic recent evidence as can-flags only; never fabricates a timestamp", async () => {
    mocks.recent.mockResolvedValue(true); expect((await GET(request())).status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith(actor, filters, true); expect(actor.recentAal2At).toBeNull();
  });
  it.each([{ branchId: nonce }, { demo: true }, { private_notes: "redacted" }, { staleAfter: "2099-01-01T00:00:00Z" }])("rejects malformed backend projection without exposing it %#", async change => {
    const value = { ...buildDemoReferralManagementSnapshot({ ...actor, filters }), demo: false, ...change };
    mocks.load.mockResolvedValue(value); const response = await GET(request()); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("redacted");
  });
  it("fails unavailable without replacing data on backend failure", async () => {
    mocks.load.mockRejectedValue(new Error("private DB text")); const response = await GET(request());
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private DB text");
  });
});
