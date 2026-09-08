import { ok } from "@/lib/api/response";
import {
  INDIVIDUAL_PLAN_MAX_BYTES,
  individualPlanDatabaseItems,
  parseIndividualPlanInput,
  parseIndividualPlanResult,
} from "@/lib/integrations/individual-service-plans";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function writeFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "INDIVIDUAL_PLAN_NOT_AUTHORIZED",
    "目前角色、分支、個案指派、負責人範圍或 AAL2 不允許簽署。",
    403,
  );
  if (code === "23505") return databaseFailure(
    "INDIVIDUAL_PLAN_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同內容。",
    409,
  );
  if (["22023", "22P02", "23514"].includes(code ?? "")) return databaseFailure(
    "INVALID_INDIVIDUAL_PLAN",
    "月份、版本鏈或計畫項目不符合規則。",
    400,
  );
  return databaseFailure(
    "INDIVIDUAL_PLAN_SAVE_FAILED",
    "服務計畫未確認完成；請保留內容與相同操作鍵重試。",
    409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    // Authentication and scope checks intentionally happen before body reads.
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只提供合成資料檢視，不會寫入或假裝成功。",
      403,
    );
    if (
      !actor.scopes.includes("clients.read") ||
      !actor.scopes.includes("care_plans.write") ||
      !actor.scopes.includes("care_plans.sign")
    ) throw new IntegrationError(
      "INDIVIDUAL_PLAN_NOT_AUTHORIZED",
      "目前角色沒有建立及簽署個別化服務計畫的權限。",
      403,
    );
    await requireRecentAal2(actor);
    const input = parseIndividualPlanInput(
      await readJsonObject(request, INDIVIDUAL_PLAN_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式服務計畫資料服務尚未設定。",
      503,
    );
    const { data, error } = await supabase.rpc("record_individual_service_plan", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_plan_month: `${input.planMonth}-01`,
      p_previous_plan_id: input.previousPlanId,
      p_correction_reason: input.correctionReason,
      p_items: individualPlanDatabaseItems(input),
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw writeFailure(error.code);
    const result = parseIndividualPlanResult(data, input);
    return ok(result, result.replayed ? 200 : 201, requestId);
  });
}
