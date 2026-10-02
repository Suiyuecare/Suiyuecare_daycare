import "server-only";
import { IntegrationError } from "@/lib/integrations/errors";
import { readBoundedImportBody } from "@/lib/imports/request-security";
import { MAX_INTAKE_WEB_UPLOAD_BYTES } from "./model";

export async function readIntakeMultipart(request: Request) {
  const limit = MAX_INTAKE_WEB_UPLOAD_BYTES + 64 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new IntegrationError("FILE_TOO_LARGE", "此網頁入口單檔上限 4 MB。", 413);
  if (!request.body) throw new IntegrationError("INVALID_FILE", "沒有收到檔案，請重新選擇。", 400);
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedImportBody(request, limit);
  } catch (error) {
    if (error instanceof IntegrationError && error.code === "REQUEST_TOO_LARGE") throw new IntegrationError("FILE_TOO_LARGE", "此網頁入口單檔上限 4 MB。", 413);
    throw error;
  }
  try { return await new Response(Buffer.from(bytes), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData(); }
  catch { throw new IntegrationError("INVALID_FILE", "檔案未完整送達，請保留原檔並重試。", 400); }
}
