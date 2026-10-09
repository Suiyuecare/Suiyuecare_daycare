import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { directorDraftInputSchema } from "@/lib/jubo-pending-director/contract";
import { readPendingDirectorDirectory, readPendingDirectorWorkspace, requirePendingDirector, savePendingDirectorDraft } from "@/lib/jubo-pending-director/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await requirePendingDirector();
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => key !== "client") || params.getAll("client").length > 1) {
      throw new IntegrationError("JUBO_DIRECTOR_INVALID_QUERY", "請重新選擇待收案個案。", 400);
    }
    const client = params.get("client");
    const data = client
      ? await readPendingDirectorWorkspace(actor.organizationId, actor.branchId, client)
      : await readPendingDirectorDirectory(actor.organizationId, actor.branchId);
    return ok(data, 200, requestId);
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await requirePendingDirector();
    if (!/^application\/json(?:;|$)/iu.test(request.headers.get("content-type") ?? "")) {
      throw new IntegrationError("JSON_REQUIRED", "請從待收案草稿表單送出。", 415);
    }
    const parsed = directorDraftInputSchema.safeParse(await readJsonObject(request, 16 * 1024));
    if (!parsed.success) throw new IntegrationError("JUBO_DIRECTOR_DRAFT_INVALID", "請檢查草稿欄位與日期。", 400);
    const receipt = await savePendingDirectorDraft(actor.organizationId, actor.branchId, parsed.data);
    const readback = await readPendingDirectorWorkspace(actor.organizationId, actor.branchId, parsed.data.clientId);
    const saved = parsed.data.kind === "local_supplement"
      ? readback.localSupplement?.revision === receipt.revision
      : readback.assessmentPreparations.some((draft) => draft.formKey === parsed.data.formKey && draft.revision === receipt.revision);
    if (!saved) throw new IntegrationError("JUBO_DIRECTOR_DRAFT_UNCONFIRMED", "伺服器已處理操作，但最新草稿尚未核對；請勿另建，保留本次操作重試。", 503);
    return ok({ receipt, workspace: readback }, 200, requestId);
  });
}
