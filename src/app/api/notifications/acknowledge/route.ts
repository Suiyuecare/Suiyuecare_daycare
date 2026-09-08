import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import {
  parseNotificationAcknowledgementInput,
  parseNotificationAcknowledgementRpcResult,
} from "@/lib/notification-center/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function acknowledgementFailure(code: string | undefined) {
  if (code === "42501") {
    return databaseFailure(
      "NOTIFICATION_ACKNOWLEDGEMENT_NOT_AUTHORIZED",
      "目前角色、分支、收件者或工作階段不允許這項通知操作。",
      403,
    );
  }
  if (code === "23505") {
    return databaseFailure(
      "NOTIFICATION_ACKNOWLEDGEMENT_IDEMPOTENCY_CONFLICT",
      "相同 UUID 冪等鍵曾用於不同的通知操作。",
      409,
    );
  }
  if (["22023", "22P02", "23514"].includes(code ?? "")) {
    return databaseFailure(
      "NOTIFICATION_ACKNOWLEDGEMENT_REJECTED",
      "通知狀態不能執行指定的已讀或確認操作。",
      422,
    );
  }
  return databaseFailure(
    "NOTIFICATION_ACKNOWLEDGEMENT_FAILED",
    "通知操作未確認完成；請保留相同冪等鍵重試。",
    409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) {
      throw new IntegrationError(
        "DEMO_WRITE_DISABLED",
        "展示模式只提供合成通知檢視，不會標示已讀或確認。",
        403,
      );
    }
    if (!actor.scopes.includes("notifications.read")) {
      throw new IntegrationError(
        "NOTIFICATION_ACKNOWLEDGEMENT_NOT_AUTHORIZED",
        "目前角色沒有操作通知中心的權限。",
        403,
      );
    }
    const input = parseNotificationAcknowledgementInput(
      await readJsonObject(request, 8 * 1024),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式通知中心服務尚未設定。",
        503,
      );
    }
    const { data, error } = await supabase
      .rpc("acknowledge_notification_delivery", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_notification_delivery_id: input.deliveryId,
        p_target_status: input.targetStatus,
        p_idempotency_key: input.idempotencyKey,
      })
      .maybeSingle();
    if (error || !data) throw acknowledgementFailure(error?.code);
    const result = parseNotificationAcknowledgementRpcResult(data, input);
    return ok(result, result.replayed ? 200 : 201, requestId);
  });
}
