import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_WRITE_TIMEOUT_MS } from "@/lib/api/client-fetch";
import { ConfirmedPreparationFailure, sendEvaluationPreparationOperation, UnknownPreparationOutcome,
  type EvaluationPreparationOperation } from "./evaluation-preparation-request";

const ids = {
  organizationId: "79100000-0000-4000-8000-000000000001",
  branchId: "79200000-0000-4000-8000-000000000001",
  actorUserId: "79000000-0000-4000-8000-000000000001",
  idempotencyKey: "79800000-0000-4000-8000-000000000001",
  operationId: "79900000-0000-4000-8000-000000000001",
  versionId: "79900000-0000-4000-8000-000000000002",
};
const operation: EvaluationPreparationOperation = {
  ...ids, input: { itemCode: "WANHUA_01", expectedVersion: 0, ownerUserId: null,
    dueOn: null, evidenceReference: null, progress: "collecting", changeReason: "initial" },
};
function receipt() {
  return { status: "ok", data: { organizationId: ids.organizationId, branchId: ids.branchId,
    actorUserId: ids.actorUserId, idempotencyKey: ids.idempotencyKey, operationId: ids.operationId,
    replayed: false, formalSubmissionEnabled: false,
    result: { versionId: ids.versionId, itemCode: "WANHUA_01", version: 1,
      previousVersionId: null, ownerUserId: null, dueOn: null, evidenceReference: null,
      progress: "collecting", changeReason: "initial", recordedBy: ids.actorUserId,
      recordedAt: new Date().toISOString(), contentHash: "a".repeat(64) } } };
}
function failure(status: number, code: string) {
  return new Response(JSON.stringify({ requestId: ids.operationId, status: "error", data: null,
    errors: [{ code, message: "untrusted secret" }] }), { status });
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Page 79 idempotent browser write", () => {
  it("sends one bounded request and only accepts a receipt for the exact scope", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(receipt()), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await expect(sendEvaluationPreparationOperation(operation)).resolves.toMatchObject({ idempotencyKey: ids.idempotencyKey });
    expect(fetch.mock.calls[0]![0]).toBe("/api/evaluation-preparation");
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "idempotency-key": ids.idempotencyKey },
      body: JSON.stringify({ ...operation.input, idempotency_key: ids.idempotencyKey }) });
  });
  it.each(["branchId", "organizationId", "actorUserId", "idempotencyKey"] as const)(
    "rejects a mismatched %s receipt", async (key) => {
      const response = receipt(); response.data[key] = "79000000-0000-4000-8000-000000000099";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 201 })));
      await expect(sendEvaluationPreparationOperation(operation)).rejects.toBeInstanceOf(UnknownPreparationOutcome);
    });
  it("recognizes a known failed operation without reflecting server text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failure(409, "EVALUATION_PREPARATION_VERSION_CONFLICT")));
    const result = sendEvaluationPreparationOperation(operation);
    await expect(result).rejects.toBeInstanceOf(ConfirmedPreparationFailure);
    await expect(result).rejects.not.toThrow("untrusted secret");
  });
  it.each([400, 403])("reconciles an earlier unknown write before interpreting later %s as failure", async (status) => {
    const recovered = receipt(); recovered.data.replayed = true;
    const fetch = vi.fn()
      .mockResolvedValueOnce(failure(status, status === 400 ? "INVALID_EVALUATION_PREPARATION" : "EVALUATION_PREPARATION_NOT_AUTHORIZED"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", data: { receipt: recovered.data } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(sendEvaluationPreparationOperation(operation, true)).resolves.toMatchObject({
      idempotencyKey: ids.idempotencyKey, replayed: true,
    });
    expect(fetch.mock.calls[1]![0]).toBe("/api/evaluation-preparation/receipt");
    expect(fetch.mock.calls[1]![1]).toMatchObject({ method: "POST", cache: "no-store",
      headers: { "idempotency-key": ids.idempotencyKey },
      body: JSON.stringify({ request: operation.input, idempotency_key: ids.idempotencyKey }) });
  });
  it("keeps the original operation unknown when a later rejection cannot be reconciled", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(failure(403, "EVALUATION_PREPARATION_NOT_AUTHORIZED"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", data: { receipt: null } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(sendEvaluationPreparationOperation(operation, true)).rejects.toBeInstanceOf(UnknownPreparationOutcome);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps the original operation unknown when receipt access is also revoked", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(failure(403, "EVALUATION_PREPARATION_NOT_AUTHORIZED"))
      .mockResolvedValueOnce(failure(403, "EVALUATION_PREPARATION_NOT_AUTHORIZED"));
    vi.stubGlobal("fetch", fetch);
    await expect(sendEvaluationPreparationOperation(operation, true)).rejects.toBeInstanceOf(UnknownPreparationOutcome);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not accept a cross-actor lookup response after an earlier unknown write", async () => {
    const recovered = receipt(); recovered.data.actorUserId = "79000000-0000-4000-8000-000000000099";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(failure(400, "INVALID_EVALUATION_PREPARATION"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", data: { receipt: recovered.data } }), { status: 200 })));
    await expect(sendEvaluationPreparationOperation(operation, true)).rejects.toBeInstanceOf(UnknownPreparationOutcome);
  });
  it("treats a mismatched error status and uncertain database result as unknown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failure(500, "INVALID_EVALUATION_PREPARATION")));
    await expect(sendEvaluationPreparationOperation(operation)).rejects.toBeInstanceOf(UnknownPreparationOutcome);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failure(409, "EVALUATION_PREPARATION_RESULT_UNCERTAIN")));
    await expect(sendEvaluationPreparationOperation(operation)).rejects.toBeInstanceOf(UnknownPreparationOutcome);
  });
  it("bounds stalled body parsing and retains the operation for exact retry", async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 201, ok: true, json: () => never }));
    const assertion = expect(sendEvaluationPreparationOperation(operation)).rejects.toBeInstanceOf(UnknownPreparationOutcome);
    await vi.advanceTimersByTimeAsync(CLIENT_WRITE_TIMEOUT_MS + 1);
    await assertion;
  });
});
