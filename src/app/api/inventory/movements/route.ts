import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { deterministicUuid } from "@/lib/integrations/security";
import {
  INVENTORY_MOVEMENT_MAX_BYTES,
  parseInventoryMovementInput,
  parseInventoryMovementReceipt,
} from "@/lib/inventory/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saveFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "INVENTORY_MOVEMENT_NOT_AUTHORIZED",
    "目前角色、分支、個案範圍、人員資格或近期雙因素驗證不允許此異動。", 403,
  );
  if (code === "23505") return databaseFailure(
    "INVENTORY_MOVEMENT_IDEMPOTENCY_CONFLICT", "相同操作鍵已用於不同的庫存異動。", 409,
  );
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "INVENTORY_LEDGER_CONFLICT", "庫存版本、餘額、批次效期或退回數量已變更；請重新載入。", 409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_INVENTORY_MOVEMENT", "異動數量、批次、用途或追溯資料未通過驗證。", 400,
  );
  return databaseFailure(
    "INVENTORY_MOVEMENT_SAVE_UNCERTAIN",
    "庫存異動未確認完成；請保留相同操作鍵重試。", 409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY", "展示模式只能檢視合成庫存，不會寫入異動。", 403,
    );
    if (!actor.scopes.includes("inventory.read") ||
      !actor.scopes.includes("inventory.manage")) throw new IntegrationError(
      "INVENTORY_MOVEMENT_NOT_AUTHORIZED", "目前角色沒有庫存異動權限。", 403,
    );
    const input = parseInventoryMovementInput(
      await readJsonObject(request, INVENTORY_MOVEMENT_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    if (["adjustment", "stocktake"].includes(input.movementType)) {
      if (!actor.scopes.includes("inventory.adjust")) throw new IntegrationError(
        "INVENTORY_MOVEMENT_NOT_AUTHORIZED", "目前角色沒有調整或盤點權限。", 403,
      );
      await requireRecentAal2(actor);
    }
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式庫存資料服務尚未設定。", 503,
    );
    const { data, error } = await supabase.rpc("record_inventory_movement", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId, p_item_id: input.itemId,
      p_batch_id: input.batchId, p_new_batch_number: input.newBatchNumber,
      p_new_expiry_date: input.newExpiryDate, p_new_unit: input.newUnit,
      p_movement_type: input.movementType, p_quantity: input.quantity,
      p_adjustment_delta: input.adjustmentDelta,
      p_counted_quantity: input.countedQuantity,
      p_original_movement_id: input.originalMovementId, p_client_id: input.clientId,
      p_instruction_reference: input.instructionReference,
      p_issued_to_user_id: input.issuedToUserId, p_purpose: input.purpose,
      p_destination_unit: input.destinationUnit, p_reason: input.reason,
      p_occurred_at: input.occurredAt,
      p_expected_ledger_version: input.expectedLedgerVersion,
      p_idempotency_key: deterministicUuid(
        "page77-inventory-movement", actor.organizationId, actor.userId,
        input.idempotencyKey,
      ),
    }).maybeSingle();
    if (error || !data) throw saveFailure(error?.code);
    const receipt = parseInventoryMovementReceipt(
      data, input, actor.organizationId, actor.branchId,
    );
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
