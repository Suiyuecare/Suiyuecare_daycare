import { ok } from "@/lib/api/response";
import { isSyntheticReadMode } from "@/lib/env";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { parseDataInventoryMutation, parseDataInventoryReceipt } from "@/lib/data-inventory/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    if (isSyntheticReadMode()) throw new IntegrationError("DEMO_READ_ONLY", "試用模式僅顯示合成盤點，不保存任何資料。", 403);
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "試用模式不保存資料。", 403);
    if (!actor.scopes.includes("audit.view") || !actor.roles.some((r) => r === "organization_manager" || r === "branch_supervisor")) throw new IntegrationError(
      "DATA_INVENTORY_NOT_AUTHORIZED", "僅具稽核權限的管理員可操作盤點。", 403);
    const input = parseDataInventoryMutation(await readJsonObject(request, 12_000), request.headers.get("idempotency-key"));
    if (input.request.action === "verify") await requireRecentAal2(actor);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式盤點資料服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("mutate_data_inventory", { p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId, p_request: input.request, p_idempotency_key: input.idempotencyKey });
    if (error || !data) {
      if (error?.code === "42501") throw databaseFailure("DATA_INVENTORY_NOT_AUTHORIZED", "角色、分支、工作階段或獨立覆核條件不允許此操作。", 403);
      if (error?.code === "40001") throw databaseFailure("DATA_INVENTORY_VERSION_CONFLICT", "盤點版本已更新，請重新載入後確認。", 409);
      if (error?.code === "23505") throw databaseFailure("DATA_INVENTORY_IDEMPOTENCY_CONFLICT", "相同操作識別碼已用於不同內容。", 409);
      if (["23514", "22023", "22P02", "22007", "22008"].includes(error?.code ?? "")) throw databaseFailure("INVALID_DATA_INVENTORY", "欄位、原因或人工核對清單尚未通過驗證。", 400);
      throw databaseFailure("DATA_INVENTORY_RESULT_UNCERTAIN", "尚未確認保存結果，請保留相同操作識別碼重試。", 409);
    }
    const result = parseDataInventoryReceipt(data, { ...input, organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId });
    return ok(result, result.replayed ? 200 : 201, requestId);
  });
}
