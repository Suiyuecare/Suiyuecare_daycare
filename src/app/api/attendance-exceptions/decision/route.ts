import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { hasSupabaseConfiguration } from "@/lib/env";
import {
  exceptionDatabaseFailure, parseExceptionDecision, parseExceptionReceipt,
} from "@/lib/integrations/attendance-exception";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { assertOfflineCareScope } from "@/lib/offline/scope";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await getTenantContext("staff");
    if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
    if (!actor.branchId || actor.demo) throw new IntegrationError("ATTENDANCE_EXCEPTION_NOT_AUTHORIZED", "正式分支才能覆核例外出勤。", 403);
    assertOfflineCareScope(request, actor);
    const input = parseExceptionDecision(await readJsonObject(request, 16 * 1024), request.headers.get("idempotency-key"));
    const directorRead = actor.roles.includes("branch_director") &&
      ["clients.read", "clients.view_all", "attendance.read"].every((permission) => actor.scopes.includes(permission));
    if (input.decision === "cancel" ? !actor.roles.includes("care_worker") : !directorRead) {
      throw new IntegrationError("ATTENDANCE_EXCEPTION_NOT_AUTHORIZED", "這項操作需要指定人員或機構主任處理。", 403);
    }
    if (!hasSupabaseConfiguration()) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式資料服務尚未設定。", 503);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式資料服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("decide_attendance_exception", {
      p_organization_id: actor.organizationId,
      p_branch_id: actor.branchId,
      p_request_id: input.request_id,
      p_decision: input.decision,
      p_decision_note: input.decision_note,
      p_confirmed_arrival_at: input.confirmed_arrival_at,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error || !data) throw exceptionDatabaseFailure(error?.code);
    const receipt = parseExceptionReceipt(data, { requestId: input.request_id });
    return ok({ request: receipt, persisted: true }, 200, requestId);
  });
}
