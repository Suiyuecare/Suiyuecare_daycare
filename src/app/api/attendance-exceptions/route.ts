import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { hasSupabaseConfiguration } from "@/lib/env";
import {
  exceptionDatabaseFailure, parseExceptionQuery, parseExceptionReceipt, parseExceptionRequest,
} from "@/lib/integrations/attendance-exception";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { assertOfflineCareScope } from "@/lib/offline/scope";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await getTenantContext("staff");
    if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
    const directorRead = actor.roles.includes("branch_director") &&
      ["clients.read", "clients.view_all", "attendance.read"].every((permission) => actor.scopes.includes(permission));
    if (!actor.branchId || (!actor.roles.includes("care_worker") && !directorRead)) {
      throw new IntegrationError("ATTENDANCE_EXCEPTION_NOT_AUTHORIZED", "目前沒有此分支的例外出勤查閱權限。", 403);
    }
    const query = parseExceptionQuery(request.url);
    if (actor.demo) return ok({ serviceDate: query.serviceDate, requests: [], reviewer: false, demo: true }, 200, requestId);
    if (!hasSupabaseConfiguration()) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式資料服務尚未設定。", 503);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式資料服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("attendance_exception_snapshot", {
      p_organization_id: actor.organizationId,
      p_branch_id: actor.branchId,
      p_service_date: query.serviceDate,
      p_client_id: query.clientId,
    });
    if (error || !data) throw exceptionDatabaseFailure(error?.code);
    return ok(data, 200, requestId);
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest({ routinePermission: "attendance.write" });
    assertOfflineCareScope(request, actor);
    if (actor.demo || !actor.roles.includes("care_worker") || !actor.scopes.includes("attendance.write")) {
      throw new IntegrationError("ATTENDANCE_EXCEPTION_NOT_AUTHORIZED", "只有已獲准的照服員可送出例外簽到。", 403);
    }
    const input = parseExceptionRequest(await readJsonObject(request, 16 * 1024), request.headers.get("idempotency-key"));
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式資料服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("request_attendance_exception", {
      p_organization_id: actor.organizationId,
      p_branch_id: actor.branchId,
      p_client_id: input.client_id,
      p_expected_service_date: input.service_date,
      p_reason_code: input.reason_code,
      p_reason_note: input.reason_note,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error || !data) throw exceptionDatabaseFailure(error?.code);
    const receipt = parseExceptionReceipt(data, { clientId: input.client_id });
    return ok({ request: receipt, persisted: true }, receipt.replayed ? 200 : 201, requestId);
  });
}
