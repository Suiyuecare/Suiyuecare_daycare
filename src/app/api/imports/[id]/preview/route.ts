import { ok } from "@/lib/api/response";
import {
  assertImportId,
  authorizeImportRequest,
  handleImportRoute,
} from "@/lib/imports/http";
import { getImportPreview } from "@/lib/imports/service";
import { getImportRepository } from "@/lib/imports/storage";
import { requireImportRead } from "@/lib/imports/request-security";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleImportRoute(async (requestId) => {
    requireImportRead(request, []);
    const { id } = await params;
    assertImportId(id);
    const actor = await authorizeImportRequest(request, "preview");
    const preview = await getImportPreview(await getImportRepository(actor, "preview"), actor, id);
    return ok(preview, 200, requestId);
  });
}
