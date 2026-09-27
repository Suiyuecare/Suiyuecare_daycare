import "server-only";
import { IntegrationError } from "@/lib/integrations/errors";

/** A deadline stops this operation's next stage, not an already issued remote write.
 * Such writes remain unknown and must be retried with the original key. */
export async function documentDeadline<T>(operation: Promise<T>, milliseconds = 20000, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      const uncertain = () => reject(new IntegrationError("STAFF_DOCUMENT_RESULT_UNCERTAIN",
        "附件操作尚未確認完成，請保留相同操作識別碼及原檔重試。", 503));
      if (signal?.aborted) { uncertain(); return; }
      onAbort = uncertain;
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(uncertain, milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

/** One bound for admission, RPC, evidence parsing and response construction.
 * Cancellation cannot undo an issued write; it only fences later stages and
 * prevents an ignored/late provider result from being published as success. */
export async function staffDocumentRouteDeadline<T>(request: Request,
  operation: (active: () => void, signal: AbortSignal) => Promise<T>): Promise<T> {
  let stopped = request.signal.aborted;
  const controller = new AbortController();
  const uncertain = () => new IntegrationError("STAFF_DOCUMENT_RESULT_UNCERTAIN",
    "附件操作尚未完整確認，請保留原內容與相同操作識別碼。", 503);
  const active = () => { if (stopped) throw uncertain(); };
  let rejectBound!: () => void;
  const bounded = new Promise<never>((_, reject) => {
    rejectBound = () => { stopped = true; controller.abort(); reject(uncertain()); };
  });
  const timer = setTimeout(rejectBound, 20000);
  request.signal.addEventListener("abort", rejectBound, { once: true });
  try {
    return await Promise.race([(async () => { active(); const result = await operation(active, controller.signal); active(); return result; })(), bounded]);
  } finally {
    stopped = true; clearTimeout(timer); request.signal.removeEventListener("abort", rejectBound);
  }
}

export async function readBoundedDocumentBody(request: Request, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d{1,12}$/u.test(length) || Number(length) > maxBytes)) {
    throw new IntegrationError("STAFF_DOCUMENT_TOO_LARGE", "附件或操作內容超過允許大小。", 413);
  }
  if (!request.body) throw new IntegrationError("INVALID_STAFF_DOCUMENT_BODY", "請提供完整附件或操作內容。", 400);
  const reader = request.body.getReader();
  let complete = false;
  try {
    return await documentDeadline((async () => {
      const chunks: Uint8Array[] = []; let total = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) { complete = true; return Buffer.concat(chunks, total); }
        total += chunk.value.byteLength;
        if (total > maxBytes) throw new IntegrationError("STAFF_DOCUMENT_TOO_LARGE", "附件或操作內容超過允許大小。", 413);
        chunks.push(chunk.value);
      }
    })(), 10000, signal);
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function readBoundedDocumentJson(request: Request, signal?: AbortSignal) {
  const bytes = await readBoundedDocumentBody(request, 4096, signal);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new IntegrationError("INVALID_STAFF_DOCUMENT_BODY", "操作內容無效，請重新核對。", 400); }
}
