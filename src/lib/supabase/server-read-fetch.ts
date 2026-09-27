import "server-only";

/** Only for a request-owned, bounded read client. SDK retries must not send a
 * new request once its owner ended; retain every caller cancellation source.
 * This is not mutation non-commit evidence and never retries a request itself. */
export function createServerReadFetch(owner: AbortSignal): typeof fetch {
  return async (input, init) => {
    owner.throwIfAborted();
    const signals = [owner];
    if (input instanceof Request) signals.push(input.signal);
    if (init?.signal) signals.push(init.signal);
    const signal = AbortSignal.any(signals);
    signal.throwIfAborted();
    const response = await fetch(input, { ...init, cache: "no-store", signal });
    signal.throwIfAborted();
    return response;
  };
}
