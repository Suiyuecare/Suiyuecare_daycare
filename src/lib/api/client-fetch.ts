export const CLIENT_WRITE_TIMEOUT_MS = 20_000;

export class ClientFetchTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super("連線逾時，操作結果未知；請保留內容並以相同操作重試。");
    this.name = "ClientFetchTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function isClientFetchTimeoutError(error: unknown): error is ClientFetchTimeoutError {
  return error instanceof ClientFetchTimeoutError ||
    (error instanceof Error && error.name === "ClientFetchTimeoutError");
}

/**
 * Bounds an interactive browser request without changing the request body or
 * idempotency key. Callers can therefore safely offer an exact retry when the
 * server outcome is unknown.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = CLIENT_WRITE_TIMEOUT_MS,
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive finite number");
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;

  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (timeoutSignal.aborted && !init.signal?.aborted) {
      throw new ClientFetchTimeoutError(timeoutMs);
    }
    throw error;
  }
}

export type ClientJsonReadErrorCode = "ABORTED" | "UNAVAILABLE" | "INVALID_RESPONSE";

/** Transport metadata only. Never retain provider text, payloads or causes. */
export class ClientJsonReadError extends Error {
  constructor(readonly code: ClientJsonReadErrorCode, readonly status: number | null = null) {
    super(code === "ABORTED" ? "資料讀取已取消。" : "資料暫時無法讀取，請重新讀取。");
    this.name = "ClientJsonReadError";
  }
}

/** One explicit read-only GET. The independent deadline includes both fetch
 * and JSON decoding, even when either promise ignores cooperative abort.
 * HTTP errors never decode or expose provider error bodies. No retries,
 * writes, logging, navigation, storage or changes to write-helper semantics. */
export async function fetchJsonWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<{ response: Response; payload: unknown }> {
  const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
  if ((init.method !== undefined && (typeof init.method !== "string" || init.method.toUpperCase() !== "GET")) ||
    request !== null && (request.method !== "GET" || request.body !== null) ||
    init.body !== undefined && init.body !== null ||
    typeof input !== "string" && !(input instanceof URL) && request === null) {
    throw new ClientJsonReadError("UNAVAILABLE");
  }
  const owner = init.signal !== undefined ? init.signal : request?.signal;
  if (owner?.aborted) throw new ClientJsonReadError("ABORTED");
  const controller = new AbortController();
  const abortError = () => new ClientJsonReadError(owner?.aborted ? "ABORTED" : "UNAVAILABLE");
  let removeBoundedAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(abortError());
    controller.signal.addEventListener("abort", onAbort, { once: true });
    removeBoundedAbort = () => controller.signal.removeEventListener("abort", onAbort);
  });
  const onOwnerAbort = () => controller.abort();
  owner?.addEventListener("abort", onOwnerAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), CLIENT_WRITE_TIMEOUT_MS);
  try {
    if (owner?.aborted) controller.abort();
    const operation = (async () => {
      let response: Response;
      try {
        if (controller.signal.aborted) throw abortError();
        response = await fetch(input, { ...init, method: "GET", cache: "no-store",
          credentials: "same-origin", redirect: "error", signal: controller.signal });
      } catch { throw abortError(); }
      if (controller.signal.aborted) throw abortError();
      if (response.status !== 200 || response.redirected) throw new ClientJsonReadError("UNAVAILABLE", response.status);
      let payload: unknown;
      try { payload = await response.json(); }
      catch {
        if (controller.signal.aborted) throw abortError();
        throw new ClientJsonReadError("INVALID_RESPONSE", 200);
      }
      if (controller.signal.aborted) throw abortError();
      return { response, payload };
    })();
    return await Promise.race([operation, aborted]);
  } finally {
    clearTimeout(timer);
    removeBoundedAbort();
    owner?.removeEventListener("abort", onOwnerAbort);
  }
}
