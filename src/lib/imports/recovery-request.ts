import "server-only";

import { z } from "zod";
import { MAX_INTAKE_WEB_UPLOAD_BYTES } from "@/lib/client-intake/model";
import { ImportError } from "./errors";
import { importOperationKeySchema } from "./production-model";
import { readBoundedImportBody, requireImportRead, requireImportWrite } from "./request-security";
import { MAX_HTML_IMPORT_BYTES } from "./types";
import { validateHtmlImportFile } from "./validation";

export type UploadRecoveryMode = "general" | "routine-intake";

function invalid(): never {
  throw new ImportError("IMPORT_RECOVERY_INVALID_REQUEST", "請使用原檔、原操作與本次續做識別碼重新核對。", 400);
}

/** The route chooses the mode. Neither a form field nor a header can downgrade
 * a general import to routine Google intake. Keys are identifiers, not authority. */
export async function readUploadRecoveryRequest(request: Request, mode: UploadRecoveryMode) {
  requireImportWrite(request, "multipart");
  if (!["general", "routine-intake"].includes(mode)) invalid();
  const limit = mode === "routine-intake" ? MAX_INTAKE_WEB_UPLOAD_BYTES : MAX_HTML_IMPORT_BYTES;
  const bytes = await readBoundedImportBody(request, limit + (mode === "routine-intake" ? 64 : 512) * 1024);
  let form: FormData;
  try {
    form = await new Response(Buffer.from(bytes), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
  } catch { invalid(); }
  const keys = ["file", "reservation_id", "original_operation_key", "idempotency_key"];
  if ([...form.keys()].some(key => !keys.includes(key)) || keys.some(key => form.getAll(key).length !== 1)) invalid();
  const file = form.get("file");
  const reservation = z.uuid().safeParse(form.get("reservation_id"));
  const original = (mode === "routine-intake" ? z.uuid() : importOperationKeySchema).safeParse(form.get("original_operation_key"));
  const recovery = z.uuid().safeParse(form.get("idempotency_key"));
  const header = request.headers.get("idempotency-key");
  if (!(file instanceof File) || !reservation.success || !original.success || !recovery.success ||
      (header !== null && header !== recovery.data)) invalid();
  if (file.size > limit) throw new ImportError("IMPORT_RECOVERY_FILE_TOO_LARGE", mode === "routine-intake" ? "此續做入口單檔上限 4 MB。" : "此續做入口單檔上限 25 MB。", 413, "file");
  let validated: ReturnType<typeof validateHtmlImportFile>;
  try {
    validated = validateHtmlImportFile({ fileName: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
  } catch {
    // Do not reflect declared charset, source HTML, filenames or provider text.
    throw new ImportError("IMPORT_RECOVERY_INVALID_FILE", "原檔的格式、編碼或內容未通過檢查，請保留原檔並重新核對。", 422, "file");
  }
  return { file: { fileName: validated.fileName, mimeType: validated.mimeType, bytes: Uint8Array.from(validated.bytes) },
    options: { reservationId: reservation.data, originalOperationKey: original.data, recoveryOperationKey: recovery.data } };
}

export function readUploadRecoveryKey(request: Request) {
  const parameters = requireImportRead(request, ["key"]);
  const key = z.uuid().safeParse(parameters.get("key"));
  if (!key.success) invalid();
  return key.data;
}
