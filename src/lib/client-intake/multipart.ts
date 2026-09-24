import "server-only";
import { IntegrationError } from "@/lib/integrations/errors";
import { MAX_INTAKE_WEB_UPLOAD_BYTES } from "./model";

export async function readIntakeMultipart(request: Request) {
  const limit = MAX_INTAKE_WEB_UPLOAD_BYTES + 64 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new IntegrationError("FILE_TOO_LARGE", "此網頁入口單檔上限 4 MB。", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new IntegrationError("INVALID_FILE", "沒有收到檔案，請重新選擇。", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new IntegrationError("FILE_TOO_LARGE", "此網頁入口單檔上限 4 MB。", 413); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  try { return await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData(); }
  catch { throw new IntegrationError("INVALID_FILE", "檔案未完整送達，請保留原檔並重試。", 400); }
}
