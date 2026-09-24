import { isDeepStrictEqual } from "node:util";
import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { getTenantContext } from "@/lib/auth/context";
import { authorizeRoutineIntake } from "@/lib/auth/routine-intake";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseTaipeiIdentity, parseTaipeiMutation, validateTaipeiSnapshot } from "@/lib/taipei-abcd/parser";
import type { TaipeiDraft } from "@/lib/taipei-abcd/types";
import type { TenantContext } from "@/lib/domain/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function authorize(write: boolean) {
  const actor = await getTenantContext("staff");
  if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會讀寫正式個案表單。", 403);
  if (!["clients.read", "abcd_assessments.read", ...(write ? ["abcd_assessments.manage"] : [])].every(p => actor.scopes.includes(p)))
    throw new IntegrationError("TAIPEI_ABCD_NOT_AUTHORIZED", "目前角色無法處理這份個案表單，請聯絡主管確認權限。", 403);
  return actor;
}
function requireFormFields(actor: TenantContext, form: string) {
  if (form === "A" && !actor.scopes.includes("clients.demographics.read")) {
    throw new IntegrationError("TAIPEI_ABCD_NOT_AUTHORIZED", "A 表包含基本資料與聯絡人，需要個案敏感基本資料查閱權限。", 403);
  }
}
function dbError(code?: string) {
  if (code === "42501") return databaseFailure("TAIPEI_ABCD_NOT_AUTHORIZED", "目前帳號、分支或個案範圍不允許此操作；C 表也需要量測與照顧紀錄查閱權限。", 403);
  if (["40001", "23505"].includes(code ?? "")) return databaseFailure("TAIPEI_ABCD_VERSION_CONFLICT", "資料版本已改變或重試內容不一致。請保留草稿，重新載入最新版本後核對。", 409);
  if (["22023", "22P02", "23514"].includes(code ?? "")) return databaseFailure("INVALID_TAIPEI_ABCD_DRAFT", "表單欄位或資料狀態不正確，請核對後再儲存。", 400);
  return databaseFailure("TAIPEI_ABCD_RESULT_UNCERTAIN", "目前無法確認儲存結果。請保留畫面，使用相同內容重試。", 503);
}
export async function GET(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const actor = await authorize(false);
    const identity = parseTaipeiIdentity(new URL(request.url).searchParams);
    requireFormFields(actor, identity.form);
    if (actor.assuranceLevel !== "aal2") await authorizeRoutineIntake("abcd.read", identity.clientId);
    const client = await createServerSupabaseClient();
    if (!client) throw dbError();
    const { data, error } = await client.rpc("taipei_abcd_draft_snapshot", { p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId, p_client_id: identity.clientId, p_form: identity.form, p_usage_year: identity.usageYear, p_month: identity.month });
    if (error || !data) throw dbError(error?.code);
    const snapshot = validateTaipeiSnapshot(data, { organizationId: actor.organizationId, branchId: actor.branchId!, ...identity });
    return ok(snapshot, 200, requestId);
  });
}
export async function POST(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const actor = await authorize(true);
    const input = parseTaipeiMutation(await readJsonObject(request, 300000), request.headers.get("idempotency-key"));
    requireFormFields(actor, input.form);
    if (actor.assuranceLevel !== "aal2") await authorizeRoutineIntake("abcd.save", input.client_id);
    const client = await createServerSupabaseClient();
    if (!client) throw dbError();
    const { data, error } = await client.rpc("save_taipei_abcd_draft", { p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId, p_payload: input, p_idempotency_key: input.idempotency_key });
    if (error || !data) throw dbError(error?.code);
    const result = data as { draft: TaipeiDraft; idempotencyKey: string; replayed: boolean };
    if (result.idempotencyKey !== input.idempotency_key || typeof result.replayed !== "boolean") throw dbError();
    validateTaipeiSnapshot({ organizationId: actor.organizationId, branchId: actor.branchId, clientId: input.client_id,
      form: input.form, usageYear: input.usage_year, month: input.month, latest: result.draft, history: [], currentSources: null, canEdit: true },
    { organizationId: actor.organizationId, branchId: actor.branchId!, clientId: input.client_id, form: input.form, usageYear: input.usage_year, month: input.month });
    if (result.draft.version !== input.expected_version + 1 || !isDeepStrictEqual(result.draft.answers, input.answers)) throw dbError();
    return ok(result, result.replayed ? 200 : 201, requestId);
  });
}
