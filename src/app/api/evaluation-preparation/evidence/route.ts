import { ok } from "@/lib/api/response";
import { evaluationEvidenceActionSchema, evaluationEvidenceActionReceiptSchema } from "@/lib/evaluation-preparation/contract";
import { isSyntheticReadMode } from "@/lib/env";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    await requireRecentAal2(actor);
    if (actor.demo || isSyntheticReadMode() || !actor.scopes.includes("audit.view") || !actor.roles.some((role) => ["organization_manager", "branch_supervisor", "branch_director"].includes(role))) throw new IntegrationError("EVIDENCE_NOT_AUTHORIZED", "這個帳號不能覆核或固定證據。", 403);
    const input = evaluationEvidenceActionSchema.safeParse(await readJsonObject(request, 1024));
    if (!input.success || request.headers.get("idempotency-key") !== input.data.idempotency_key) throw new IntegrationError("INVALID_EVIDENCE_ACTION", "請確認項目與覆核原因。", 400);
    const client = await createServerSupabaseClient();
    if (!client) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "評鑑服務暫時不可用。", 503);
    const action = input.data;
    const scope = { p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId, p_idempotency_key: action.idempotency_key };
    const { data, error } = action.action === "review"
      ? await client.rpc("evaluation_evidence_review", { ...scope, p_version_id: action.versionId, p_decision: action.decision, p_reason_code: action.reasonCode })
      : await client.rpc("evaluation_evidence_bundle", { ...scope, p_expected_hash: action.expectedHash });
    if (error) {
      if (error.code === "42501") throw new IntegrationError("EVIDENCE_NOT_AUTHORIZED", "請由另一位具權限的主管覆核；並確認證據查閱權限。", 403);
      if (error.code === "40001") throw new IntegrationError("EVIDENCE_VERSION_CHANGED", "項目或證據已更新，請重新載入後核對。", 409);
      if (error.code === "23505") throw new IntegrationError("EVIDENCE_KEY_CONFLICT", "原操作識別碼與內容不一致。", 409);
      if (["22023", "23514"].includes(error.code)) throw new IntegrationError("EVIDENCE_INCOMPLETE", "證據未完成掃毒、來源未定稿，或尚有項目未通過覆核。", 400);
      throw new IntegrationError("EVIDENCE_RESULT_UNCERTAIN", "結果尚未確認，請用原操作重試。", 409);
    }
    const parsed = evaluationEvidenceActionReceiptSchema.safeParse(data);
    if (!parsed.success || parsed.data.organizationId !== actor.organizationId || parsed.data.branchId !== actor.branchId ||
      parsed.data.actorUserId !== actor.userId || parsed.data.idempotencyKey !== action.idempotency_key ||
      (action.action === "review" ? parsed.data.versionId !== action.versionId || parsed.data.decision !== action.decision || !parsed.data.reviewId : parsed.data.hash !== action.expectedHash || !parsed.data.bundleId)) throw new IntegrationError("EVIDENCE_RESULT_UNCERTAIN", "回執無法核對，請用原操作重試。", 409);
    return ok(parsed.data, 200, requestId);
  });
}
