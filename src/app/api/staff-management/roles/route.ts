import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest, databaseFailure, handleIntegrationRoute,
  readJsonObject, requireRecentAal2,
} from "@/lib/integrations/http";
import { deterministicUuid } from "@/lib/integrations/security";
import {
  parseStaffRoleApprovalInput, parseStaffRoleApprovalReceipt,
  parseStaffRoleChangeInput, parseStaffRoleRequestReceipt,
  STAFF_MANAGEMENT_ACTION_HEADER,
  STAFF_MANAGEMENT_ROLE_MAX_BYTES,
} from "@/lib/staff-management/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGE_SCOPES = ["staff_management.read", "staff_management.manage",
  "staff_management.identity.read", "staff_management.roles.read",
  "staff_management.roles.manage", "roles.manage"] as const;

function requireAction(request: Request, expected: "request_role" | "approve_role") {
  if (request.headers.get(STAFF_MANAGEMENT_ACTION_HEADER) !== expected) {
    throw new IntegrationError("INVALID_STAFF_MANAGEMENT_ACTION",
      "缺少或不符合此員工作業的受治理動作標頭。", 400,
      STAFF_MANAGEMENT_ACTION_HEADER);
  }
}

function requireScopes(scopes: readonly string[], approve = false) {
  const required = approve ? [...MANAGE_SCOPES, "staff_management.approve"] : MANAGE_SCOPES;
  if (!required.every((scope) => scopes.includes(scope))) throw new IntegrationError(
    approve ? "STAFF_ROLE_APPROVAL_NOT_AUTHORIZED" : "STAFF_ROLE_CHANGE_NOT_AUTHORIZED",
    "目前角色或資料範圍不允許角色異動。", 403,
  );
}

function failure(code: string | undefined, approval = false) {
  if (code === "42501") return databaseFailure(
    approval ? "STAFF_ROLE_APPROVAL_NOT_AUTHORIZED" : "STAFF_ROLE_CHANGE_NOT_AUTHORIZED",
    "角色異動需要組織與分支角色權限、近期雙重驗證及獨立審核。", 403);
  if (code === "23505") return databaseFailure("STAFF_MANAGEMENT_IDEMPOTENCY_CONFLICT",
    "角色異動已處理，或相同操作鍵已用於不同內容。", 409);
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "STAFF_ROLE_VERSION_CONFLICT", "員工或角色版本已改變，請重新載入。", 409);
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_STAFF_MANAGEMENT_INPUT", "角色異動內容未通過驗證。", 400);
  return databaseFailure("STAFF_ROLE_RESULT_UNCERTAIN",
    "角色異動結果尚未確認；請保留相同操作鍵重試。", 409);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    requireAction(request, "request_role");
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
      "展示模式不會建立角色異動。", 403);
    requireScopes(actor.scopes); await requireRecentAal2(actor);
    const input = parseStaffRoleChangeInput(
      await readJsonObject(request, STAFF_MANAGEMENT_ROLE_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED",
      "正式員工角色服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("request_staff_role_change", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId, p_operation: input.operation,
      p_target_membership_id: input.targetMembershipId,
      p_target_role_id: input.targetRoleId,
      p_expected_membership_version: input.expectedMembershipVersion,
      p_idempotency_key: deterministicUuid("page59-staff-role-request",
        actor.organizationId, actor.userId, input.idempotencyKey),
    }).maybeSingle();
    if (error || !data) throw failure(error?.code);
    const receipt = parseStaffRoleRequestReceipt(data, input,
      actor.organizationId, actor.branchId);
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    requireAction(request, "approve_role");
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
      "展示模式不會核准角色異動。", 403);
    requireScopes(actor.scopes, true); await requireRecentAal2(actor);
    const input = parseStaffRoleApprovalInput(
      await readJsonObject(request, STAFF_MANAGEMENT_ROLE_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED",
      "正式員工角色服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("approve_staff_role_change", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId, p_request_id: input.requestId,
      p_expected_membership_version: input.expectedMembershipVersion,
      p_idempotency_key: deterministicUuid("page59-staff-role-approval",
        actor.organizationId, actor.userId, input.idempotencyKey),
    }).maybeSingle();
    if (error || !data) throw failure(error?.code, true);
    const receipt = parseStaffRoleApprovalReceipt(data, input,
      actor.organizationId, actor.branchId);
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
