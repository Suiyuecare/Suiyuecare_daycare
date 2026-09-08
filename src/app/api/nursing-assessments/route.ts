import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { parseNursingReceipt, parseNursingRequest } from "@/lib/nursing-assessments/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function mutate(request: Request, create: boolean) {
  return handleIntegrationRoute(async (requestId) => {
    const operation = request.headers.get("x-nursing-operation");
    if (create ? operation !== "create_draft" : !["revise_draft", "sign", "correct"].includes(operation ?? "")) {
      throw new IntegrationError("INVALID_NURSING_ASSESSMENT", "缺少或不支援的護理操作標頭。", 400);
    }
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示護理評估為合成唯讀資料。", 403);
    const signing = operation === "sign" || operation === "correct";
    const permission = signing ? "nursing_assessments.sign" : "nursing_assessments.manage";
    if (!actor.roles.includes("nurse") || !actor.scopes.includes("clients.read") ||
      !actor.scopes.includes("nursing_assessments.read") || !actor.scopes.includes(permission)) {
      throw new IntegrationError("NURSING_NOT_AUTHORIZED", "目前護理身分與權限不允許這項操作。", 403);
    }
    if (signing) await requireRecentAal2(actor);
    const input = parseNursingRequest(await readJsonObject(request, 128 * 1024), request.headers.get("idempotency-key"));
    if (input.request.action !== operation) throw new IntegrationError("INVALID_NURSING_ASSESSMENT", "操作標頭與內容不一致。", 400);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式護理評估尚未設定。", 503);
    const { data, error } = await supabase.rpc("mutate_nursing_assessment", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
      p_request: input.request, p_idempotency_key: input.idempotencyKey,
    });
    if (error || !data) {
      const code = error?.code;
      if (code === "42501") throw new IntegrationError("NURSING_NOT_AUTHORIZED", "目前機構、分支、護理身分、個案指派或近期驗證不允許這項操作。", 403);
      if (code === "40001") throw new IntegrationError("NURSING_VERSION_CONFLICT", "紀錄已有新版本，請重新載入後再操作。", 409);
      if (code === "23505") throw new IntegrationError("NURSING_IDEMPOTENCY_CONFLICT", "此操作識別碼已用於其他內容；請保留內容並重新載入。", 409);
      if (["23514", "55000", "23503"].includes(code ?? "")) throw new IntegrationError("NURSING_STATE_CONFLICT", "版本狀態已改變；已簽紀錄須以更正方式追加。", 409);
      if (["22023", "22003", "23502"].includes(code ?? "")) throw new IntegrationError("INVALID_NURSING_ASSESSMENT", "護理內容、日期或更正理由未通過驗證。", 400);
      throw new IntegrationError("NURSING_SAVE_UNCONFIRMED", "尚未確認儲存完成；請保留內容，以相同操作識別碼重試。", 502);
    }
    const receipt = parseNursingReceipt(data, { ...input, organizationId: actor.organizationId,
      branchId: actor.branchId, actorUserId: actor.userId });
    return ok(receipt, receipt.replayed ? 200 : 201, requestId);
  });
}
export async function POST(request: Request) { return mutate(request, true); }
export async function PATCH(request: Request) { return mutate(request, false); }
