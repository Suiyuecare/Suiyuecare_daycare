import "server-only";
import { IntegrationError } from "@/lib/integrations/errors";

/** A deadline stops this operation's next stage, not an already issued remote write.
 * Such writes remain unknown and must be retried with the original key. */
export async function documentDeadline<T>(operation: Promise<T>, milliseconds = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new IntegrationError("STAFF_DOCUMENT_RESULT_UNCERTAIN",
        "附件操作尚未確認完成，請保留相同操作識別碼及原檔重試。", 503)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function readBoundedDocumentBody(request: Request, maxBytes: number): Promise<Uint8Array> {
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
    })(), 10000);
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function readBoundedDocumentJson(request: Request) {
  const bytes = await readBoundedDocumentBody(request, 4096);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new IntegrationError("INVALID_STAFF_DOCUMENT_BODY", "操作內容無效，請重新核對。", 400); }
}
