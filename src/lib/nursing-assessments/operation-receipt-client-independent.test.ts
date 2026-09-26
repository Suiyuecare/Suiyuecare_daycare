import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_WRITE_TIMEOUT_MS } from "@/lib/api/client-fetch";
import { buildDemoNursingAssessmentSnapshot } from "./demo";
import { parseNursingOperationReceiptEnvelope } from "./operation-receipt";
import { NursingOperationReceiptReadError, readNursingOperationReceipt } from "./operation-receipt-client";
import type { NursingReceipt, NursingRequest } from "./types";

const uuid = (n: number) => `51940000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3) };
const nonce = uuid(4), key = uuid(5), now = Date.parse("2026-09-27T07:00:00.000Z");
function fixture(action: NursingRequest["action"] = "create_draft") {
  const snapshot = buildDemoNursingAssessmentSnapshot(scope.organizationId, scope.branchId), client = snapshot.clients[0]!, source = client.versions[0]!;
  const previous = { clientId: client.clientId, assessmentKey: source.assessmentKey, previousVersionId: source.versionId,
    expectedVersion: source.version, expectedContentHash: source.contentHash };
  const request: NursingRequest = action === "create_draft" ? { action, clientId: client.clientId, content: source.content }
    : action === "sign" ? { action, ...previous } : action === "correct" ? { action, ...previous, content: source.content, correctionReason: "獨立合成更正" }
      : { action, ...previous, content: source.content };
  const signed = action === "sign" || action === "correct", committedAt = new Date(now - 1000).toISOString();
  const receipt: NursingReceipt = { operationId: uuid(6), organizationId: scope.organizationId, branchId: scope.branchId, actorUserId: scope.userId,
    idempotencyKey: key, request: structuredClone(request), replayed: false, persisted: true, demo: false,
    result: { ...source, assessmentKey: action === "create_draft" ? uuid(7) : previous.assessmentKey, versionId: uuid(8), version: action === "create_draft" ? 1 : previous.expectedVersion + 1,
      previousVersionId: action === "create_draft" ? null : previous.previousVersionId, previousContentHash: action === "create_draft" ? null : previous.expectedContentHash,
      content: structuredClone(source.content), contentHash: "b".repeat(64), recordedBy: scope.userId, state: action === "correct" ? "corrected" : signed ? "signed" : "draft",
      correctionReason: action === "correct" ? "獨立合成更正" : null, createdAt: committedAt, signedAt: signed ? committedAt : null,
      signedBy: signed ? scope.userId : null, signerDisplayName: signed ? "獨立合成人員" : null,
      signaturePurpose: signed ? action === "sign" ? "人工護理評估簽署" : "人工護理評估更正簽署" : null,
      signatureChallengeId: signed ? uuid(9) : null } };
  const proof = { schemaVersion: 1, status: "committed", organizationId: scope.organizationId, branchId: scope.branchId,
    actorUserId: scope.userId, clientId: request.clientId, action, idempotencyKey: key, nonce, verifiedAt: new Date(now).toISOString(),
    persisted: true, demo: false, receipt };
  const envelope = { requestId: uuid(10), status: "ok", errors: [], data: proof };
  return { request, proof, envelope, operation: { key, nonce, request }, expected: { ...scope, clientId: request.clientId, action, idempotencyKey: key, nonce, request } };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("independent exact nursing operation receipt GET", () => {
  it.each(["create_draft", "revise_draft", "sign", "correct"] as const)("uses the whole frozen %s request to independently correlate original persisted receipt", async action => {
    const value = fixture(action), fetch = vi.fn().mockResolvedValue(Response.json(value.envelope)); vi.stubGlobal("fetch", fetch);
    const result = await readNursingOperationReceipt(scope, value.operation);
    expect(result.status).toBe("committed"); expect(result.receipt?.replayed).toBe(false); expect(fetch).toHaveBeenCalledOnce();
  });
  it("uses a single bodyless no-store GET and keeps operation key/nonce out of URL and browser storage", async () => {
    const value = fixture(), fetch = vi.fn().mockResolvedValue(Response.json(value.envelope)); vi.stubGlobal("fetch", fetch);
    const random = vi.spyOn(crypto, "randomUUID"); await readNursingOperationReceipt(scope, value.operation);
    expect(fetch).toHaveBeenCalledOnce(); const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/nursing-assessments/receipt"); expect(url).not.toContain(key); expect(url).not.toContain(nonce);
    expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error" });
    expect(init.body).toBeUndefined(); expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.get("x-organization-id")).toBe(scope.organizationId); expect(headers.get("x-branch-id")).toBe(scope.branchId);
    expect(headers.get("x-client-id")).toBe(value.request.clientId); expect(headers.get("x-nursing-operation")).toBe("create_draft");
    expect(headers.get("idempotency-key")).toBe(key); expect(headers.get("x-nursing-receipt-nonce")).toBe(nonce);
    expect(headers.get("authorization")).toBeNull(); expect(random).not.toHaveBeenCalled();
  });
  it("not_found is explicit false/null evidence, not a claimed failed write or a fabricated result", async () => {
    const value = fixture(); Object.assign(value.envelope.data, { status: "not_found", persisted: false, receipt: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value.envelope)));
    expect(await readNursingOperationReceipt(scope, value.operation)).toMatchObject({ status: "not_found", persisted: false, receipt: null });
  });
  it.each(["organizationId", "branchId", "actorUserId", "clientId", "nonce", "idempotencyKey"] as const)("rejects a successful outer envelope bound to a different %s", field => {
    const value = fixture(); value.proof[field] = uuid(99);
    expect(() => parseNursingOperationReceiptEnvelope(value.envelope, value.expected, now)).toThrow();
  });
  it.each(["organizationId", "branchId", "actorUserId", "idempotencyKey"] as const)("rejects a correct outer proof containing a foreign inner %s", field => {
    const value = fixture(); value.proof.receipt[field] = uuid(99);
    expect(() => parseNursingOperationReceiptEnvelope(value.envelope, value.expected, now)).toThrow();
  });
  it.each([{ schemaVersion: 2 }, { status: "failed" }, { persisted: false }, { demo: true }, { receipt: null }, { sensitiveNote: "PRIVATE_SECRET" }])("rejects nonexact proof %#", change => {
    const value = fixture(); Object.assign(value.proof, change);
    expect(() => parseNursingOperationReceiptEnvelope(value.envelope, value.expected, now)).toThrow();
  });
  it.each([{ requestId: "bad" }, { status: "error" }, { errors: [{ message: "PRIVATE_SECRET" }] }, { data: null }, { trace: "PRIVATE_SECRET" }])("rejects nonexact outer envelope %#", change => {
    const value = fixture(); Object.assign(value.envelope, change);
    expect(() => parseNursingOperationReceiptEnvelope(value.envelope, value.expected, now)).toThrow();
  });
  it("checks full create content, not merely action/client/key", async () => {
    const value = fixture(); if ("content" in value.proof.receipt.request) value.proof.receipt.request.content.domains.observations.detail = "不同內容";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value.envelope)));
    await expect(readNursingOperationReceipt(scope, value.operation)).rejects.toMatchObject({ status: 200, code: "INVALID_RESPONSE" });
  });
  it("captures the complete original request/key/nonce before a caller changes its input during lookup", async () => {
    const value = fixture(), original = structuredClone(value.request); let finish!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetch);
    const outcome = readNursingOperationReceipt(scope, value.operation);
    if ("content" in value.operation.request) value.operation.request.content.domains.observations.detail = "送出後修改，不能變更查證目標";
    value.operation.key = uuid(99); value.operation.nonce = uuid(98);
    finish(Response.json(value.envelope)); const result = await outcome;
    expect(result.receipt?.request).toEqual(original);
    expect(result.idempotencyKey).toBe(key); expect(result.nonce).toBe(nonce); expect(fetch).toHaveBeenCalledOnce();
  });
  it("checks full predecessor version/hash under the same signing action/client/key", () => {
    const value = fixture("sign"); const changed = structuredClone(value.expected);
    if (changed.request.action !== "create_draft") changed.request.expectedContentHash = "c".repeat(64);
    expect(() => parseNursingOperationReceiptEnvelope(value.envelope, changed, now)).toThrow();
  });
  it("rejects an existing receipt reusing its predecessor version ID", () => {
    const value = fixture("sign"); if (value.request.action === "create_draft") throw new Error("fixture");
    value.proof.receipt.result.versionId = value.request.previousVersionId;
    expect(() => parseNursingOperationReceiptEnvelope(value.envelope, value.expected, now)).toThrow();
  });
  it("rejects receipt marked as a write replay", () => {
    const value = fixture(); value.proof.receipt.replayed = true;
    expect(() => parseNursingOperationReceiptEnvelope(value.envelope, value.expected, now)).toThrow();
  });
  it.each([-60001, 60001])("rejects lookup evidence outside inclusive 60-second clock skew %i", skew => {
    const value = fixture(); value.proof.verifiedAt = new Date(now + skew).toISOString();
    expect(() => parseNursingOperationReceiptEnvelope(value.envelope, value.expected, now)).toThrow();
  });
  it.each([-60000, 60000])("allows exact frozen clock skew boundary %i while requiring receipt existence before verification", skew => {
    const value = fixture(); value.proof.receipt.result.createdAt = new Date(now - 120000).toISOString();
    value.proof.verifiedAt = new Date(now + skew).toISOString();
    expect(parseNursingOperationReceiptEnvelope(value.envelope, value.expected, now).status).toBe("committed");
  });
  it("rejects receipt creation after lookup evidence even though the outer evidence is fresh", () => {
    const value = fixture(); value.proof.receipt.result.createdAt = new Date(now + 1).toISOString();
    expect(() => parseNursingOperationReceiptEnvelope(value.envelope, value.expected, now)).toThrow();
  });
  it.each([NaN, Infinity])("rejects nonfinite observation time %s", observed => {
    const value = fixture(); expect(() => parseNursingOperationReceiptEnvelope(value.envelope, value.expected, observed)).toThrow();
  });
  it.each([401, 403, 404, 409, 500, 201, 302])("does not parse unavailable HTTP %i or replay the operation", async status => {
    const value = fixture(), json = vi.fn(), fetch = vi.fn().mockResolvedValue({ status, json }); vi.stubGlobal("fetch", fetch);
    await expect(readNursingOperationReceipt(scope, value.operation)).rejects.toMatchObject({ status, code: "UNAVAILABLE" });
    expect(json).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("redacts JSON and transport exceptions and returns no attached clinical content", async () => {
    const value = fixture(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => { throw new Error("PRIVATE_SECRET"); } }));
    const malformed = await readNursingOperationReceipt(scope, value.operation).catch(error => error);
    expect(malformed).toBeInstanceOf(NursingOperationReceiptReadError); expect(malformed).toMatchObject({ status: 200, code: "INVALID_RESPONSE" });
    expect(String(malformed)).not.toContain("PRIVATE_SECRET");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("PRIVATE_SECRET")));
    const unavailable = await readNursingOperationReceipt(scope, value.operation).catch(error => error);
    expect(unavailable).toMatchObject({ status: null, code: "UNAVAILABLE" }); expect(String(unavailable)).not.toContain("PRIVATE_SECRET");
  });
  it("rejects pre-aborted lookup before outgoing fetch", async () => {
    const value = fixture(), controller = new AbortController(); controller.abort();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(readNursingOperationReceipt(scope, value.operation, controller.signal)).rejects.toMatchObject({ status: null, code: "ABORTED" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("ignores a successful late body after the lookup was cancelled", async () => {
    const value = fixture(), controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => { controller.abort(); return Response.json(value.envelope); }));
    await expect(readNursingOperationReceipt(scope, value.operation, controller.signal)).rejects.toMatchObject({ status: null, code: "ABORTED" });
  });
  it.each(["fetch", "body"])("20-second bound includes stalled %s, not just receipt headers", async phase => {
    vi.useFakeTimers(); vi.setSystemTime(now); const value = fixture();
    const fetch = vi.fn().mockImplementation(() => phase === "fetch" ? new Promise<Response>(() => {}) : Promise.resolve({ status: 200, json: () => new Promise(() => {}) }));
    vi.stubGlobal("fetch", fetch);
    const outcome = readNursingOperationReceipt(scope, value.operation).catch(error => error);
    await vi.advanceTimersByTimeAsync(CLIENT_WRITE_TIMEOUT_MS);
    expect(await outcome).toMatchObject({ status: null, code: "UNAVAILABLE" }); expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["nonce", "key"] as const)("invalid %s returns safe failure before fetch", async field => {
    const value = fixture(), fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(readNursingOperationReceipt(scope, { ...value.operation, [field]: "INVALID_PRIVATE_SECRET" })).rejects.toMatchObject({ status: null, code: "INVALID_REQUEST" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
