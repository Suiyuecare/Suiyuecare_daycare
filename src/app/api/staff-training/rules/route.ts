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
  parseStaffTrainingRuleInput,
  parseStaffTrainingRuleReceipt,
  STAFF_TRAINING_RULE_MAX_BYTES,
} from "@/lib/staff-training/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saveFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "STAFF_TRAINING_RULE_NOT_AUTHORIZED",
    "目前角色、分支、雙人覆核或近期雙因素驗證不允許此規則操作。",
    403,
  );
  if (code === "23505") return databaseFailure(
    "STAFF_TRAINING_RULE_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同的訓練規則內容。",
    409,
  );
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "STAFF_TRAINING_RULE_CONFLICT",
    "規則版本、期間或待覆核提案已變更；請重新載入。",
    409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_STAFF_TRAINING_RULE",
    "訓練規則期間、視窗、積分或提醒天數未通過驗證。",
    400,
  );
  return databaseFailure(
    "STAFF_TRAINING_RULE_SAVE_UNCERTAIN",
    "訓練規則結果未確認；請保留相同操作鍵重試。",
    409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    // Rules are high-risk: tenant, scope and recent AAL2 precede body parsing.
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只能檢視合成規則，不會建立或發布。",
      403,
    );
    if (!actor.scopes.includes("staff_training.read") ||
      !actor.scopes.includes("staff_training.rules")) throw new IntegrationError(
      "STAFF_TRAINING_RULE_NOT_AUTHORIZED",
      "目前角色沒有教育訓練規則治理權限。",
      403,
    );
    await requireRecentAal2(actor);

    const input = parseStaffTrainingRuleInput(
      await readJsonObject(request, STAFF_TRAINING_RULE_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式教育訓練規則服務尚未設定。",
      503,
    );
    const operationKey = deterministicUuid(
      "page71-staff-training-rule",
      actor.organizationId,
      actor.userId,
      input.idempotencyKey,
    );
    const result = input.action === "propose"
      ? await supabase.rpc("propose_staff_training_rule", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_effective_from: input.effectiveFrom,
        p_effective_to: input.effectiveTo,
        p_window_years: input.windowYears,
        p_required_credits: input.requiredCredits,
        p_expiry_notice_days: input.expiryNoticeDays,
        p_idempotency_key: operationKey,
      }).maybeSingle()
      : await supabase.rpc("publish_staff_training_rule", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_proposal_id: input.proposalId,
        p_idempotency_key: operationKey,
      }).maybeSingle();
    if (result.error || !result.data) throw saveFailure(result.error?.code);
    const receipt = parseStaffTrainingRuleReceipt(
      result.data,
      input,
      actor.organizationId,
      actor.branchId,
    );
    return ok(
      { receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201,
      requestId,
    );
  });
}
