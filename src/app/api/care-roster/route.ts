import { ok } from "@/lib/api/response";
import { authorizeCompletionActor, canUseRoutineCompletion } from "@/lib/auth/routine-completion";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { parseRosterInput } from "@/lib/care-roster/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { boundedRosterRpc, rosterReceiptMatches } from "@/lib/care-roster/write-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeCompletionActor();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會改動正式每日分工。", 403);
    if (!["staff_scheduling.manage", "clients.read", "clients.view_all"].every((scope) => actor.scopes.includes(scope))) throw new IntegrationError("ROSTER_FORBIDDEN", "只有授權主管可安排每日分工。", 403);
    if (!(await canUseRoutineCompletion(actor, "roster.manage"))) await requireRecentAal2(actor);
    if (request.headers.get("x-care-roster-action") !== "approve_assignment") throw new IntegrationError("INVALID_ROSTER_ACTION", "請從每日分工表操作。", 400);
    const input = parseRosterInput(await readJsonObject(request, 8192));
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "每日分工暫時無法儲存，請稍後重試。", 503);
    const result = await boundedRosterRpc((signal) => supabase.rpc("save_care_roster", {
      p_organization_id: actor.organizationId, p_branch_id: actor.branchId, p_input: input,
    }).abortSignal(signal).maybeSingle<{ receipt: unknown }>()).catch(() => {
      throw databaseFailure("ROSTER_RESULT_UNCERTAIN", "尚無法確認分工已儲存，請保留目前內容並以原操作重試。", 503);
    });
    const { data, error } = result;
    if (error) {
      if (error.code === "42501") throw databaseFailure("ROSTER_FORBIDDEN", "所選人員或個案不在可安排範圍，請主管確認授權。", 403);
      if (["40001", "23505", "23514"].includes(error.code)) throw databaseFailure("ROSTER_CONFLICT", "分工資料已變更或當日不適用服務；請重新載入人工核對後再操作。", 409);
      if (error.code === "22023") throw databaseFailure("ROSTER_REJECTED", "分工欄位未通過驗證，請核對輸入。", 400);
      throw databaseFailure("ROSTER_RESULT_UNCERTAIN", "尚無法確認分工已儲存，請保留目前內容並以原操作重試。", 503);
    }
    const receipt = rosterReceiptMatches(data?.receipt, input);
    if (!receipt) throw databaseFailure("ROSTER_RESULT_UNCERTAIN", "尚無法確認分工已儲存，請保留目前內容並以原操作重試。", 503);
    return ok({ receipt, persisted: true, demo: false }, receipt.replayed ? 200 : 201, requestId);
  });
}
