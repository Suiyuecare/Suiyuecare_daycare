import { z } from "zod";
import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { authorizeRoutineIntake } from "@/lib/auth/routine-intake";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addDays, weeklyInputSchema, weeklyReceiptSchema, weeklySnapshotSchema } from "@/lib/client-weekly/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await getTenantContext("staff");
    if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會查詢正式週表。", 403);
    if (!actor.branchId || !actor.scopes.includes("clients.read")) throw new IntegrationError("WEEKLY_FORBIDDEN", "無法查看此分支的個案安排。", 403);
    const query = new URL(request.url).searchParams;
    const parsed = z.object({ client: z.uuid(), from: z.iso.date() }).safeParse({ client: query.get("client"), from: query.get("from") });
    if (!parsed.success) throw new IntegrationError("INVALID_WEEKLY_QUERY", "請選擇個案及有效日期。", 400);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("WEEKLY_UNAVAILABLE", "每週安排暫時無法讀取，請稍後重試。", 503);
    const { data, error } = await supabase.rpc("client_weekly_snapshot", { p_organization_id: actor.organizationId, p_branch_id: actor.branchId, p_client_id: parsed.data.client, p_from: parsed.data.from }).maybeSingle<{ payload: unknown }>();
    if (error) throw databaseFailure(error.code === "42501" ? "WEEKLY_FORBIDDEN" : "WEEKLY_UNAVAILABLE", "每週安排無法讀取，請確認個案授權或稍後重試。", error.code === "42501" ? 403 : 503);
    const result = weeklySnapshotSchema.safeParse(data?.payload);
    if (!result.success || result.data.clientId !== parsed.data.client || result.data.from !== parsed.data.from || result.data.days.some((day, i) => day.date !== addDays(parsed.data.from, i))) throw databaseFailure("WEEKLY_RESULT_UNCERTAIN", "讀回的安排資料不完整，請重新載入。", 502);
    return ok(result.data, 200, requestId);
  });
}
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    if (request.headers.get("x-client-weekly-action") !== "save") throw new IntegrationError("INVALID_WEEKLY_ACTION", "請從個案每週安排操作。", 400);
    const parsed = weeklyInputSchema.safeParse(await readJsonObject(request, 32768));
    if (!parsed.success) throw new IntegrationError("INVALID_WEEKLY_INPUT", "請確認星期、到離站時間、接送時間窗、聯絡方式及異動理由。", 400);
    const actor = await authorizeRoutineIntake("weekly.write", parsed.data.clientId);
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會寫入正式個案安排。", 403);
    if (!["clients.read", "staff_scheduling.manage"].every((s) => actor.scopes.includes(s))) throw new IntegrationError("WEEKLY_FORBIDDEN", "需要個案與排程管理授權才能修改。", 403);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("WEEKLY_UNAVAILABLE", "每週安排暫時無法儲存，請稍後重試。", 503);
    const databaseResult = await Promise.resolve().then(() => supabase.rpc("save_client_weekly", { p_organization_id: actor.organizationId, p_branch_id: actor.branchId, p_input: parsed.data }).maybeSingle<{ receipt: unknown }>())
      .catch(() => { throw databaseFailure("WEEKLY_RESULT_UNCERTAIN", "尚未確認儲存結果，請保留內容並使用原操作重試。", 503); });
    const { data, error } = databaseResult;
    if (error) {
      if (error.code === "42501") throw databaseFailure("WEEKLY_FORBIDDEN", "目前沒有此個案的排程修改授權。", 403);
      if (["40001", "23505"].includes(error.code ?? "")) throw databaseFailure("WEEKLY_CONFLICT", "安排版本或原操作已有異動；請保留草稿並讀取目前版本核對。", 409);
      if (["22023", "23514", "22007", "22008"].includes(error.code ?? "")) throw databaseFailure("INVALID_WEEKLY_INPUT", "安排欄位或日期未通過驗證，請核對後再儲存。", 400);
      // Network failures and timeouts are not proof that an earlier call rolled
      // back. Only known database conflicts may unlock explicit rebase review.
      throw databaseFailure("WEEKLY_RESULT_UNCERTAIN", "尚未確認儲存結果，請保留內容並使用原操作重試。", 503);
    }
    const result = weeklyReceiptSchema.safeParse(data?.receipt);
    if (!result.success || result.data.clientId !== parsed.data.clientId || result.data.action !== parsed.data.action || result.data.version !== parsed.data.expectedVersion + 1) throw databaseFailure("WEEKLY_RESULT_UNCERTAIN", "尚無法確認安排已儲存，請保留內容並使用原操作重試。", 503);
    return ok({ receipt: result.data }, result.data.replayed ? 200 : 201, requestId);
  });
}
