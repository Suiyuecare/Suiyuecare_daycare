import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_WRITE_TIMEOUT_MS } from "@/lib/api/client-fetch";
import { ConfirmedInventoryFailure, sendDataInventoryOperation, UnknownInventoryOutcome } from "./data-inventory-request";
import { inventoryIds, inventoryReceiptEnvelope, inventoryTestOperation } from "./data-inventory-test-fixtures";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const failure = (code: string) => ({ requestId: inventoryIds.operationId, status: "error", data: null,
  errors: [{ code, message: "UNTRUSTED_SERVER_TEXT_WITH_SECRET" }] });
describe("manual data inventory bounded requests", () => {
  it("sends the exact request and matching body/header key, then accepts a bound receipt", async () => {
    const operation = inventoryTestOperation();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(inventoryReceiptEnvelope(operation)), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    const result = await sendDataInventoryOperation(operation);
    expect(result.idempotencyKey).toBe(operation.idempotencyKey);
    expect(fetch.mock.calls[0]![0]).toBe("/api/data-inventory");
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "idempotency-key": operation.idempotencyKey }, body: JSON.stringify({ ...operation.request, idempotency_key: operation.idempotencyKey }) });
  });
  it.each(["actorUserId", "branchId", "organizationId", "idempotencyKey"] as const)("rejects a receipt for a different %s", async (key) => {
    const operation = inventoryTestOperation(); const envelope = inventoryReceiptEnvelope(operation);
    envelope.data[key] = "83000000-0000-4000-8000-000000000099";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope), { status: 201 })));
    await expect(sendDataInventoryOperation(operation)).rejects.toBeInstanceOf(UnknownInventoryOutcome);
  });
  it("rejects a generic 2xx and does not display server content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok", data: { private: "secret" } }), { status: 200 })));
    await expect(sendDataInventoryOperation(inventoryTestOperation())).rejects.toThrow("完成憑證與原操作無法核對");
  });
  it.each([[400, "INVALID_DATA_INVENTORY"], [401, "AUTH_REQUIRED"], [403, "AAL2_REQUIRED"],
    [403, "DATA_INVENTORY_NOT_AUTHORIZED"], [409, "DATA_INVENTORY_VERSION_CONFLICT"], [413, "REQUEST_TOO_LARGE"]] as const)(
    "recognizes confirmed failure %s/%s without reflecting its message", async (status, code) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(failure(code)), { status })));
      const promise = sendDataInventoryOperation(inventoryTestOperation());
      await expect(promise).rejects.toBeInstanceOf(ConfirmedInventoryFailure);
      await expect(promise).rejects.not.toThrow("UNTRUSTED_SERVER_TEXT_WITH_SECRET");
    });
  it.each([[409, "DATA_INVENTORY_RESULT_UNCERTAIN"], [502, "DATA_INVENTORY_RECEIPT_INVALID"],
    [503, "SERVICE_NOT_CONFIGURED"], [500, "INTEGRATION_INTERNAL_ERROR"], [400, "UNKNOWN"], [500, "INVALID_JSON"]] as const)(
    "retains uncertainty for %s/%s", async (status, code) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(failure(code)), { status })));
      await expect(sendDataInventoryOperation(inventoryTestOperation())).rejects.toBeInstanceOf(UnknownInventoryOutcome);
    });
  it("does not accept a malformed failure envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...failure("AUTH_REQUIRED"), data: { secret: true } }), { status: 401 })));
    await expect(sendDataInventoryOperation(inventoryTestOperation())).rejects.toBeInstanceOf(UnknownInventoryOutcome);
  });
  it.each(["fetch", "json"])("bounds stalled %s and aborts without manufacturing success", async (phase) => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => {});
    const fetch = vi.fn().mockImplementation(() => phase === "fetch" ? never : Promise.resolve({ ok: true, status: 201, json: () => never }));
    vi.stubGlobal("fetch", fetch);
    const promise = sendDataInventoryOperation(inventoryTestOperation());
    const assertion = expect(promise).rejects.toBeInstanceOf(UnknownInventoryOutcome);
    await vi.advanceTimersByTimeAsync(CLIENT_WRITE_TIMEOUT_MS + 1);
    await assertion;
    expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
  });
});
