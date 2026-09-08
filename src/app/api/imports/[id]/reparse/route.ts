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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleImportRoute(async (requestId) => {
    const { id } = await params;
    assertImportId(id);
    const actor = await authorizeImportRequest(request, "reparse");
    const body = await readSmallJsonBody(request);
    const mappingVersion =
      typeof body.mapping_version === "string"
        ? body.mapping_version
        : CURRENT_MAPPING_VERSION;
    const result = await reparseHtmlImport(getImportRepository(), actor, id, {
      mappingVersion: mappingVersion as SupportedMappingVersion,
      idempotencyKey: readIdempotencyKey(request, body.idempotency_key),
    });
    return ok(result, 200, requestId);
  });
}
