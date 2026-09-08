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
  parseTransportExecutionMutation,
  parseTransportExecutionReceipt,
  TRANSPORT_EXECUTION_MUTATION_MAX_BYTES,
  transportExecutionMutationPayload,
} from "@/lib/transport-execution/parser";
import type { TransportExecutionEventType } from "@/lib/transport-execution/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApiRequestId = ReturnType<typeof import("node:crypto").randomUUID>;
type Operation = "start_trip" | "passenger_boarded" | "passenger_alighted" |
  "record_exception" | "complete_trip";

const operationEvent: Record<Operation, TransportExecutionEventType> = {
  start_trip: "trip_started", passenger_boarded: "passenger_boarded",
  passenger_alighted: "passenger_alighted", record_exception: "exception_recorded",
  complete_trip: "trip_completed",
};

function declaredOperation(request: Request) {
  const value = request.headers.get("x-transport-execution-operation");
  if (!(value && value in operationEvent)) throw new IntegrationError(
    "INVALID_TRANSPORT_EXECUTION_OPERATION",
    "缺少或不支援的接送執行受治理操作標頭。", 400,
    "x-transport-execution-operation",
  );
  return value as Operation;
}

function permissionFor(operation: Operation) {
  if (operation === "record_exception") return "transport_execution.exception";
  if (operation === "complete_trip") return "transport_execution.complete";
  return "transport_execution.record";
}

function executionFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "TRANSPORT_EXECUTION_NOT_AUTHORIZED",
    "目前角色、分支、個案範圍、指派駕駛或工作階段不允許這項接送操作。", 403,
  );
  if (code === "40001") return databaseFailure(
    "TRANSPORT_EXECUTION_VERSION_CONFLICT",
    "接送事件序號、原計畫或目前配對狀態已改變；請重新載入後再操作。", 409,
  );
  if (code === "23505") return databaseFailure(
    "TRANSPORT_EXECUTION_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同接送事件內容。", 409,
  );
  if (["23514", "23503", "55000"].includes(code ?? "")) return databaseFailure(
    "TRANSPORT_EXECUTION_STATE_CONFLICT",
    "原計畫、事件順序、乘客配對、實際時間或完成狀態不允許這項操作。", 409,
  );
  if (["22023", "22P02", "22007", "22008"].includes(code ?? "")) {
    return databaseFailure(
      "INVALID_TRANSPORT_EXECUTION_OPERATION",
      "接送事件、個案、時間、理由或預期版本未通過驗證。", 400,
    );
  }
  return databaseFailure(
    "TRANSPORT_EXECUTION_RESULT_UNCERTAIN",
    "接送執行結果尚未確認；請保留內容並使用相同操作鍵重試。", 409,
  );
}

async function authorize(operation: Operation): Promise<TenantContext> {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY", "展示模式只使用合成接送資料，不會寫入正式資料。", 403,
  );
  const required = ["clients.read", "transport_execution.read", permissionFor(operation)];
  if (required.some((scope) => !actor.scopes.includes(scope))) throw new IntegrationError(
    "TRANSPORT_EXECUTION_NOT_AUTHORIZED", "目前角色沒有完整的接送執行權限。", 403,
  );
  if (operation === "record_exception" || operation === "complete_trip") {
    await requireRecentAal2(actor);
  }
  return actor;
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId: ApiRequestId) => {
    const operation = declaredOperation(request);
    const actor = await authorize(operation);
    const input = parseTransportExecutionMutation(
      await readJsonObject(request, TRANSPORT_EXECUTION_MUTATION_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    if (operationEvent[operation] !== input.eventType) throw new IntegrationError(
      "INVALID_TRANSPORT_EXECUTION_OPERATION",
      "接送執行操作標頭與事件內容不一致。", 400, "event_type",
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式接送執行服務尚未設定。", 503,
    );
    const { data, error } = await supabase.rpc("mutate_transport_execution", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_payload: transportExecutionMutationPayload(input),
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle();
    if (error || !data) throw executionFailure(error?.code);
    const result = parseTransportExecutionReceipt(data, input);
    return ok(result, result.replayed ? 200 : 201, requestId);
  });
}
