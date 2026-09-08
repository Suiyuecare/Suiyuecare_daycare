import { ok } from "@/lib/api/response";
import {
  classifyClaimExportDatabaseFailure,
  parseClaimExportRequest,
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

type ExportClaimResult = {
  claim_batch_id: string;
  format_version: string;
  status: string;
  snapshot_hash: string;
  item_count: number;
  total_amount: string | number;
  replayed: boolean;
};

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
      .maybeSingle<ExportClaimResult>();

    if (error || !data) {
      const failure = classifyClaimExportDatabaseFailure(error?.code);
      throw databaseFailure(
        failure.code,
        failure.message,
        failure.httpStatus,
      );
    }

    return ok(
      {
        claimBatchId: data.claim_batch_id,
        snapshotHash: data.snapshot_hash,
        itemCount: data.item_count,
        totalAmount: String(data.total_amount),
        formatVersion: data.format_version,
        status: data.status,
        replayed: data.replayed,
        persisted: true,
        demo: false,
      },
      200,
      requestId,
    );
  });
}
