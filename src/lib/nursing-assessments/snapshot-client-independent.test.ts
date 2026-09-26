import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { buildDemoNursingAssessmentSnapshot } from "./demo";
import { nursingAssessmentAuthoritySignature } from "./pending";
import { nursingReadAuthoritySignature } from "./read-authority";
import { NursingSnapshotReadError, parseNursingSnapshotEnvelope, readNursingSnapshot } from "./snapshot-client";

const uuid = (n: number) => `51910000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3) };
const nonce = uuid(4);
const now = Date.parse("2026-09-27T04:00:00.000Z");
function fixture(overrides: Partial<TenantContext> = {}) {
  const context: TenantContext = { ...scope, organizationName: "獨立合成機構", branchName: "獨立合成分支", displayName: "獨立合成護理",
    roles: ["nurse"], scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage", "nursing_assessments.sign"],
    assuranceLevel: "aal2", recentAal2At: new Date(now).toISOString(), demo: false, ...overrides };
  const snapshot = { ...buildDemoNursingAssessmentSnapshot(scope.organizationId, scope.branchId), demo: false };
  return { context, value: { requestId: uuid(5), status: "ok", errors: [], data: { schemaVersion: 1,
    organizationId: scope.organizationId, branchId: scope.branchId, actorUserId: scope.userId, nonce,
    snapshot, capabilities: { canManage: true, canSign: true, hasRecentAal2: true },
    authoritySignature: nursingReadAuthoritySignature(context), demo: false } } };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("independent nursing manual-read transport and attestation", () => {
  it("shares the existing five-element canonical authority without importing a server authority", () => {
    const { context, value } = fixture();
    expect(nursingReadAuthoritySignature(context)).toBe(nursingAssessmentAuthoritySignature(context));
    expect(JSON.parse(value.data.authoritySignature)).toHaveLength(5);
    expect(parseNursingSnapshotEnvelope(value, scope, nonce, now)).toMatchObject({ snapshot: value.data.snapshot,
      authoritySignature: value.data.authoritySignature, capabilities: value.data.capabilities });
  });
  it.each(["organizationId", "branchId", "actorUserId", "nonce"] as const)("rejects a different %s binding", field => {
    const { value } = fixture(); value.data[field] = uuid(99);
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, now)).toThrow();
  });
  it.each([{ schemaVersion: 2 }, { demo: true }, { accessToken: "DO_NOT_EXPOSE" }, { filters: {} }])("rejects nonexact data envelope %#", change => {
    const { value } = fixture(); Object.assign(value.data, change);
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, now)).toThrow();
  });
  it.each([{ status: "error" }, { requestId: "not-a-uuid" }, { errors: [{}] }, { data: null }, { clinicalSecret: "DO_NOT_EXPOSE" }])("rejects malformed top-level envelope %#", change => {
    const { value } = fixture(); Object.assign(value, change);
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, now)).toThrow();
  });
  it.each(["organizationId", "branchId"] as const)("rejects foreign snapshot %s even when outer proof matches", field => {
    const { value } = fixture(); value.data.snapshot[field] = uuid(98);
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, now)).toThrow();
  });
  it.each(["roles", "scopes"] as const)("rejects duplicate and unsorted %s instead of silently canonicalizing", field => {
    const { value } = fixture(); const tuple = JSON.parse(value.data.authoritySignature);
    const index = field === "roles" ? 1 : 2;
    tuple[index].push(tuple[index][0]); value.data.authoritySignature = JSON.stringify(tuple);
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, now)).toThrow();
    tuple[index] = field === "roles" ? ["nurse", "branch_supervisor"] : [...new Set(tuple[index])].reverse();
    value.data.authoritySignature = JSON.stringify(tuple);
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, now)).toThrow();
  });
  it.each([{ assuranceLevel: "aal1" as const }, { scopes: ["nursing_assessments.read"] }, { scopes: ["clients.read"] }, { demo: true }])("rejects missing current read authority %#", change => {
    const { value } = fixture(change);
    value.data.capabilities = { canManage: false, canSign: false, hasRecentAal2: false };
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, now)).toThrow();
  });
  it("allows a scoped supervisor to read but rejects invented clinical write capability", () => {
    const { value } = fixture({ roles: ["branch_supervisor"], recentAal2At: null });
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, now)).toThrow();
    value.data.capabilities = { canManage: false, canSign: false, hasRecentAal2: false };
    expect(parseNursingSnapshotEnvelope(value, scope, nonce, now).capabilities).toEqual(value.data.capabilities);
  });
  it.each([null, "2026-09-27T03:44:59.999Z"])("cannot invent recent verification from %s", recentAal2At => {
    const { value } = fixture({ recentAal2At });
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, now)).toThrow();
    value.data.capabilities.hasRecentAal2 = false;
    expect(parseNursingSnapshotEnvelope(value, scope, nonce, now).capabilities.hasRecentAal2).toBe(false);
  });
  it("rejects a future verification time even when the supplied capability is false", () => {
    const { value } = fixture({ recentAal2At: "2026-09-27T04:00:00.001Z" });
    value.data.capabilities.hasRecentAal2 = false;
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, now)).toThrow();
  });
  it.each([now - 1, now + 300000, NaN, Infinity])("rejects future/expired/nonfinite read observation %s", observed => {
    const { value } = fixture();
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, observed)).toThrow();
  });
  it("does not convert a snapshot 1 millisecond in the future into usable authority", () => {
    const { value } = fixture(); value.data.snapshot.generatedAt = new Date(now + 1).toISOString();
    value.data.snapshot.staleAfter = new Date(now + 300001).toISOString();
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, now)).toThrow();
  });
  it.each([{ demo: true }, { staleAfter: "2099-01-01T00:00:00Z" }, { clientTotal: 3 }, { rawHtml: "DO_NOT_EXPOSE" }])("rejects inconsistent backend snapshot %#", change => {
    const { value } = fixture(); Object.assign(value.data.snapshot, change);
    expect(() => parseNursingSnapshotEnvelope(value, scope, nonce, now)).toThrow();
  });
  it("does not reinterpret a truncated visible list as proof that unseen clients are absent", () => {
    const { value } = fixture(); value.data.snapshot.clientTotal = 3; value.data.snapshot.clientsTruncated = true;
    const result = parseNursingSnapshotEnvelope(value, scope, nonce, now);
    expect(result.snapshot.clientTotal).toBe(3); expect(result.snapshot.clientsTruncated).toBe(true);
  });
  it("makes exactly one no-store GET with only scope/nonce, no clinical body or mutation key", async () => {
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const { value } = fixture(); value.data.nonce = new Headers(init.headers).get("x-nursing-read-nonce")!;
      return Response.json(value);
    }); vi.stubGlobal("fetch", fetch);
    await readNursingSnapshot(scope, new AbortController().signal);
    expect(fetch).toHaveBeenCalledOnce(); const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/nursing-assessments/snapshot");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error" });
    expect(init.body).toBeUndefined(); expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.get("x-organization-id")).toBe(scope.organizationId); expect(headers.get("x-branch-id")).toBe(scope.branchId);
    expect(headers.get("idempotency-key")).toBeNull(); expect(headers.get("x-nursing-operation")).toBeNull();
    expect(headers.get("authorization")).toBeNull(); expect(headers.get("x-nursing-read-nonce")).toMatch(/^[0-9a-f-]{36}$/u);
  });
  it.each([401, 403, 409, 500, 201, 302])("does not parse or automatically retry HTTP %i", async status => {
    const json = vi.fn(); const fetch = vi.fn().mockResolvedValue({ status, json }); vi.stubGlobal("fetch", fetch);
    await expect(readNursingSnapshot(scope)).rejects.toMatchObject({ status, code: "UNAVAILABLE" });
    expect(fetch).toHaveBeenCalledOnce(); expect(json).not.toHaveBeenCalled();
  });
  it("reports malformed JSON only as safe status metadata, not backend content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => { throw new Error("CLINICAL_SECRET"); } }));
    const error = await readNursingSnapshot(scope).catch(value => value);
    expect(error).toBeInstanceOf(NursingSnapshotReadError); expect(error).toMatchObject({ status: 200, code: "INVALID_RESPONSE" });
    expect(String(error)).not.toContain("CLINICAL_SECRET");
  });
  it("rejects a late successful body after cancellation even if transport ignored abort", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      const { value } = fixture(); value.data.nonce = new Headers(init.headers).get("x-nursing-read-nonce")!;
      controller.abort(); return Response.json(value);
    }));
    await expect(readNursingSnapshot(scope, controller.signal)).rejects.toMatchObject({ status: null, code: "ABORTED" });
  });
  it("redacts transport errors and never retransmits a clinical operation", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("CLINICAL_SECRET")); vi.stubGlobal("fetch", fetch);
    const error = await readNursingSnapshot(scope).catch(value => value);
    expect(error).toMatchObject({ status: null, code: "UNAVAILABLE" }); expect(String(error)).not.toContain("CLINICAL_SECRET");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("rejects malformed scope before any request or nonce generation", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const random = vi.spyOn(crypto, "randomUUID");
    await expect(readNursingSnapshot({ ...scope, userId: "not-a-uuid" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
  });
});
