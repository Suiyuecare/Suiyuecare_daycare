import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { documentHistoryQuerySchema, validateDocumentHistoryPage, boundedDocumentRpc } from "@/lib/client-documents/lifecycle";
import { hasDocumentCategoryPermission } from "@/lib/client-documents/schema";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const unavailable = () => new IntegrationError("DOCUMENT_HISTORY_UNAVAILABLE", "附件歷程暫時無法確認，請重新載入；未將未知資料視為沒有附件。", 503);
const forbidden = () => new IntegrationError("DOCUMENT_FORBIDDEN", "沒有此個案與附件類別的查閱授權。", 403);

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await getTenantContext("staff");
    if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不查詢正式附件歷程。", 403);
    if (!actor.branchId || !actor.scopes.includes("clients.read")) throw forbidden();
    const url = new URL(request.url);
    if (url.search.length > 2048) throw new IntegrationError("INVALID_DOCUMENT_HISTORY_QUERY", "附件查詢條件過長，請重新選擇個案與類別。", 400);
    const params = url.searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new IntegrationError("INVALID_DOCUMENT_HISTORY_QUERY", "附件查詢條件重複，請重新載入。", 400);
    const parsed = documentHistoryQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) throw new IntegrationError("INVALID_DOCUMENT_HISTORY_QUERY", "請選擇有效個案、附件類別與歷程頁次。", 400);
    const query = parsed.data;
    if (query.category && !hasDocumentCategoryPermission(actor.scopes, query.category)) throw forbidden();
    const server = await createServerSupabaseClient();
    if (!server) throw unavailable();
    const result = await boundedDocumentRpc((signal) => server.rpc("client_document_history", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_client: query.client,
      p_category: query.category ?? null, p_cursor: query.cursor ?? null, p_limit: query.limit,
    }).abortSignal(signal).maybeSingle<{ payload: unknown }>()).catch(() => { throw unavailable(); });
    if (result.error) {
      if (result.error.code === "42501") throw forbidden();
      if (result.error.code === "22023") throw new IntegrationError("INVALID_DOCUMENT_HISTORY_CURSOR", "歷程頁次不屬於目前個案或類別，請從第一頁重新載入。", 400);
      if (result.error.code === "55000") throw new IntegrationError("DOCUMENT_HISTORY_EXPIRED", "附件歷程已過期，請從第一頁重新載入最新資料。", 409);
      if (result.error.code === "54000") throw new IntegrationError("DOCUMENT_HISTORY_SCOPE_LIMIT", "附件歷程數量超過單次查閱上限，請先選擇附件類別。", 409);
      throw unavailable();
    }
    const snapshot = validateDocumentHistoryPage(result.data?.payload, {
      organizationId: actor.organizationId, branchId: actor.branchId, clientId: query.client,
      category: query.category ?? null, limit: query.limit,
    });
    if (!snapshot || (query.cursor && snapshot.nextCursor === query.cursor)) throw unavailable();
    if (snapshot.rows.some((row) => !hasDocumentCategoryPermission(actor.scopes, row.category) ||
      (row.canManage && !hasDocumentCategoryPermission(actor.scopes, row.category, true)))) throw forbidden();
    return ok({ snapshot }, 200, requestId);
  });
}
