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
  CASE_SERVICE_RECORD_MUTATION_MAX_BYTES,
  caseServiceRecordPayload,
  parseCaseServiceRecordMutation,
  parseCaseServiceRecordReceipt,
} from "@/lib/case-service-records/parser";
import type { CaseServiceRecordMutationInput } from "@/lib/case-service-records/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApiRequestId = ReturnType<typeof import("node:crypto").randomUUID>;
type Operation = "create" | "revise" | "sign" | "correct";

function declaredOperation(request: Request, allowed: readonly Operation[]): Operation {
  const value = request.headers.get("x-case-service-record-operation");
  if (!allowed.includes(value as Operation)) {
    throw new IntegrationError(
      "INVALID_CASE_SERVICE_RECORD_OPERATION",
      "缺少或不支援的個案服務紀錄受治理操作標頭。",
      400,
      "x-case-service-record-operation",
    );
  }
  return value as Operation;
}

function matches(operation: Operation, input: CaseServiceRecordMutationInput) {
  return (operation === "create" && input.action === "save_record" && input.mode === "create") ||
    (operation === "revise" && input.action === "save_record" && input.mode === "revise") ||
    (operation === "sign" && input.action === "sign_record") ||
    (operation === "correct" && input.action === "correct_record");
}

async function authorize(operation: Operation): Promise<TenantContext> {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只顯示合成個案服務紀錄，不會寫入正式資料。",
      403,
    );
  }
  const operationPermission = operation === "create" || operation === "revise" ?
    "case_service_records.manage" : "case_service_records.sign";
  if (!["clients.read", "case_service_records.read", operationPermission].every((permission) =>
    actor.scopes.includes(permission))) {
    throw new IntegrationError(
      "CASE_SERVICE_RECORD_NOT_AUTHORIZED",
      "目前角色沒有完整的個案服務紀錄操作權限。",
      403,
    );
  }
  if (operation === "sign" || operation === "correct") await requireRecentAal2(actor);
  return actor;
}

function failure(code?: string) {
  if (code === "42501") return databaseFailure(
    "CASE_SERVICE_RECORD_NOT_AUTHORIZED",
    "目前角色、分支、個案指派或工作階段不允許這項個案服務紀錄操作。",
    403,
  );
  if (code === "40001") return databaseFailure(
    "CASE_SERVICE_RECORD_VERSION_CONFLICT",
    "紀錄版本、內容指紋或執行來源狀態已改變；請重新載入。",
    409,
  );
  if (code === "23505") return databaseFailure(
    "CASE_SERVICE_RECORD_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同內容。",
    409,
  );
  if (["23514", "23503", "55000"].includes(code ?? "")) return databaseFailure(
    "CASE_SERVICE_RECORD_STATE_CONFLICT",
    "紀錄狀態、線性版本鏈、個案期間或執行來源證據不允許這項操作。",
    409,
  );
  if (["22023", "22P02", "22007", "22008"].includes(code ?? "")) return databaseFailure(
    "INVALID_CASE_SERVICE_RECORD_OPERATION",
    "個案、服務期間、人工內容、理由或執行來源未通過驗證。",
    400,
  );
  return databaseFailure(
    "CASE_SERVICE_RECORD_RESULT_UNCERTAIN",
    "個案服務紀錄結果尚未確認；請保留內容並使用相同操作鍵重試。",
    409,
  );
}

async function execute(input: CaseServiceRecordMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure(
    "SERVICE_NOT_CONFIGURED",
    "正式個案服務紀錄尚未設定。",
    503,
  );
  const { data, error } = await supabase.rpc("mutate_case_service_record", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_action: input.action,
    p_payload: caseServiceRecordPayload(input),
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle();
  if (error || !data) throw failure(error?.code);
  return parseCaseServiceRecordReceipt(
    data,
    input,
    actor.organizationId,
    actor.branchId,
    actor.userId,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId: ApiRequestId) => {
    const operation = declaredOperation(request, ["create"]);
    const actor = await authorize(operation);
    const input = parseCaseServiceRecordMutation(
      await readJsonObject(request, CASE_SERVICE_RECORD_MUTATION_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    if (!matches(operation, input)) throw new IntegrationError(
      "INVALID_CASE_SERVICE_RECORD_OPERATION",
      "操作標頭與個案服務紀錄內容不一致。",
      400,
      "action",
    );
    const result = await execute(input, actor);
    return ok(result, result.replayed ? 200 : 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId: ApiRequestId) => {
    const operation = declaredOperation(request, ["revise", "sign", "correct"]);
    const actor = await authorize(operation);
    const input = parseCaseServiceRecordMutation(
      await readJsonObject(request, CASE_SERVICE_RECORD_MUTATION_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    if (!matches(operation, input)) throw new IntegrationError(
      "INVALID_CASE_SERVICE_RECORD_OPERATION",
      "操作標頭與個案服務紀錄內容不一致。",
      400,
      "action",
    );
    const result = await execute(input, actor);
    return ok(result, result.replayed ? 200 : 201, requestId);
  });
}
