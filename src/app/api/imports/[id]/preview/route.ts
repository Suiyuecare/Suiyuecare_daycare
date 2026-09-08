import { ok } from "@/lib/api/response";
import {
  assertImportId,
  authorizeImportRequest,
  handleImportRoute,
} from "@/lib/imports/http";
import { getImportPreview } from "@/lib/imports/service";
import { getImportRepository } from "@/lib/imports/storage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleImportRoute(async (requestId) => {
    const { id } = await params;
    assertImportId(id);
    const actor = await authorizeImportRequest(request, "preview");
    const preview = await getImportPreview(getImportRepository(), actor, id);
    return ok(preview, 200, requestId);
  });
}
