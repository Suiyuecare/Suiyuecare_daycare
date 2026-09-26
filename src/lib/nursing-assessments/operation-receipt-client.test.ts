import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDemoNursingAssessmentSnapshot } from "./demo";
import { NursingOperationReceiptReadError, readNursingOperationReceipt } from "./operation-receipt-client";
import type { NursingRequest } from "./types";
const id = (n: number) => `51000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { organizationId: id(80), branchId: id(81), userId: id(13) }, key = id(40), nonce = id(41);
const fetch = vi.fn();
function fixture() {
  const source = buildDemoNursingAssessmentSnapshot(scope.organizationId, scope.branchId).clients[0]!.versions[0]!;
  const request: NursingRequest = { action: "create_draft", clientId: id(1), content: source.content };
  const operation = { key, nonce, request };
  const data = { schemaVersion: 1, organizationId: scope.organizationId, branchId: scope.branchId, actorUserId: scope.userId,
    clientId: id(1), action: request.action, idempotencyKey: key, nonce, verifiedAt: new Date().toISOString(),
    status: "committed", persisted: true, demo: false,
    receipt: { operationId: id(90), organizationId: scope.organizationId, branchId: scope.branchId, actorUserId: scope.userId,
      idempotencyKey: key, request: structuredClone(request), result: { ...structuredClone(source), versionId: id(91) }, replayed: false, persisted: true, demo: false } };
  return { operation, data, envelope: { requestId: id(100), status: "ok", errors: [], data } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-27T11:00:00Z")); vi.resetAllMocks(); vi.stubGlobal("fetch", fetch); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe("explicit nursing own-operation read transport", () => {
  it("uses journal nonce unchanged, header-only scope/key and manual same-origin GET", async () => {
    const { operation, envelope } = fixture(); fetch.mockResolvedValue(Response.json(envelope));
    const random = vi.spyOn(crypto, "randomUUID");
    const proof = await readNursingOperationReceipt(scope, operation);
    expect(proof.status).toBe("committed"); expect(random).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0]!; expect(url).toBe("/api/nursing-assessments/receipt");
    expect(options).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error",
      headers: { accept: "application/json", "x-organization-id": scope.organizationId, "x-branch-id": scope.branchId,
        "x-client-id": id(1), "x-nursing-operation": "create_draft", "idempotency-key": key, "x-nursing-receipt-nonce": nonce } });
    expect(options.body).toBeUndefined(); expect(Object.keys(options.headers)).toHaveLength(7);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves not_found as unresolved absence without further reads or writes", async () => {
    const { operation, envelope } = fixture(); fetch.mockResolvedValue(Response.json({ ...envelope,
      data: { ...envelope.data, status: "not_found", persisted: false, receipt: null } }));
    expect(await readNursingOperationReceipt(scope, operation)).toMatchObject({ status: "not_found", persisted: false, receipt: null });
    await vi.advanceTimersByTimeAsync(60000); expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["nonce", "key", "request"])("validates malformed %s before any HTTP", async (field) => {
    const { operation } = fixture();
    const changed = field === "request" ? { ...operation, request: { ...operation.request, clientId: "CLINICAL_SECRET" } }
      : { ...operation, [field]: "CLINICAL_SECRET" };
    await expect(readNursingOperationReceipt(scope, changed)).rejects.toMatchObject({ code: "INVALID_REQUEST", status: null });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects invalid scope before HTTP", async () => {
    const { operation } = fixture(); await expect(readNursingOperationReceipt({ ...scope, userId: "SECRET" }, operation)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never reads when caller is already aborted", async () => {
    const { operation } = fixture(), controller = new AbortController(); controller.abort();
    await expect(readNursingOperationReceipt(scope, operation, controller.signal)).rejects.toMatchObject({ code: "ABORTED" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([201, 204, 302, 400, 401, 403, 409, 503])("rejects HTTP %d without parsing its potentially sensitive body", async (status) => {
    const { operation } = fixture(), json = vi.fn(); fetch.mockResolvedValue({ status, json });
    await expect(readNursingOperationReceipt(scope, operation)).rejects.toMatchObject({ code: "UNAVAILABLE", status });
    expect(json).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["bad json", "wrong nonce", "wrong request", "replayed", "stale", "future", "wrong scope", "unknown field"])("rejects malformed successful proof %s", async (kind) => {
    const { operation, envelope } = fixture();
    if (kind === "wrong nonce") envelope.data.nonce = id(999);
    if (kind === "wrong request") envelope.data.receipt.request.content.assessedOn = "2026-09-01";
    if (kind === "replayed") envelope.data.receipt.replayed = true;
    if (kind === "stale" || kind === "future") envelope.data.verifiedAt = new Date(Date.now() + (kind === "stale" ? -60001 : 60001)).toISOString();
    if (kind === "wrong scope") envelope.data.actorUserId = id(999);
    fetch.mockResolvedValue(kind === "bad json" ? { status: 200, json: () => Promise.reject(new Error("CLINICAL_SECRET")) }
      : Response.json(kind === "unknown field" ? { ...envelope, secret: "CLINICAL_SECRET" } : envelope));
    await expect(readNursingOperationReceipt(scope, operation)).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
  });
  it("freezes full original request before awaiting fetch", async () => {
    const { operation, envelope } = fixture(); let resolve!: (value: Response) => void;
    fetch.mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    const pending = readNursingOperationReceipt(scope, operation);
    operation.request.content.assessedOn = "2026-09-01";
    resolve(Response.json(envelope)); expect((await pending).status).toBe("committed");
  });
  it.each(["fetch", "body"])("bounds hanging %s even if transport ignores AbortSignal", async (part) => {
    const { operation } = fixture(); fetch.mockImplementation(() => part === "fetch" ? new Promise(() => {})
      : Promise.resolve({ status: 200, json: () => new Promise(() => {}) }));
    const pending = readNursingOperationReceipt(scope, operation); const result = expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE", status: null });
    await vi.advanceTimersByTimeAsync(20000); await result; expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["fetch", "body"])("caller abort cancels hanging %s and rejects late evidence", async (part) => {
    const { operation, envelope } = fixture(), controller = new AbortController(); let resolve!: (value: unknown) => void;
    const deferred = new Promise((done) => { resolve = done; });
    fetch.mockImplementation(() => part === "fetch" ? deferred : Promise.resolve({ status: 200, json: () => deferred }));
    const pending = readNursingOperationReceipt(scope, operation, controller.signal);
    const result = expect(pending).rejects.toMatchObject({ code: "ABORTED", status: null });
    await Promise.resolve(); controller.abort(); await result;
    resolve(part === "fetch" ? Response.json(envelope) : envelope); await Promise.resolve();
    expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("redacts raw transport exception", async () => {
    const { operation } = fixture(); fetch.mockRejectedValue(new Error("CLINICAL_SECRET"));
    try { await readNursingOperationReceipt(scope, operation); throw new Error("expected rejection"); }
    catch (error) { expect(error).toBeInstanceOf(NursingOperationReceiptReadError); expect(String(error)).not.toContain("CLINICAL_SECRET"); }
  });
});
