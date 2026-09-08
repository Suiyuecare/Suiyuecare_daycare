import { ok } from "@/lib/api/response";
import { parseClaimValidationRequest } from "@/lib/integrations/claims";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { deterministicUuid } from "@/lib/integrations/security";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseClaimValidationDatabaseReceipt } from "@/lib/service-management/claim-validation-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (!actor.demo && !actor.scopes.includes("claims.manage")) {
      throw new IntegrationError("CLAIM_VALIDATION_NOT_AUTHORIZED",
        "目前角色沒有申報驗證權限。", 403);
    }
    await requireRecentAal2(actor);
    const input = parseClaimValidationRequest(
      await readJsonObject(request, 32 * 1024),
      request.headers.get("idempotency-key"),
    );

    if (actor.demo) {
      return ok(
        {
          claimBatchId: input.claimBatchId,
          idempotencyKey: input.idempotencyKey,
          itemCount: null,
          totalAmount: input.expectedTotalAmount,
          status: "draft",
          replayed: false,
          persisted: false,
          demo: true,
        },
        200,
        requestId,
      );
    }

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式申報服務尚未設定。",
        503,
      );
    }

    const databaseIdempotencyKey = deterministicUuid(actor.organizationId,
      actor.userId, "claim-validate", input.idempotencyKey);
    const { data, error } = await supabase
      .rpc("validate_claim_batch_receipt", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_claim_batch_id: input.claimBatchId,
        p_expected_total_amount: input.expectedTotalAmount,
        p_expected_item_count: input.expectedItemCount,
        p_idempotency_key: databaseIdempotencyKey,
      })
      .maybeSingle<unknown>();

    if (error || !data) {
      const unauthorized = error?.code === "42501";
      const conflict = error?.code === "23505";
      const alreadyCompleted = error?.code === "P2001";
      const invalid = ["22023", "23514", "55000"].includes(
        error?.code ?? "",
      );
      throw databaseFailure(
        unauthorized
          ? "CLAIM_VALIDATION_NOT_AUTHORIZED"
          : conflict
            ? "CLAIM_VALIDATION_IDEMPOTENCY_CONFLICT"
            : alreadyCompleted
              ? "CLAIM_VALIDATION_ALREADY_COMPLETED"
            : invalid
              ? "CLAIM_VALIDATION_REJECTED"
              : "CLAIM_VALIDATION_FAILED",
        unauthorized
          ? "目前角色或重新驗證狀態不允許驗證申報。"
          : conflict
            ? "相同冪等鍵曾用於不同的申報驗證內容。"
            : alreadyCompleted
              ? "此批次已由另一項操作完成驗證，請重新載入最新狀態。"
            : invalid
              ? "申報明細、服務證據、計畫版本、確認筆數或總額未通過驗證。"
              : "申報批次的驗證結果尚未確認；請保留原批次、金額與操作鍵重新核對。",
        unauthorized ? 403 : invalid ? 422 : 409,
      );
    }

    let receipt;
    try { receipt = parseClaimValidationDatabaseReceipt(data, { ...input,
      organizationId: actor.organizationId, branchId: actor.branchId!, databaseIdempotencyKey }); }
    catch {
      throw databaseFailure("CLAIM_VALIDATION_RECEIPT_INVALID",
        "申報驗證回執不完整；結果尚未確認，請以相同操作鍵重試。", 502);
    }
    return ok(
      {
        claimBatchId: receipt.claim_batch_id,
        idempotencyKey: input.idempotencyKey,
        status: receipt.status,
        itemCount: receipt.item_count,
        totalAmount: receipt.total_amount,
        replayed: receipt.replayed,
        persisted: true,
        demo: false,
      },
      200,
      requestId,
    );
  });
}
