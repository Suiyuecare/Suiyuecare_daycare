import { ok } from "@/lib/api/response";
import {
  CLAIM_OFFICIAL_RELEASE_GATE,
  classifyClaimExportDatabaseFailure,
  parseClaimExportRequest,
  parseClaimExportDatabaseReceipt,
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

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    await requireRecentAal2(actor);
    const input = parseClaimExportRequest(
      await readJsonObject(request),
      request.headers.get("idempotency-key"),
    );

    if (actor.demo) {
      return ok(
        {
          claimBatchId: input.claimBatchId,
          validated: true,
          amountVerified: false,
          snapshotCreated: false,
          persisted: false,
          demo: true,
          ...CLAIM_OFFICIAL_RELEASE_GATE,
        },
        200,
        requestId,
      );
    }

    if (
      !actor.scopes.includes("claims.manage") ||
      !actor.scopes.includes("claims.export")
    ) {
      throw new IntegrationError(
        "CLAIM_EXPORT_NOT_AUTHORIZED",
        "目前角色沒有申報匯出權限。",
        403,
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

    const databaseIdempotencyKey = deterministicUuid(
      actor.organizationId,
      actor.userId,
      "claim-export",
      input.idempotencyKey,
    );
    const { data, error } = await supabase
      .rpc("export_claim_batch", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_claim_batch_id: input.claimBatchId,
        p_expected_total_amount: input.expectedTotalAmount,
        p_idempotency_key: databaseIdempotencyKey,
      })
      .maybeSingle<unknown>();

    if (error || !data) {
      const failure = classifyClaimExportDatabaseFailure(error?.code);
      throw databaseFailure(
        failure.code,
        failure.message,
        failure.httpStatus,
      );
    }

    const receipt = parseClaimExportDatabaseReceipt(data, input);

    return ok(
      {
        claimBatchId: receipt.claim_batch_id,
        snapshotHash: receipt.snapshot_hash,
        itemCount: receipt.item_count,
        totalAmount: receipt.total_amount,
        formatVersion: receipt.format_version,
        status: receipt.status,
        replayed: receipt.replayed,
        persisted: true,
        demo: false,
        ...CLAIM_OFFICIAL_RELEASE_GATE,
      },
      200,
      requestId,
    );
  });
}
