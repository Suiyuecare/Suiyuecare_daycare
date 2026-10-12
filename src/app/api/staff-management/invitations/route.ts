import { z } from "zod";
import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute, readJsonObject,
  requireRecentAal2 } from "@/lib/integrations/http";
import { deterministicUuid } from "@/lib/integrations/security";
import { staffInvitationInput, staffInvitationList, staffInvitationReceipt } from "@/lib/staff-management/invitation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const preferredRegion = "hnd1";
export const dynamic = "force-dynamic";
export async function GET() {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) return ok({ invitations: [], demo: true }, 200, requestId);
    const client = await createServerSupabaseClient();
    if (!client) throw databaseFailure("SERVICE_NOT_CONFIGURED", "員工邀請服務尚未設定。", 503);
    const result = await client.rpc("staff_google_invitation_list", { p_org: actor.organizationId, p_branch: actor.branchId });
    if (result.error) throw databaseFailure("STAFF_INVITATION_READ_FAILED", "無法讀取邀請，請確認管理權限後重試。", 403);
    const parsed = staffInvitationList.safeParse(result.data);
    if (!parsed.success) throw databaseFailure("STAFF_INVITATION_RESPONSE_INVALID", "邀請資料無法核對。", 502);
    return ok({ invitations: parsed.data, demo: false }, 200, requestId);
  });
}
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會開通員工。", 403);
    await requireRecentAal2(actor);
    if (!["staff_management.manage", "staff_management.employment.manage", "staff_management.roles.manage", "roles.manage"]
      .every((scope) => actor.scopes.includes(scope)))
      throw new IntegrationError("STAFF_INVITATION_NOT_AUTHORIZED", "目前帳號不能開通員工。", 403);
    const key = z.uuid().safeParse(request.headers.get("idempotency-key"));
    const input = staffInvitationInput.safeParse(await readJsonObject(request, 16_384));
    if (!key.success || !input.success) throw new IntegrationError("INVALID_STAFF_INVITATION", "請確認公司信箱、姓名及職務。", 400);
    if (input.data.action !== "propose" && !actor.scopes.includes("staff_management.approve"))
      throw new IntegrationError("STAFF_INVITATION_NOT_AUTHORIZED", "目前帳號不能核准員工邀請。", 403);
    const client = await createServerSupabaseClient();
    if (!client) throw databaseFailure("SERVICE_NOT_CONFIGURED", "員工邀請服務尚未設定。", 503);
    const result = await client.rpc("staff_google_invitation_mutate", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_action: input.data.action,
      p_key: deterministicUuid("staff-google-invitation-v1", actor.organizationId, actor.userId, key.data),
      p_email: input.data.action === "propose" ? input.data.email : null,
      p_name: input.data.action === "propose" ? input.data.displayName : null,
      p_role: input.data.action === "propose" ? input.data.roleId : null,
      p_invitation: input.data.action !== "propose" ? input.data.invitationId : null,
    });
    if (result.error) throw databaseFailure("STAFF_INVITATION_SAVE_FAILED",
      result.error.code === "42501" ? "需另一位授權主管核准，且不可核准自己的邀請。" :
        "未確認儲存結果，請保留相同內容重試；若邀請已過期，請重新提出。",
      result.error.code === "42501" ? 403 : 409);
    const receipt = staffInvitationReceipt.safeParse(result.data);
    if (!receipt.success) throw databaseFailure("STAFF_INVITATION_RESULT_UNKNOWN", "儲存結果尚未確認，請保留內容重試。", 409);
    return ok({ receipt: receipt.data }, receipt.data.replayed ? 200 : 201, requestId);
  });
}
