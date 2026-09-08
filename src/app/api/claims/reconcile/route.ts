import { ok } from "@/lib/api/response";
import {
  MAX_CLAIM_RECONCILIATION_BYTES,
  parseClaimReconciliationRequest,
} from "@/lib/integrations/claims";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReconcileClaimResult = {
  claim_batch_id: string;
  status: string;
  item_count: number;
  accepted_count: number;
  rejected_count: number;
  total_amount: string | number;
  replayed: boolean;
};

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    await requireRecentAal2(actor);
    const input = parseClaimReconciliationRequest(
      await readJsonObject(request, MAX_CLAIM_RECONCILIATION_BYTES),
      request.headers.get("idempotency-key"),
    );

    if (actor.demo) {
      return ok(
        {
          claimBatchId: input.claimBatchId,
          resultCount: input.results.length,
          validated: true,
          amountVerified: false,
          reconciled: false,
          persisted: false,
          demo: true,
        },
        200,
        requestId,
      );
    }

    if (!actor.scopes.includes("claims.manage")) {
      throw new IntegrationError(
        "CLAIM_RECONCILIATION_NOT_AUTHORIZED",
        "目前角色沒有申報對帳權限。",
        403,
      );
    }

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式申報對帳服務尚未設定。",
        503,
      );
    }

    const databaseIdempotencyKey = deterministicUuid(
      actor.organizationId,
      actor.userId,
      "claim-reconcile",
      input.idempotencyKey,
    );
    const results = input.results.map((result) => ({
      claim_item_id: result.claimItemId,
      outcome: result.outcome,
      response_code: result.responseCode,
      response_message: result.responseMessage,
    }));
    const { data, error } = await supabase
      .rpc("reconcile_claim_batch", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_claim_batch_id: input.claimBatchId,
        p_expected_total_amount: input.expectedTotalAmount,
        p_results: results,
        p_idempotency_key: databaseIdempotencyKey,
      })
      .maybeSingle<ReconcileClaimResult>();

    if (error || !data) {
      throw databaseFailure(
        error?.code === "42501"
          ? "CLAIM_RECONCILIATION_NOT_AUTHORIZED"
          : error?.code === "23505"
            ? "CLAIM_RECONCILIATION_IDEMPOTENCY_CONFLICT"
            : error?.code === "P2001"
              ? "CLAIM_RECONCILIATION_ALREADY_COMPLETED"
            : "CLAIM_RECONCILIATION_FAILED",
        error?.code === "42501"
          ? "目前角色或重新驗證狀態不允許對帳。"
          : error?.code === "23505"
            ? "相同冪等鍵曾用於不同的申報對帳內容。"
            : error?.code === "P2001"
              ? "此批次已由另一項操作完成對帳，請重新載入最新狀態。"
            : "申報結果未完成對帳；請確認逐筆覆蓋與總額後，以相同冪等鍵重試。",
        error?.code === "42501" ? 403 : 409,
      );
    }

    return ok(
      {
        claimBatchId: data.claim_batch_id,
        status: data.status,
        itemCount: data.item_count,
        acceptedCount: data.accepted_count,
        rejectedCount: data.rejected_count,
        totalAmount: String(data.total_amount),
        replayed: data.replayed,
        persisted: true,
        demo: false,
      },
      200,
      requestId,
    );
  });
}
