import { z } from "zod";

import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { parseStaffAnnouncementAction } from "@/lib/integrations/staff-announcements";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { parseStaffAnnouncementReceipt } from "@/lib/staff-announcements/receipt";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const headersSchema = z.object({
  organizationId: uuid,
  branchId: uuid,
  idempotencyKey: uuid,
  nonce: uuid,
}).strict();

/** Read-only, own-operation evidence. Never call a write/replay RPC here.
 * A missing receipt cannot prove a prior write failed or is no longer in flight. */
export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY", "展示模式沒有正式公告操作回條。", 403,
    );
    const action = parseStaffAnnouncementAction(request.headers.get("x-announcement-action"));
    if (!actor.scopes.includes("announcements.read") ||
      (action !== "read" && !actor.scopes.includes("announcements.manage")) ||
      ((action === "publish" || action === "withdraw") && !actor.scopes.includes("announcements.publish"))) {
      throw new IntegrationError(
        "STAFF_ANNOUNCEMENT_NOT_AUTHORIZED", "目前授權無法查證這項公告操作。", 403,
      );
    }
    if (action === "publish" || action === "withdraw") await requireRecentAal2(actor);
    // Keep opaque operation keys out of URL history and referrers. Never read
    // a request body, accept an actor parameter, or forward unvalidated headers.
    const parsed = headersSchema.safeParse({
      organizationId: request.headers.get("x-organization-id"),
      branchId: request.headers.get("x-branch-id"),
      idempotencyKey: request.headers.get("idempotency-key"),
      nonce: request.headers.get("x-receipt-nonce"),
    });
    if (!parsed.success || new URL(request.url).search) throw new IntegrationError(
      "INVALID_STAFF_ANNOUNCEMENT_RECEIPT_REQUEST", "請提供有效的公告回查識別。", 400,
    );
    if (parsed.data.organizationId !== actor.organizationId.toLowerCase() ||
      parsed.data.branchId !== actor.branchId.toLowerCase()) throw new IntegrationError(
      "STAFF_ANNOUNCEMENT_NOT_AUTHORIZED", "公告回查範圍與目前登入範圍不符。", 403,
    );
    const expected = { ...parsed.data, action, userId: actor.userId.toLowerCase() };
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式公告回查服務尚未設定。", 503,
    );
    const { data, error } = await supabase.rpc("staff_announcement_operation_receipt", {
      p_organization_id: expected.organizationId,
      p_branch_id: expected.branchId,
      p_action: action,
      p_idempotency_key: expected.idempotencyKey,
      p_nonce: expected.nonce,
    });
    if (error) throw databaseFailure(
      error.code === "42501" ? "STAFF_ANNOUNCEMENT_NOT_AUTHORIZED" : "STAFF_ANNOUNCEMENT_RECEIPT_UNAVAILABLE",
      error.code === "42501" ? "目前授權無法查證這項公告操作。" : "尚未取得原操作證明，請稍後再查。",
      error.code === "42501" ? 403 : 503,
    );
    return ok(parseStaffAnnouncementReceipt(data, expected), 200, requestId);
  });
}
