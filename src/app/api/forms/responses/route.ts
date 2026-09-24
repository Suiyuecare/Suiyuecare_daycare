import { z } from "zod";
import { ok } from "@/lib/api/response";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { runCustomDraftRpc } from "@/lib/form-governance/draft-http";
import { parseResponseReceipt, parseResponseSnapshot, responseInputSchema } from "@/lib/custom-form-responses/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(code?: string) {
  if (code === "42501") return databaseFailure("CUSTOM_RESPONSE_FORBIDDEN", "目前帳號、個案範圍或驗證狀態不允許這項操作。", 403);
  if (code === "40001" || code === "23505") return databaseFailure("CUSTOM_RESPONSE_CONFLICT", "已有較新版本或操作內容不同；請保留輸入，重新核對後再操作。", 409);
  if (code === "23514") return databaseFailure("CUSTOM_RESPONSE_BLOCKED", "請確認必填欄位、表單效期與紀錄狀態；已簽署資料須建立更正版。", 409);
  if (code === "22023") return databaseFailure("INVALID_CUSTOM_RESPONSE", "欄位、日期或填答格式未通過檢查。", 400);
  return databaseFailure("CUSTOM_RESPONSE_UNAVAILABLE", "資料服務未確認完成，請保留原操作重試。", 503);
}
async function authorize(permission: string) {
  const actor = await authorizeStaffRequest(permission === "care_records.sign" ? {} : { routinePermission: permission === "care_records.write" ? "care_records.write" : "care_records.read" });
  if (actor.demo || !actor.scopes.includes("care_records.read") || !actor.scopes.includes(permission)) throw new IntegrationError("CUSTOM_RESPONSE_FORBIDDEN", "展示模式或目前角色不能操作正式填答。", 403);
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw failure();
  return { actor, supabase };
}
export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const { actor, supabase } = await authorize("care_records.read");
    const url = new URL(request.url);
    const query = z.object({ clientId: z.uuid(), before: z.iso.datetime({ offset: true }).optional(), beforeId: z.uuid().optional() }).strict().refine((v) => Boolean(v.before) === Boolean(v.beforeId)).safeParse(Object.fromEntries(url.searchParams));
    if (!query.success || [...url.searchParams.keys()].some((k) => url.searchParams.getAll(k).length > 1)) throw new IntegrationError("INVALID_CUSTOM_RESPONSE", "請選擇有效個案與歷史頁碼。", 400);
    const { data, error } = await runCustomDraftRpc(supabase.rpc("read_custom_form_responses", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_client: query.data.clientId, p_before: query.data.before ?? null, p_before_id: query.data.beforeId ?? null,
    }));
    if (error) throw failure(error.code);
    return ok({ snapshot: parseResponseSnapshot(data, query.data.clientId), demo: false }, 200, requestId);
  });
}
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    // Reject anonymous requests before parsing content. The action-specific
    // authorization below still enforces write/sign scope and fresh signature proof.
    await authorizeStaffRequest({ routinePermission: "care_records.read" });
    const body = await readJsonObject(request, 70 * 1024);
    const parsed = z.object({ clientId: z.uuid(), input: responseInputSchema }).strict().safeParse(body);
    const key = z.uuid().safeParse(request.headers.get("idempotency-key"));
    if (!parsed.success || !key.success) throw new IntegrationError("INVALID_CUSTOM_RESPONSE", "請確認個案、操作識別碼與表單內容。", 400);
    const { clientId, input } = parsed.data;
    const { actor, supabase } = await authorize(input.action === "sign" ? "care_records.sign" : "care_records.write");
    if (input.action === "sign") await requireRecentAal2(actor);
    const { data, error } = await runCustomDraftRpc(supabase.rpc("write_custom_form_response", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: clientId, p_key: key.data, p_input: input }));
    if (error) throw failure(error.code);
    const receipt = parseResponseReceipt(data, input, clientId, actor.userId);
    return ok({ receipt, persisted: true, demo: false }, receipt.replayed ? 200 : 201, requestId);
  });
}
