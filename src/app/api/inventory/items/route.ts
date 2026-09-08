import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import { deterministicUuid } from "@/lib/integrations/security";
import {
  INVENTORY_ITEM_MAX_BYTES,
  parseInventoryItemInput,
  parseInventoryItemReceipt,
} from "@/lib/inventory/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saveFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "INVENTORY_ITEM_NOT_AUTHORIZED", "目前角色、機構或分支不允許管理此品項。", 403,
  );
  if (code === "23505") return databaseFailure(
    "INVENTORY_ITEM_IDEMPOTENCY_CONFLICT", "品項代碼重複，或相同操作鍵已用於不同內容。", 409,
  );
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "INVENTORY_ITEM_VERSION_CONFLICT", "品項狀態已變更；請重新載入。", 409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_INVENTORY_ITEM", "品項代碼、名稱、單位或停用理由未通過驗證。", 400,
  );
  return databaseFailure(
    "INVENTORY_ITEM_SAVE_UNCERTAIN", "品項保存未確認完成；請保留相同操作鍵重試。", 409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY", "展示模式只能檢視合成庫存，不會建立或停用品項。", 403,
    );
    if (!actor.scopes.includes("inventory.read") ||
      !actor.scopes.includes("inventory.manage")) throw new IntegrationError(
      "INVENTORY_ITEM_NOT_AUTHORIZED", "目前角色沒有庫存管理權限。", 403,
    );
    const input = parseInventoryItemInput(
      await readJsonObject(request, INVENTORY_ITEM_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式庫存資料服務尚未設定。", 503,
    );
    const operationKey = deterministicUuid(
      "page77-inventory-item", actor.organizationId, actor.userId, input.idempotencyKey,
    );
    const result = input.action === "create"
      ? await supabase.rpc("create_inventory_item", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_item_code: input.itemCode, p_item_name: input.itemName,
        p_unit: input.unit, p_idempotency_key: operationKey,
      }).maybeSingle()
      : await supabase.rpc("set_inventory_item_status", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId, p_item_id: input.itemId,
        p_status: input.status, p_reason: input.reason,
        p_expected_status_ledger_version: input.expectedStatusLedgerVersion,
        p_idempotency_key: operationKey,
      }).maybeSingle();
    if (result.error || !result.data) throw saveFailure(result.error?.code);
    const receipt = parseInventoryItemReceipt(
      result.data, input, actor.organizationId, actor.branchId,
    );
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
