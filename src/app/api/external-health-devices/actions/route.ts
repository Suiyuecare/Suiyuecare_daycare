import { ok } from "@/lib/api/response";
import {
  EXTERNAL_HEALTH_ACTION_MAX_BYTES,
  parseExternalHealthActionInput,
  parseExternalHealthDatabaseReceipt,
} from "@/lib/external-health-devices/parser";
import type { ExternalHealthActionInput } from "@/lib/external-health-devices/types";
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

function writeFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "EXTERNAL_HEALTH_NOT_AUTHORIZED",
    "目前角色、分支、個案範圍或登入保證等級不允許這項操作。", 403,
  );
  if (code === "23505") return databaseFailure(
    "EXTERNAL_HEALTH_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同內容；請重新載入後再試。", 409,
  );
  if (code === "40001") return databaseFailure(
    "EXTERNAL_HEALTH_VERSION_CONFLICT",
    "設備或量測配對已被其他人更新；請重新載入後再確認。", 409,
  );
  if (["22023", "22P02", "23503", "23514", "55000"].includes(code ?? "")) {
    return databaseFailure("INVALID_EXTERNAL_HEALTH_ACTION",
      "設備、量測、對象、狀態或理由未通過驗證。", 400);
  }
  return databaseFailure("EXTERNAL_HEALTH_SAVE_UNCERTAIN",
    "操作結果尚未確認；請保留內容並使用相同操作鍵重試。", 409);
}

async function execute(
  actor: Awaited<ReturnType<typeof authorizeStaffRequest>>,
  input: ExternalHealthActionInput,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED",
    "正式外部健康設備資料服務尚未設定。", 503);
  const operationKey = deterministicUuid(
    "page65-external-health-action", actor.organizationId, actor.userId,
    input.idempotencyKey,
  );
  const query = input.action === "correct_measurement_match"
    ? supabase.rpc("correct_external_health_measurement_match", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_measurement_id: input.measurementId,
      p_expected_correction_sequence: input.expectedCorrectionSequence,
      p_match_status: input.matchStatus, p_client_id: input.clientId,
      p_reason: input.reason, p_idempotency_key: operationKey,
    })
    : supabase.rpc("append_external_health_device_state", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_device_id: input.deviceId,
      p_action: input.action,
      p_expected_state_sequence: input.expectedStateSequence,
      p_client_id: input.clientId, p_reason: input.reason,
      p_idempotency_key: operationKey,
    });
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw writeFailure(error?.code);
  return parseExternalHealthDatabaseReceipt(
    data, input, actor.organizationId, actor.branchId,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
      "展示模式只顯示合成設備與量測，不會保存操作。", 403);
    if (!actor.scopes.includes("external_health_devices.read") ||
        !actor.scopes.includes("external_health_devices.manage")) {
      throw new IntegrationError("EXTERNAL_HEALTH_NOT_AUTHORIZED",
        "目前角色沒有外部健康設備管理權限。", 403);
    }
    await requireRecentAal2(actor);
    const input = parseExternalHealthActionInput(
      await readJsonObject(request, EXTERNAL_HEALTH_ACTION_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const receipt = await execute(actor, input);
    return ok({ ...receipt, organizationId: actor.organizationId,
      branchId: actor.branchId }, receipt.replayed ? 200 : 201, requestId);
  });
}
