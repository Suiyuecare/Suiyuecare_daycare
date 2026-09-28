import { ok } from "@/lib/api/response";
import { parseAbcdClientSearchQuery, parseAbcdClientSearchResult } from
  "@/lib/abcd-assessments/client-search";
import { getTenantContext } from "@/lib/auth/context";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute,
  readJsonObject } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const preliminary = await getTenantContext("staff");
    if (!preliminary) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
    // The routine-intake `abcd.read` preflight requires a concrete client ID;
    // a search has none yet. For AAL1 the scoped, current-authority RPC below
    // performs both branch admission and per-result client assignment checks.
    const actor = preliminary.assuranceLevel === "aal2" ?
      await authorizeStaffRequest() : preliminary;
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
      "展示模式不會搜尋正式個案。", 403);
    if (["clients.read", "abcd_assessments.read"].some((scope) => !actor.scopes.includes(scope))) {
      throw new IntegrationError("ABCD_CLIENT_SEARCH_NOT_AUTHORIZED",
        "目前角色無法搜尋 ABCD 評估個案。", 403);
    }
    const query = parseAbcdClientSearchQuery(await readJsonObject(request, 512));
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED",
      "正式個案搜尋尚未設定。", 503);
    const { data, error } = await supabase.rpc("abcd_assessment_client_search", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_query: query,
    });
    if (error) {
      if (error.code === "42501") throw databaseFailure("ABCD_CLIENT_SEARCH_NOT_AUTHORIZED",
        "目前帳號、分支或個案指派不允許搜尋。", 403);
      if (error.code === "P4290") throw databaseFailure("ABCD_CLIENT_SEARCH_RATE_LIMITED",
        "搜尋過於頻繁，請稍後再試。", 429);
      if (error.code === "22023") throw databaseFailure("INVALID_ABCD_CLIENT_SEARCH",
        "請輸入 2 至 64 字的姓名或個案代碼。", 400);
      throw databaseFailure("ABCD_CLIENT_SEARCH_UNAVAILABLE",
        "目前無法搜尋最新個案名單，請重試。", 503);
    }
    return ok(parseAbcdClientSearchResult(data, actor.organizationId,
      actor.branchId), 200, requestId);
  });
}
