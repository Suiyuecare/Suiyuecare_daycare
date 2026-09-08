import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import {
  parseTransportPlanMutation,
  parseTransportPlanReceipt,
  TRANSPORT_PLAN_MUTATION_MAX_BYTES,
  transportPlanMutationPayload,
} from "@/lib/transport-plans/parser";
import type { TransportPlanMutationInput } from "@/lib/transport-plans/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApiRequestId = ReturnType<typeof import("node:crypto").randomUUID>;
type DeclaredOperation = "save_trip" | "publish_trip" | "override_trip" | "reject_trip";

function requireOperationHeader(request: Request, allowed: readonly DeclaredOperation[]) {
  const operation = request.headers.get("x-transport-plan-operation");
  if (!allowed.includes(operation as DeclaredOperation)) throw new IntegrationError(
    "INVALID_TRANSPORT_PLAN_OPERATION",
    "缺少或不支援的交通計畫受治理操作標頭。", 400,
    "x-transport-plan-operation",
  );
  return operation as DeclaredOperation;
}

function transportFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "TRANSPORT_PLAN_NOT_AUTHORIZED",
    "目前角色、機構、分支、個案範圍或工作階段不允許這項交通計畫操作。", 403,
  );
  if (code === "55000") return databaseFailure(
    "TRANSPORT_PLAN_RULES_NOT_CONFIGURED",
    "所選日期的車輛容量或駕駛人工授權規則尚未完整發布，已停止操作。", 503,
  );
  if (code === "40001") return databaseFailure(
    "TRANSPORT_PLAN_VERSION_CONFLICT",
    "趟次版本、規則或目前已發布行程已改變；請重新載入後再操作。", 409,
  );
  if (code === "23505") return databaseFailure(
    "TRANSPORT_PLAN_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同交通計畫內容。", 409,
  );
  if (["23514", "23503", "23P01"].includes(code ?? "")) return databaseFailure(
    "TRANSPORT_PLAN_STATE_CONFLICT",
    "趟次、車輛、駕駛、乘員、衝突或審核狀態不允許這項操作。", 409,
  );
  if (["22023", "22P02", "22007", "22008"].includes(code ?? "")) {
    return databaseFailure(
      "INVALID_TRANSPORT_PLAN_OPERATION",
      "趟次日期、時段、車輛、駕駛、地點、乘員或理由未通過驗證。", 400,
    );
  }
  return databaseFailure(
    "TRANSPORT_PLAN_RESULT_UNCERTAIN",
    "交通計畫操作結果尚未確認；請保留內容並使用相同操作鍵重試。", 409,
  );
}

async function authorize(permission: string): Promise<TenantContext> {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY", "展示模式只使用合成交通資料，不會寫入正式資料。", 403,
  );
  const required = ["clients.read", "transport_plans.read", permission];
  if (required.some((scope) => !actor.scopes.includes(scope))) {
    throw new IntegrationError(
      "TRANSPORT_PLAN_NOT_AUTHORIZED", "目前角色沒有完整的交通計畫權限。", 403,
    );
  }
  await requireRecentAal2(actor);
  return actor;
}

async function execute(input: TransportPlanMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure(
    "SERVICE_NOT_CONFIGURED", "正式交通趟次計畫服務尚未設定。", 503,
  );
  const { data, error } = await supabase.rpc("mutate_transport_trip_plan", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId, p_action: input.action,
    p_payload: transportPlanMutationPayload(input),
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle();
  if (error || !data) throw transportFailure(error?.code);
  return parseTransportPlanReceipt(data, input);
}

async function mutate(
  request: Request,
  allowed: readonly DeclaredOperation[],
  requestId: ApiRequestId,
) {
  const declared = requireOperationHeader(request, allowed);
  const permission = declared === "save_trip" ? "transport_plans.manage" :
    declared === "override_trip" ? "transport_plans.override" : "transport_plans.approve";
  const actor = await authorize(permission);
  const input = parseTransportPlanMutation(
    await readJsonObject(request, TRANSPORT_PLAN_MUTATION_MAX_BYTES),
    request.headers.get("idempotency-key"),
  );
  const expected = input.action === "save_trip" ? "save_trip" : `${input.decision}_trip`;
  if (expected !== declared) throw new IntegrationError(
    "INVALID_TRANSPORT_PLAN_OPERATION",
    "交通計畫操作標頭與內容不一致。", 400, "action",
  );
  const result = await execute(input, actor);
  return ok(result, result.replayed ? 200 : 201, requestId);
}

export async function POST(request: Request) {
  return handleIntegrationRoute((requestId) => mutate(request, ["save_trip"], requestId));
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute((requestId) => mutate(request,
    ["publish_trip", "override_trip", "reject_trip"], requestId));
}
