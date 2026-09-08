import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute,
  readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { BEHAVIOR_EVENT_MUTATION_MAX_BYTES, behaviorEventPayload,
  parseBehaviorEventMutation, parseBehaviorEventReceipt } from "@/lib/behavior-events/parser";
import type { BehaviorEventMutationInput } from "@/lib/behavior-events/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApiRequestId = ReturnType<typeof import("node:crypto").randomUUID>;
type Operation = "create" | "revise" | "sign" | "correct" | "void";

function declaredOperation(request: Request): Operation {
  const value = request.headers.get("x-behavior-event-operation");
  if (!value || !["create", "revise", "sign", "correct", "void"].includes(value)) {
    throw new IntegrationError("INVALID_BEHAVIOR_EVENT_OPERATION",
      "缺少或不支援的行為事件受治理操作標頭。", 400, "x-behavior-event-operation");
  }
  return value as Operation;
}

function matches(operation: Operation, input: BehaviorEventMutationInput) {
  return (operation === "create" && input.action === "save_event" && input.mode === "create") ||
    (operation === "revise" && input.action === "save_event" && input.mode === "revise") ||
    (operation === "sign" && input.action === "finalize_event" && input.decision === "sign") ||
    (operation === "void" && input.action === "finalize_event" && input.decision === "void") ||
    (operation === "correct" && input.action === "correct_event");
}

async function authorize(operation: Operation): Promise<TenantContext> {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
    "展示模式僅顯示合成事件，不會寫入正式紀錄。", 403);
  const required = ["clients.read", "behavior_events.read",
    operation === "create" || operation === "revise" ? "behavior_events.manage" : "behavior_events.sign"];
  if (required.some((scope) => !actor.scopes.includes(scope))) throw new IntegrationError(
    "BEHAVIOR_EVENT_NOT_AUTHORIZED", "目前角色沒有完整的行為事件操作權限。", 403);
  if (["sign", "correct", "void"].includes(operation)) await requireRecentAal2(actor);
  return actor;
}

function failure(code?: string) {
  if (code === "42501") return databaseFailure("BEHAVIOR_EVENT_NOT_AUTHORIZED",
    "目前角色、分支、個案指派或工作階段不允許這項行為事件操作。", 403);
  if (code === "40001") return databaseFailure("BEHAVIOR_EVENT_VERSION_CONFLICT",
    "事件版本或內容雜湊已改變；請重新載入後再操作。", 409);
  if (code === "23505") return databaseFailure("BEHAVIOR_EVENT_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同事件內容。", 409);
  if (["23514", "23503", "55000"].includes(code ?? "")) return databaseFailure(
    "BEHAVIOR_EVENT_STATE_CONFLICT", "事件狀態、版本鏈或必要理由不允許這項操作。", 409);
  if (["22023", "22P02", "22007", "22008"].includes(code ?? "")) return databaseFailure(
    "INVALID_BEHAVIOR_EVENT_OPERATION", "發生時間、事件類型或人工欄位未通過驗證。", 400);
  return databaseFailure("BEHAVIOR_EVENT_RESULT_UNCERTAIN",
    "行為事件結果尚未確認；請保留內容並使用相同操作鍵重試。", 409);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId: ApiRequestId) => {
    const operation = declaredOperation(request);
    const actor = await authorize(operation);
    const input = parseBehaviorEventMutation(
      await readJsonObject(request, BEHAVIOR_EVENT_MUTATION_MAX_BYTES),
      request.headers.get("idempotency-key"));
    if (!matches(operation, input)) throw new IntegrationError("INVALID_BEHAVIOR_EVENT_OPERATION",
      "受治理操作標頭與事件內容不一致。", 400);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式行為事件服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("mutate_behavior_event", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
      p_action: input.action, p_payload: behaviorEventPayload(input),
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle();
    if (error || !data) throw failure(error?.code);
    const result = parseBehaviorEventReceipt(data, input);
    return ok(result, result.replayed ? 200 : 201, requestId);
  });
}
