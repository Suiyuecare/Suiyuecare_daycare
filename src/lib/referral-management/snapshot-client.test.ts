import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoReferralManagementSnapshot } from "./demo";
import { parseReferralReadFilters, parseReferralSnapshotEnvelope, readReferralSnapshot, serializeReferralReadFilters } from "./snapshot-client";
import type { ReferralManagementFilters } from "./types";
const scope = { organizationId: "39000000-0000-4000-8000-000000000040", branchId: "39000000-0000-4000-8000-000000000041", userId: "39200000-0000-4000-8000-000000000001" };
const nonce = "39000000-0000-4000-8000-000000000042", requestId = "39000000-0000-4000-8000-000000000043";
const filters: ReferralManagementFilters = { clientId: null, receivingUnitMode: "all", receivingUnitCode: null, status: "all", recentFrom: null, recentTo: null, query: "合成搜尋" };
function fixture() {
  const snapshot = { ...buildDemoReferralManagementSnapshot({ ...scope, filters: { ...filters, query: "" } }), demo: false };
  return { requestId, status: "ok", errors: [], data: { schemaVersion: 1, ...scope, actorUserId: scope.userId, userId: undefined,
    nonce, filters, snapshot, demo: false } };
}
function envelope() { const value = fixture(); delete (value.data as Record<string, unknown>).userId; return value; }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("referral explicit read contract", () => {
  it("encodes search and identifiers in bounded headers, never a query URL", () => {
    const header = serializeReferralReadFilters(filters);
    expect(header).not.toContain("合成"); expect(parseReferralReadFilters(header)).toEqual(filters);
  });
  it.each([null, "", "x".repeat(4097), "%zz", "null", "[]", "{}"])("rejects malformed header %#", header => {
    expect(() => parseReferralReadFilters(header)).toThrow();
  });
  it.each([{ query: "x".repeat(121) }, { query: "a\n" }, { clientId: "bad" }, { recentFrom: "2026-02-30" },
    { recentFrom: "2026-10-01", recentTo: "2026-09-01" }, { receivingUnitMode: "specific" },
    { receivingUnitCode: "DEMO" }, { status: "bad" }, { actorUserId: scope.userId }])("rejects malformed filters %#", change => {
    expect(() => parseReferralReadFilters(encodeURIComponent(JSON.stringify({ ...filters, ...change })))).toThrow();
  });
  it("accepts only the exact scoped actor, filters and nonce and preserves source timestamp", () => {
    const value = envelope(), now = Date.parse(value.data.snapshot.generatedAt) + 1;
    expect(parseReferralSnapshotEnvelope(value, scope, filters, nonce, now).generatedAt).toBe(value.data.snapshot.generatedAt);
  });
  it.each([{ nonce: scope.userId }, { actorUserId: nonce }, { organizationId: nonce }, { branchId: nonce },
    { schemaVersion: 2 }, { demo: true }, { token: "unexpected" }])("rejects mismatched or excess envelope fields %#", change => {
    const value = envelope(); Object.assign(value.data, change);
    expect(() => parseReferralSnapshotEnvelope(value, scope, filters, nonce, Date.parse(value.data.snapshot.generatedAt))).toThrow();
  });
  it.each([{ filters: { ...filters, query: "another" } }, { filters: { ...filters, extra: true } },
    { snapshot: { ...envelope().data.snapshot, branchId: nonce } }, { snapshot: { ...envelope().data.snapshot, private_notes: "no" } },
    { snapshot: { ...envelope().data.snapshot, staleAfter: "2099-01-01T00:00:00Z" } }, { snapshot: null }])("rejects incorrect snapshot/filter evidence %#", change => {
    const value = envelope(); Object.assign(value.data, change);
    expect(() => parseReferralSnapshotEnvelope(value, scope, filters, nonce, Date.now())).toThrow();
  });
  it.each([-1, 60000, NaN, Infinity])("rejects future/expired or non-finite observed time %#", offset => {
    const value = envelope(), now = Date.parse(value.data.snapshot.generatedAt) + offset;
    expect(() => parseReferralSnapshotEnvelope(value, scope, filters, nonce, now)).toThrow();
  });
  it("makes one bounded GET without operation key, write body, navigation or retry", async () => {
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const value = envelope(); value.data.nonce = new Headers(init.headers).get("x-referral-read-nonce")!;
      return Response.json(value);
    }); vi.stubGlobal("fetch", fetch);
    const controller = new AbortController(); await readReferralSnapshot(scope, filters, controller.signal);
    expect(fetch).toHaveBeenCalledOnce(); const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("/api/referrals/snapshot"); expect(options).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error" });
    expect(options.body).toBeUndefined(); expect(new Headers(options.headers).get("idempotency-key")).toBeNull();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([401, 403, 500, 201, 302])("never parses a non-200 response or retries %#", async status => {
    const json = vi.fn(); const fetch = vi.fn().mockResolvedValue({ status, json }); vi.stubGlobal("fetch", fetch);
    await expect(readReferralSnapshot(scope, filters)).rejects.toThrow("UNAVAILABLE"); expect(json).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not issue a request with malformed scope/filters", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(readReferralSnapshot({ ...scope, userId: "bad" }, filters)).rejects.toThrow();
    await expect(readReferralSnapshot(scope, { ...filters, query: "x".repeat(121) })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
