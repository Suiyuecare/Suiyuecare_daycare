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
