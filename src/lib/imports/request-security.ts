import "server-only";

import { requireSameOriginWrite } from "@/lib/auth/same-origin-write";
import { IntegrationError } from "@/lib/integrations/errors";

const invalidQuery = () => new IntegrationError("INVALID_IMPORT_QUERY", "請從匯入頁面重新選擇批次與個案。", 400);

/** Admission only: this does not replace live employee, branch, or RPC checks. */
export function requireImportWrite(request: Request, format: "json" | "multipart") {
  requireSameOriginWrite(request, { method: "POST", format });
  if (new URL(request.url).search) throw invalidQuery();
}

/** Do not silently ignore unsupported or repeated filters on private reads. */
export function requireImportRead(request: Request, allowed: readonly string[]) {
  const length = request.headers.get("content-length");
  if (request.method !== "GET" || request.body !== null || request.headers.has("transfer-encoding") ||
    (length !== null && length !== "0")) throw invalidQuery();
  const parameters = new URL(request.url).searchParams;
  if ([...parameters.keys()].some(key => !allowed.includes(key) || parameters.getAll(key).length !== 1)) throw invalidQuery();
  return parameters;
}

/** Enforce actual streamed bytes, not a browser-controlled Content-Length.
 * Cancelling this body read never implies that a remote write was rolled back. */
export async function readBoundedImportBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const oversized = () => new IntegrationError("REQUEST_TOO_LARGE", "匯入內容超過此入口允許大小。", 413);
  const uncertain = () => new IntegrationError("IMPORT_BODY_UNCONFIRMED", "檔案或操作內容未完整送達，請保留原操作後重試。", 503);
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d{1,12}$/u.test(length) || Number(length) > maxBytes)) throw oversized();
  if (!request.body) throw new IntegrationError("INVALID_IMPORT_BODY", "請提供完整的匯入操作內容。", 400);
  if (request.bodyUsed || request.body.locked) throw new IntegrationError("INVALID_IMPORT_BODY", "匯入內容已被讀取，請保留原操作後重試。", 400);
  const reader = request.body.getReader();
  const deadline = performance.now() + 10000;
  let complete = false;
  let stopped = request.signal.aborted;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const active = () => { if (stopped || performance.now() >= deadline) throw uncertain(); };
    const bound = new Promise<never>((_, reject) => {
      onAbort = () => { stopped = true; reject(uncertain()); };
      if (stopped) { onAbort(); return; }
      request.signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(onAbort, 10000);
    });
    return await Promise.race([(async () => {
      active();
      // Fixed owned blocks bound allocation count as well as byte count. A
      // fragmented upload must not retain one allocation for every tiny chunk.
      const blocks: Buffer[] = []; let total = 0;
      let block: Buffer | undefined; let used = 0;
      while (true) {
        const chunk = await reader.read(); active();
        if (chunk.done) {
          if (block && used) blocks.push(block.subarray(0, used));
          complete = true; return Buffer.concat(blocks, total);
        }
        total += chunk.value.byteLength;
        if (total > maxBytes) throw oversized();
        let offset = 0;
        while (offset < chunk.value.byteLength) {
          block ??= Buffer.alloc(Math.min(64 * 1024, maxBytes));
          const size = Math.min(block.byteLength - used, chunk.value.byteLength - offset);
          block.set(chunk.value.subarray(offset, offset + size), used);
          used += size; offset += size;
          if (used === block.byteLength) { blocks.push(block); block = undefined; used = 0; }
        }
      }
    })(), bound]);
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw uncertain();
  } finally {
    stopped = true; clearTimeout(timer);
    if (onAbort) request.signal.removeEventListener("abort", onAbort);
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** JSON admission shares the same streamed byte/deadline fence as HTML. */
export async function readImportJsonObject(request: Request) {
  const bytes = await readBoundedImportBody(request, 64 * 1024);
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new IntegrationError("INVALID_JSON", "請提供有效的 JSON 物件。", 400);
  }
}
