import { ok } from "@/lib/api/response";
import {
  authorizeImportRequest,
  handleImportRoute,
  readIdempotencyKey,
} from "@/lib/imports/http";
import { uploadHtmlImport } from "@/lib/imports/service";
import { getImportRepository } from "@/lib/imports/storage";
import { MAX_HTML_IMPORT_BYTES } from "@/lib/imports/types";
import { ImportError } from "@/lib/imports/errors";

const MAX_MULTIPART_OVERHEAD_BYTES = 512 * 1024;

export async function POST(request: Request) {
  return handleImportRoute(async (requestId) => {
    const actor = await authorizeImportRequest(request, "upload");
    const repository = getImportRepository();
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_HTML_IMPORT_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
    ) {
      throw new ImportError(
        "FILE_TOO_LARGE",
        "HTML 檔案不得超過 25MB。",
        413,
        "file",
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ImportError(
        "INVALID_MULTIPART_BODY",
        "請使用 multipart/form-data 上傳 HTML。",
        400,
      );
    }
    const uploaded = form.get("file");
    if (!(uploaded instanceof File)) {
      throw new ImportError(
        "IMPORT_FILE_REQUIRED",
        "請選擇要匯入的 HTML 檔案。",
        400,
        "file",
      );
    }
    if (uploaded.size > MAX_HTML_IMPORT_BYTES) {
      throw new ImportError(
        "FILE_TOO_LARGE",
        "HTML 檔案不得超過 25MB。",
        413,
        "file",
      );
    }

    const idempotencyKey = readIdempotencyKey(
      request,
      form.get("idempotency_key"),
    );
    const receipt = await uploadHtmlImport(
      repository,
      actor,
      {
        fileName: uploaded.name,
        mimeType: uploaded.type,
        bytes: new Uint8Array(await uploaded.arrayBuffer()),
      },
      idempotencyKey,
    );
    return ok(receipt, receipt.duplicate || receipt.replayed ? 200 : 201, requestId);
  });
}
