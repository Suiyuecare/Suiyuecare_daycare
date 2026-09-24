import { ok } from "@/lib/api/response";
import { documentLifecycleInputSchema, validateDocumentLifecycleReceipt, boundedDocumentRpc } from "@/lib/client-documents/lifecycle";
import { hasDocumentCategoryPermission } from "@/lib/client-documents/schema";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const forbidden = () => new IntegrationError("DOCUMENT_FORBIDDEN", "沒有此個案與附件類別的管理授權。", 403);
const uncertain = () => new IntegrationError("DOCUMENT_LIFECYCLE_UNCERTAIN", "附件處置尚未確認完成，請保留原內容與操作識別碼重試，勿另送新操作。", 503);

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不改動正式附件。", 403);
    if (!actor.branchId || !actor.scopes.includes("clients.read")) throw forbidden();
    await requireRecentAal2(actor);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      throw new IntegrationError("INVALID_DOCUMENT_LIFECYCLE", "請從附件處置表單送出。", 415);
    }
    const parsed = documentLifecycleInputSchema.safeParse(await readJsonObject(request, 4096));
    if (!parsed.success) throw new IntegrationError("INVALID_DOCUMENT_LIFECYCLE", "請確認附件版本、處置與至少三字的理由。", 400);
    const input = parsed.data;
    if (!hasDocumentCategoryPermission(actor.scopes, input.category, true)) throw forbidden();
    const server = await createServerSupabaseClient();
    if (!server) throw new IntegrationError("DOCUMENT_UNAVAILABLE", "附件管理暫時無法使用，尚未送出處置。", 503);
    const result = await boundedDocumentRpc((signal) => server.rpc("change_client_document_disposition", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_input: input,
    }).abortSignal(signal).maybeSingle<{ receipt: unknown }>()).catch(() => { throw uncertain(); });
    if (result.error) {
      if (result.error.code === "42501") throw forbidden();
      if (result.error.code === "40001") throw new IntegrationError("DOCUMENT_LIFECYCLE_CONFLICT", "其他人已更新這份附件的處置，請保留本次內容，重新載入並比對最新版本後再送出。", 409);
      if (result.error.code === "23505") throw new IntegrationError("DOCUMENT_LIFECYCLE_KEY_CONFLICT", "此操作識別碼已使用於不同內容，請重新載入並核對原操作。", 409);
      if (result.error.code === "22023") throw new IntegrationError("INVALID_DOCUMENT_LIFECYCLE", "附件與處置內容不符，請重新核對。", 400);
      if (result.error.code === "23514" || result.error.code === "55000") throw new IntegrationError("DOCUMENT_LIFECYCLE_STATE_CONFLICT", "此附件目前無法進行這項處置，請重新載入確認狀態。", 409);
      throw uncertain();
    }
    const receipt = validateDocumentLifecycleReceipt(result.data?.receipt, input);
    if (!receipt) throw uncertain();
    return ok({ receipt }, receipt.replayed ? 200 : 201, requestId);
  });
}
