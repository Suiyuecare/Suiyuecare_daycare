import { CLIENT_WRITE_TIMEOUT_MS, fetchWithTimeout } from "@/lib/api/client-fetch";
import { parseNursingRequest } from "./parser";
import { nursingReadScopeSchema, nursingReadUuid, type NursingReadScope } from "./read-authority";
import { parseNursingOperationReceiptEnvelope, type NursingOperationReceiptProof } from "./operation-receipt";
import type { NursingRequest } from "./types";

export class NursingOperationReceiptReadError extends Error {
  constructor(readonly status: number | null,
    readonly code: "UNAVAILABLE" | "INVALID_RESPONSE" | "ABORTED" | "INVALID_REQUEST") {
    super("原操作查證尚未完成；請保留原操作，稍後再查。"); this.name = "NursingOperationReceiptReadError";
  }
}
export type NursingOperationReceiptReadOperation = { key: string; request: NursingRequest; nonce: string };

/** One explicit bounded read. The journal owns and binds the nonce. No write,
 * auto retry, MFA, navigation or browser persistence occurs here. */
export async function readNursingOperationReceipt(scope: NursingReadScope,
  operation: NursingOperationReceiptReadOperation, signal?: AbortSignal): Promise<NursingOperationReceiptProof> {
  let expected;
  try {
    const input = nursingReadScopeSchema.parse(scope), nonce = nursingReadUuid.parse(operation.nonce);
    const frozen = parseNursingRequest(operation.request, operation.key);
    expected = { ...input, nonce, request: frozen.request, clientId: frozen.request.clientId,
      action: frozen.request.action, idempotencyKey: frozen.idempotencyKey };
  } catch { throw new NursingOperationReceiptReadError(null, "INVALID_REQUEST"); }
  if (signal?.aborted) throw new NursingOperationReceiptReadError(null, "ABORTED");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), CLIENT_WRITE_TIMEOUT_MS);
  const bounded = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let removeAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(new NursingOperationReceiptReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE"));
    bounded.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => bounded.removeEventListener("abort", onAbort);
    if (bounded.aborted) onAbort();
  });
  try {
    const read = (async () => {
      let response: Response;
      try {
        response = await fetchWithTimeout("/api/nursing-assessments/receipt", { method: "GET", cache: "no-store",
          credentials: "same-origin", redirect: "error", signal: bounded, headers: { accept: "application/json",
            "x-organization-id": expected.organizationId, "x-branch-id": expected.branchId, "x-client-id": expected.clientId,
            "x-nursing-operation": expected.action, "idempotency-key": expected.idempotencyKey,
            "x-nursing-receipt-nonce": expected.nonce } });
      } catch { throw new NursingOperationReceiptReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE"); }
      if (bounded.aborted) throw new NursingOperationReceiptReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE");
      if (response.status !== 200) throw new NursingOperationReceiptReadError(response.status, "UNAVAILABLE");
      try {
        const raw: unknown = await response.json();
        if (bounded.aborted) throw new NursingOperationReceiptReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE");
        return parseNursingOperationReceiptEnvelope(raw, expected, Date.now());
      } catch (error) {
        if (error instanceof NursingOperationReceiptReadError) throw error;
        throw new NursingOperationReceiptReadError(200, "INVALID_RESPONSE");
      }
    })();
    return await Promise.race([read, aborted]);
  } finally { clearTimeout(timer); removeAbort(); }
}
