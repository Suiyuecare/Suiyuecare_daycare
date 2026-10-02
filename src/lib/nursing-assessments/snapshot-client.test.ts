import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { CLIENT_WRITE_TIMEOUT_MS } from "@/lib/api/client-fetch";
import { buildDemoNursingAssessmentSnapshot } from "./demo";
import { nursingReadAuthoritySignature } from "./read-authority";
import { NursingSnapshotReadError, parseNursingSnapshotEnvelope, readNursingSnapshot } from "./snapshot-client";
const id = (n: number) => `51000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const nonce = id(42), requestId = id(43);
function fixture() {
  const scope = { organizationId: id(80), branchId: id(81), userId: id(13) };
  const context: TenantContext = { ...scope, organizationName: "合成機構", branchName: "合成分支", displayName: "合成護理",
    roles: ["nurse"], scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage", "nursing_assessments.sign"],
    assuranceLevel: "aal2", recentAal2At: null, demo: false };
  const snapshot = { ...buildDemoNursingAssessmentSnapshot(scope.organizationId, scope.branchId), demo: false };
  return { scope, context, value: { requestId, status: "ok", errors: [], data: {
    schemaVersion: 1, organizationId: scope.organizationId, branchId: scope.branchId, actorUserId: scope.userId, nonce,
    snapshot, capabilities: { canManage: true, canSign: true, hasRecentAal2: false },
    authoritySignature: nursingReadAuthoritySignature(context), demo: false,
  } } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("explicit bounded nursing snapshot read", () => {
  it("correlates actor/scope/nonce and retains original projected time and history", () => {
    const { value, scope } = fixture();
    const result = parseNursingSnapshotEnvelope(value, scope, nonce, Date.parse(value.data.snapshot.generatedAt));
    expect(result.snapshot).toEqual(value.data.snapshot); expect(result.authoritySignature).toBe(value.data.authoritySignature);
    expect(result.capabilities).toEqual(value.data.capabilities); expect(result.snapshot).not.toBe(value.data.snapshot);
  });
  it.each([{ nonce: requestId }, { actorUserId: nonce }, { organizationId: nonce }, { branchId: nonce },
    { demo: true }, { schemaVersion: 2 }, { secret: "PRIVATE" }])("rejects cross-bound or extra envelope data %#", (change) => {
    const { value, scope } = fixture(); Object.assign(value.data, change);
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, Date.now())).toThrow();
  });
  it.each([{ requestId: "bad" }, { status: "partial" }, { errors: [{ code: "SECRET" }] }, { extra: true }])("rejects nonexact envelope %#", (change) => {
    const { value, scope } = fixture(); Object.assign(value, change);
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, Date.now())).toThrow();
  });
  it.each([{ branchId: nonce }, { demo: true }, { privateNote: "SECRET" },
    { clientsTruncated: true }, { clientTotal: 0 }, { staleAfter: "2099-01-01T00:00:00Z" }])("reuses strict production projection %#", (change) => {
    const { value, scope } = fixture(); Object.assign(value.data.snapshot, change);
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, Date.now())).toThrow();
  });
  it("rejects duplicate client/version IDs and invalid chain without silently discarding history", () => {
    const { value, scope } = fixture(); value.data.snapshot.clients.push(value.data.snapshot.clients[0]); value.data.snapshot.clientTotal++;
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, Date.now())).toThrow();
    const other = fixture(); other.value.data.snapshot.clients[0].versions.push(other.value.data.snapshot.clients[0].versions[0]);
    other.value.data.snapshot.clients[0].versionsTotal++;
    expect(() => parseNursingSnapshotEnvelope(other.value, other.scope, nonce, Date.now())).toThrow();
  });
  it.each([-1, 300000, NaN, Infinity])("refuses future/expired/nonfinite observation %#", (offset) => {
    const { value, scope } = fixture();
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, Date.parse(value.data.snapshot.generatedAt) + offset)).toThrow();
  });
  it("accepts exact 5-minute TTL only and never a one-minute future snapshot", () => {
    const { value, scope } = fixture();
    value.data.snapshot.staleAfter = new Date(Date.parse(value.data.snapshot.generatedAt) + 300001).toISOString();
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, Date.now())).toThrow();
  });
  it("cannot escalate read-only manager to manage/sign or recency", () => {
    const { value, scope, context } = fixture(); value.data.authoritySignature = nursingReadAuthoritySignature({ ...context, roles: ["organization_manager"] });
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, Date.now())).toThrow();
    value.data.capabilities = { canManage: false, canSign: false, hasRecentAal2: false };
    expect(parseNursingSnapshotEnvelope(value, scope, nonce, Date.now()).snapshot.clients).toHaveLength(2);
  });
  it("makes one exact no-store same-origin GET with no clinical body/key", async () => {
    const { scope } = fixture();
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const { value } = fixture(); value.data.nonce = new Headers(init.headers).get("x-nursing-read-nonce")!;
      return Response.json(value);
    }); vi.stubGlobal("fetch", fetch);
    await readNursingSnapshot(scope, new AbortController().signal);
    expect(fetch).toHaveBeenCalledOnce(); const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/nursing-assessments/snapshot");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error" });
    expect(init.body).toBeUndefined(); expect(init.signal).toBeInstanceOf(AbortSignal);
    expect([...new Headers(init.headers).keys()].sort()).toEqual(["accept", "x-branch-id", "x-nursing-read-nonce", "x-organization-id"]);
    expect(new Headers(init.headers).get("idempotency-key")).toBeNull();
  });
  it.each([401, 403, 500, 201, 302])("never parses or retries non200 response %i", async (status) => {
    const { scope } = fixture(), json = vi.fn(), fetch = vi.fn().mockResolvedValue({ status, json }); vi.stubGlobal("fetch", fetch);
    await expect(readNursingSnapshot(scope)).rejects.toMatchObject({ status, code: "UNAVAILABLE" });
    expect(json).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("redacts malformed body errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => { throw new Error("CLINICAL_SECRET"); } }));
    const error = await readNursingSnapshot(fixture().scope).catch((error) => error);
    expect(error).toBeInstanceOf(NursingSnapshotReadError); expect(error).toMatchObject({ status: 200, code: "INVALID_RESPONSE" });
    expect(String(error)).not.toContain("CLINICAL_SECRET");
  });
  it("redacts transport failures without retry", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("CLINICAL_SECRET")); vi.stubGlobal("fetch", fetch);
    const error = await readNursingSnapshot(fixture().scope).catch((error) => error);
    expect(error).toMatchObject({ status: null, code: "UNAVAILABLE" }); expect(String(error)).not.toContain("CLINICAL_SECRET"); expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not fetch already aborted or malformed input", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const controller = new AbortController(); controller.abort();
    await expect(readNursingSnapshot(fixture().scope, controller.signal)).rejects.toMatchObject({ code: "ABORTED" });
    await expect(readNursingSnapshot({ ...fixture().scope, userId: "bad" })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it("never accepts a late reply after abortion", async () => {
    const controller = new AbortController(); vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const { value } = fixture(); value.data.nonce = new Headers(init.headers).get("x-nursing-read-nonce")!;
      controller.abort(); return Response.json(value);
    }));
    await expect(readNursingSnapshot(fixture().scope, controller.signal)).rejects.toMatchObject({ code: "ABORTED" });
  });
  it.each(["headers", "body"])("bounds hanging %s and starts no automatic retry", async (stage) => {
    vi.useFakeTimers(); const fetch = stage === "headers" ? vi.fn(() => new Promise<Response>(() => {}))
      : vi.fn().mockResolvedValue({ status: 200, json: () => new Promise(() => {}) }); vi.stubGlobal("fetch", fetch);
    const pending = readNursingSnapshot(fixture().scope); const asserted = expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE", status: null });
    await vi.advanceTimersByTimeAsync(CLIENT_WRITE_TIMEOUT_MS); await asserted;
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
  });
});
