import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute,
  readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { CLIENT_SERVICE_PLAN_MUTATION_MAX_BYTES, clientServicePlanMutationArgs,
  parseClientServicePlanMutation, parseClientServicePlanReceipt } from
  "@/lib/client-service-plan-workflow/parser";
import type { ClientServicePlanAction } from "@/lib/client-service-plan-workflow/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApiRequestId = ReturnType<typeof import("node:crypto").randomUUID>;

function declaredOperation(request: Request): ClientServicePlanAction {
  const value = request.headers.get("x-client-service-plan-operation");
  if (!value || !["create_draft","revise_draft","approve","sign","void"].includes(value)) {
    throw new IntegrationError("INVALID_CLIENT_SERVICE_PLAN_OPERATION",
      "缺少或不支援的個案服務計畫受治理操作標頭。", 400,
      "x-client-service-plan-operation");
  }
  return value as ClientServicePlanAction;
}

async function authorize(operation: ClientServicePlanAction): Promise<TenantContext> {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
    "展示模式僅顯示合成個案服務計畫，不會寫入正式資料。", 403);
  const required = ["clients.read", "care_plans.read", "care_plans.write",
    ...(operation === "approve" || operation === "void" ? ["care_plans.approve"] : []),
    ...(operation === "sign" || operation === "void" ? ["care_plans.sign"] : [])];
  if (actor.assuranceLevel !== "aal2" || required.some((scope) => !actor.scopes.includes(scope))) {
    throw new IntegrationError("CLIENT_SERVICE_PLAN_NOT_AUTHORIZED",
      "目前角色、分支或 AAL2 工作階段不允許這項個案服務計畫操作。", 403);
  }
  if (["approve","sign","void"].includes(operation)) await requireRecentAal2(actor);
  return actor;
}

function failure(code?: string) {
  if (code === "42501") return databaseFailure("CLIENT_SERVICE_PLAN_NOT_AUTHORIZED",
    "目前角色、分支、個案指派、負責人資格或工作階段不允許這項操作。", 403);
  if (code === "40001") return databaseFailure("CLIENT_SERVICE_PLAN_VERSION_CONFLICT",
    "最新版本、核定來源或內容指紋已改變；請重新載入後再操作。", 409);
  if (code === "23505") return databaseFailure("CLIENT_SERVICE_PLAN_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同內容，或計畫版本鏈已存在。", 409);
  if (["23514","23503","23P01","55000"].includes(code ?? "")) return databaseFailure(
    "CLIENT_SERVICE_PLAN_STATE_CONFLICT",
    "計畫狀態、生效期間、核定來源、版本鏈或重疊規則不允許這項操作。", 409);
  if (["22023","22P02","22007","22008"].includes(code ?? "")) return databaseFailure(
    "INVALID_CLIENT_SERVICE_PLAN_OPERATION", "目標、措施、日期、負責人或版本欄位未通過驗證。", 400);
  return databaseFailure("CLIENT_SERVICE_PLAN_RESULT_UNCERTAIN",
    "個案服務計畫結果尚未確認；請保留原內容與操作鍵重試。", 409);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId: ApiRequestId) => {
    const operation = declaredOperation(request);
    const actor = await authorize(operation);
    const input = parseClientServicePlanMutation(
      await readJsonObject(request, CLIENT_SERVICE_PLAN_MUTATION_MAX_BYTES),
      request.headers.get("idempotency-key"));
    if (input.action !== operation) throw new IntegrationError(
      "INVALID_CLIENT_SERVICE_PLAN_OPERATION",
      "受治理操作標頭與個案服務計畫內容不一致。", 400);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED",
      "正式個案服務計畫服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("mutate_client_service_plan_workflow", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      ...clientServicePlanMutationArgs(input),
    }).maybeSingle();
    if (error || !data) throw failure(error?.code);
    const result = parseClientServicePlanReceipt(data, input,
      actor.organizationId, actor.branchId);
    return ok(result, result.replayed ? 200 : 201, requestId);
  });
}
