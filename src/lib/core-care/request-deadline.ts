import { CLIENT_WRITE_TIMEOUT_MS, ClientFetchTimeoutError } from "@/lib/api/client-fetch";

type Options = { signal?: AbortSignal; timeoutMs?: number; readOnly?: boolean };

/** Request-owned boundary for an explicit daily-care operation, including its
 * receipt/rejection decoding. No retry, key generation, storage or success claim.
 * Cancellation does not prove a submitted transaction was rolled back. */
export async function withCareRequestDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: Options = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? CLIENT_WRITE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive finite number");
  const owner = options.signal;
  if (owner?.aborted) throw new DOMException("Daily care operation cancelled", "AbortError");
  const controller = new AbortController();
  let removeAbort = () => {};
  const bounded = new Promise<never>((_, reject) => {
    const onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => controller.signal.removeEventListener("abort", onAbort);
  });
  const onOwnerAbort = () => controller.abort(new DOMException("Daily care operation cancelled", "AbortError"));
  owner?.addEventListener("abort", onOwnerAbort, { once: true });
  const timer = setTimeout(() => controller.abort(options.readOnly
    ? new Error("資料讀取逾時，請重新讀取；這不表示沒有紀錄。")
    : new ClientFetchTimeoutError(timeoutMs)), timeoutMs);
  try {
    if (owner?.aborted) onOwnerAbort();
    const operation = Promise.resolve().then(async () => {
      controller.signal.throwIfAborted();
      const result = await work(controller.signal);
      controller.signal.throwIfAborted();
      return result;
    });
    return await Promise.race([operation, bounded]);
  } finally {
    clearTimeout(timer);
    removeAbort();
    owner?.removeEventListener("abort", onOwnerAbort);
  }
}
