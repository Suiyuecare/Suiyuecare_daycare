import { ok } from "@/lib/api/response";
import {
  assertImportId,
  authorizeImportRequest,
  handleImportRoute,
  readIdempotencyKey,
  readSmallJsonBody,
} from "@/lib/imports/http";
import {
  CURRENT_MAPPING_VERSION,
  reparseHtmlImport,
} from "@/lib/imports/service";
import { getImportRepository } from "@/lib/imports/storage";
import type { SupportedMappingVersion } from "@/lib/imports/types";
import { requireImportWrite } from "@/lib/imports/request-security";
import { ImportError } from "@/lib/imports/errors";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleImportRoute(async (requestId) => {
    requireImportWrite(request, "json");
    const { id } = await params;
    assertImportId(id);
    const actor = await authorizeImportRequest(request, "reparse");
    const body = await readSmallJsonBody(request);
    if (Object.keys(body).some(key => !["idempotency_key", "mapping_version"].includes(key)) ||
      (body.mapping_version !== undefined && typeof body.mapping_version !== "string")) {
      throw new ImportError("INVALID_IMPORT_BODY", "請重新選擇有效映射版本，並保留原操作識別碼。", 400);
    }
    const mappingVersion =
      typeof body.mapping_version === "string"
        ? body.mapping_version
        : CURRENT_MAPPING_VERSION;
    const result = await reparseHtmlImport(await getImportRepository(actor, "reparse"), actor, id, {
      mappingVersion: mappingVersion as SupportedMappingVersion,
      idempotencyKey: readIdempotencyKey(request, body.idempotency_key),
    });
    return ok(result, 200, requestId);
  });
}
