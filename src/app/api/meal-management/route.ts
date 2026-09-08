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
  MEAL_MUTATION_MAX_BYTES,
  mealMutationPayload,
  parseMealMutation,
  parseMealMutationReceipt,
} from "@/lib/meal-management/parser";
import type { MealMutationInput } from "@/lib/meal-management/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MealOperation = MealMutationInput["action"];
type ApiRequestId = ReturnType<typeof import("node:crypto").randomUUID>;

function requireOperationHeader(
  request: Request,
  allowed: readonly MealOperation[],
) {
  const operation = request.headers.get("x-meal-operation");
  if (!allowed.includes(operation as MealOperation)) {
    throw new IntegrationError(
      "INVALID_MEAL_OPERATION",
      "缺少或不支援的餐食管理操作標頭。",
      400,
      "x-meal-operation",
    );
  }
  return operation as MealOperation;
}

function mealFailure(errorCode?: string) {
  if (errorCode === "42501") return databaseFailure(
    "MEAL_NOT_AUTHORIZED",
    "目前角色、機構、分支、個案範圍或工作階段不允許這項餐食操作。",
    403,
  );
  if (errorCode === "40001") return databaseFailure(
    "MEAL_VERSION_CONFLICT",
    "餐食需求、菜單版本或當日出勤已改變；請重新載入後再操作。",
    409,
  );
  if (errorCode === "23505") return databaseFailure(
    "MEAL_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同內容；請保留資料並重新載入。",
    409,
  );
  if (["23514", "23503", "55000"].includes(errorCode ?? "")) {
    return databaseFailure(
      "MEAL_STATE_CONFLICT",
      "餐食需求、衝突處置、實際份數或版本狀態不允許這項操作。",
      409,
    );
  }
  if (["22023", "22003", "23502"].includes(errorCode ?? "")) {
    return databaseFailure(
      "INVALID_MEAL_OPERATION",
      "餐食日期、質地、過敏禁忌、菜單、衝突處置或份數未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "MEAL_SAVE_FAILED",
    "餐食操作尚未確認完成；請保留內容並使用相同操作鍵重試。",
  );
}

async function authorize(
  permission: "meals.manage" | "meals.confirm",
): Promise<TenantContext> {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY",
    "展示模式只使用合成餐食資料，不會寫入正式或本機資料。",
    403,
  );
  const required = [
    "clients.read", "attendance.read", "health.read", "meals.read", permission,
  ];
  if (required.some((scope) => !actor.scopes.includes(scope))) {
    throw new IntegrationError(
      "MEAL_NOT_AUTHORIZED",
      "目前角色沒有完整的餐食、出勤、健康或個案資料權限。",
      403,
    );
  }
  await requireRecentAal2(actor);
  return actor;
}

async function execute(input: MealMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure(
    "SERVICE_NOT_CONFIGURED", "正式餐食管理服務尚未設定。", 503,
  );
  const { data, error } = await supabase.rpc("mutate_meal_management", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_action: input.action,
    p_payload: mealMutationPayload(input),
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle();
  if (error || !data) throw mealFailure(error?.code);
  return parseMealMutationReceipt(data, input);
}

async function mutate(
  request: Request,
  allowed: readonly MealOperation[],
  requestId: ApiRequestId,
) {
  const declared = requireOperationHeader(request, allowed);
  const actor = await authorize(
    declared === "complete_plan" ? "meals.confirm" : "meals.manage",
  );
  const input = parseMealMutation(
    await readJsonObject(request, MEAL_MUTATION_MAX_BYTES),
    request.headers.get("idempotency-key"),
  );
  if (input.action !== declared) throw new IntegrationError(
    "INVALID_MEAL_OPERATION",
    "餐食操作標頭與內容不一致。",
    400,
    "action",
  );
  const result = await execute(input, actor);
  return ok(result, result.replayed ? 200 : 201, requestId);
}

export async function POST(request: Request) {
  return handleIntegrationRoute((requestId) =>
    mutate(request, ["set_requirement", "save_plan"], requestId));
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute((requestId) =>
    mutate(request, ["complete_plan"], requestId));
}
