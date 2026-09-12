import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { reminderMutationSchema, reminderReceiptSchema } from "@/lib/care-reminders/contracts";
import { loadCareReminders } from "@/lib/care-reminders/server";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await getTenantContext("staff");
    if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
    const clientId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("client_id"));
    if (!clientId.success) throw new IntegrationError("INVALID_REQUEST", "請先選擇個案。", 400);
    return ok(await loadCareReminders(actor, clientId.data), 200, requestId);
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await getTenantContext("staff");
    if (!actor?.branchId) throw new IntegrationError("AUTH_REQUIRED", "請先登入並選擇分支。", 401);
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會產生正式個案提醒。", 403);
    if (["clients.read", "health.read", "care_records.read", "care_records.sign", "imports.manage", "imports.approve"].some((permission) => !actor.scopes.includes(permission))) {
      throw new IntegrationError("CARE_REMINDER_ACCESS_DENIED", "您沒有核對來源與發布照顧提醒的完整權限。", 403);
    }
    await requireRecentAal2(actor);
    const parsed = reminderMutationSchema.safeParse(await readJsonObject(request, 8192));
    if (!parsed.success || request.headers.get("idempotency-key") !== parsed.data.idempotency_key) {
      throw new IntegrationError("INVALID_REQUEST", "請確認來源、個案、核對理由與重試識別資料。", 400);
    }
    const client = await createServerSupabaseClient();
    if (!client) throw databaseFailure("CARE_REMINDER_UNAVAILABLE", "照顧提醒服務尚未就緒。", 503);
    const { data, error } = await client.rpc("mutate_care_reminders", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
      p_payload: parsed.data, p_idempotency_key: parsed.data.idempotency_key,
    });
    if (error) throw databaseFailure("CARE_REMINDER_NOT_CONFIRMED", error.code === "40001"
      ? "來源、個案或審查狀態已改變，請重新載入後核對。"
      : "操作尚未確認完成，請保留本次操作並重試；若仍失敗，請聯絡管理員。",
      error.code === "42501" ? 403 : ["40001", "23505"].includes(error.code) ? 409 : error.code === "22023" ? 400 : 503);
    const receipt = reminderReceiptSchema.safeParse(data);
    if (!receipt.success || receipt.data.client_id !== parsed.data.client_id || receipt.data.action !== parsed.data.action || receipt.data.idempotency_key !== parsed.data.idempotency_key) {
      throw databaseFailure("CARE_REMINDER_INVALID_RECEIPT", "尚未取得可靠的儲存回執，請保留同一筆操作以便重試。", 502);
    }
    return ok(receipt.data, receipt.data.replayed ? 200 : 201, requestId);
  });
}
