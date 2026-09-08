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
import { buildDemoPushNotificationManagementSnapshot } from "@/lib/push-notifications/demo";
import {
  parsePushNotificationInput,
  parsePushNotificationPreviewRpc,
  parsePushNotificationQueueRpc,
} from "@/lib/push-notifications/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notificationFailure(code: string | undefined, mode: "preview" | "queue") {
  if (code === "42501") {
    return databaseFailure(
      "PUSH_NOTIFICATION_NOT_AUTHORIZED",
      "目前角色、分支或部分收件者不在有效的站內員工通知範圍。",
      403,
    );
  }
  if (code === "23505") {
    return databaseFailure(
      "PUSH_NOTIFICATION_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同的通知內容。",
      409,
    );
  }
  if (["22023", "22P02", "23514"].includes(code ?? "")) {
    return databaseFailure(
      "PUSH_NOTIFICATION_REJECTED",
      "通知內容、站內管道、收件者或排程時間未通過驗證。",
      422,
    );
  }
  return databaseFailure(
    mode === "preview"
      ? "PUSH_NOTIFICATION_PREVIEW_FAILED"
      : "PUSH_NOTIFICATION_QUEUE_FAILED",
    mode === "preview"
      ? "收件者預覽未確認完成；系統未建立通知。"
      : "通知與站內收件佇列未確認完成；請保留相同冪等鍵重試。",
    409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (!actor.demo && !actor.scopes.includes("notifications.manage")) {
      throw new IntegrationError(
        "PUSH_NOTIFICATION_NOT_AUTHORIZED",
        "目前角色沒有建立通知的權限。",
        403,
      );
    }
    if (!actor.demo) await requireRecentAal2(actor);

    const input = parsePushNotificationInput(
      await readJsonObject(request, 64 * 1024),
      request.headers.get("idempotency-key"),
    );

    if (actor.demo) {
      if (input.mode === "queue") {
        throw new IntegrationError(
          "DEMO_WRITE_DISABLED",
          "展示模式只提供合成收件者預覽，不會排入或建立通知。",
          403,
        );
      }
      const snapshot = buildDemoPushNotificationManagementSnapshot();
      const recipients = snapshot.recipients.filter((recipient) =>
        input.recipientUserIds.includes(recipient.userId),
      );
      const preview = parsePushNotificationPreviewRpc(
        {
          organization_id: actor.organizationId,
          branch_id: actor.branchId,
          generated_at: snapshot.generatedAt,
          recipients: recipients.map((recipient) => ({
            user_id: recipient.userId,
            display_name: recipient.displayName,
            profile_kind: recipient.profileKind,
          })),
          recipient_count: recipients.length,
          channel: "in_app",
          persisted: false,
        },
        input,
        actor.organizationId,
        actor.branchId,
        true,
      );
      return ok(
        {
          mode: "preview",
          preview,
          queued: false,
          persisted: false,
          demo: true,
        },
        200,
        requestId,
      );
    }

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式站內通知服務尚未設定。",
        503,
      );
    }

    if (input.mode === "preview") {
      const { data, error } = await supabase
        .rpc("preview_in_app_staff_notification_recipients", {
          p_expected_organization_id: actor.organizationId,
          p_expected_branch_id: actor.branchId,
          p_recipient_user_ids: input.recipientUserIds,
        })
        .maybeSingle();
      if (error || !data) throw notificationFailure(error?.code, "preview");
      const preview = parsePushNotificationPreviewRpc(
        data,
        input,
        actor.organizationId,
        actor.branchId,
        false,
      );
      return ok(
        {
          mode: "preview",
          preview,
          queued: false,
          persisted: false,
          demo: false,
        },
        200,
        requestId,
      );
    }

    const databaseIdempotencyKey = deterministicUuid(
      "page45-in-app-staff-notification",
      actor.organizationId,
      actor.userId,
      input.idempotencyKey,
    );
    const { data, error } = await supabase
      .rpc("enqueue_in_app_staff_notification", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_category: input.category,
        p_priority: input.priority,
        p_title: input.title,
        p_body: input.body,
        p_recipient_user_ids: input.recipientUserIds,
        p_scheduled_for: input.scheduledFor,
        p_idempotency_key: databaseIdempotencyKey,
      })
      .maybeSingle();
    if (error || !data) throw notificationFailure(error?.code, "queue");
    const receipt = parsePushNotificationQueueRpc(data, input);
    return ok(
      {
        mode: "queue",
        receipt,
        queued: true,
        persisted: true,
        demo: false,
      },
      receipt.replayed ? 200 : 201,
      requestId,
    );
  });
}
