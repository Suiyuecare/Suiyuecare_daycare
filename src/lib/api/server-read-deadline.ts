import "server-only";

export const SERVER_WORKSPACE_READ_TIMEOUT_MS = 20_000;

/** Bound a read-only workspace attempt, including client creation and decoding.
 * Abort is advisory to the transport; racing also bounds non-cooperative reads.
 * Callers must check the signal before starting each subsequent provider read.
 * Never use this to infer that a timed-out mutation was not committed. */
export async function withServerReadDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const unavailable = () => new Error("SERVER_WORKSPACE_READ_UNAVAILABLE");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(unavailable());
    }, SERVER_WORKSPACE_READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const value = await operation(controller.signal);
        if (controller.signal.aborted) throw unavailable();
        return value;
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
