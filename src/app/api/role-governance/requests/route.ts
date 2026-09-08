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
import {
  parseRoleGovernanceRequest,
  parseRoleGovernanceRequestResult,
} from "@/lib/role-governance/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "ROLE_GOVERNANCE_NOT_AUTHORIZED",
      "目前角色、機構、分支或最近 15 分鐘重新驗證證據不允許建立申請。",
      403,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "ROLE_GOVERNANCE_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容，或目標狀態已有相同變更；請重新載入。",
      409,
    );
  }
  if (["23514", "23503"].includes(errorCode ?? "")) {
    return databaseFailure(
      "ROLE_GOVERNANCE_STATE_CONFLICT",
      "角色、權限、成員狀態或身分類型已不符合申請條件；資料未變更。",
      409,
    );
  }
  if (errorCode === "22023") {
    return databaseFailure(
      "INVALID_ROLE_GOVERNANCE_REQUEST",
      "角色變更欄位未通過資料庫驗證。",
      400,
    );
  }
  return databaseFailure(
    "ROLE_GOVERNANCE_REQUEST_FAILED",
    "申請尚未確認完成；請保留畫面並以相同冪等鍵重試。",
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) {
      throw new IntegrationError(
        "DEMO_WRITE_DISABLED",
        "展示模式只提供合成資料檢視，角色治理申請不會執行或持久化。",
        403,
      );
    }
    if (!actor.demo && !actor.scopes.includes("roles.manage")) {
      throw new IntegrationError(
        "ROLE_GOVERNANCE_NOT_AUTHORIZED",
        "目前角色沒有角色與資料範圍治理權限。",
        403,
      );
    }
    await requireRecentAal2(actor);
    const input = parseRoleGovernanceRequest(
      await readJsonObject(request, 32 * 1024),
      request.headers.get("idempotency-key"),
    );

    // The browser never owns a new role identifier. Deriving it from the
    // authenticated tenant, actor, and idempotency key keeps network retries
    // exact without trusting or returning a client-authored UUID.
    const targetRoleId = input.operation === "create_role"
      ? deterministicUuid(
          "role-governance-create-v1",
          actor.organizationId,
          actor.userId,
          input.idempotencyKey,
        )
      : input.targetRoleId;
    const targetMembershipId =
      input.operation === "assign_role" || input.operation === "revoke_role"
        ? input.targetMembershipId
        : null;
    const targetPermissionKey =
      input.operation === "grant_permission" ||
      input.operation === "revoke_permission"
        ? input.permissionKey
        : null;
    const roleKey = input.operation === "create_role" ? input.roleKey : null;
    const roleName = input.operation === "create_role" ? input.roleName : null;
    const roleDescription =
      input.operation === "create_role" ? input.roleDescription : null;

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式角色治理資料服務尚未設定。",
        503,
      );
    }
    const { data, error } = await supabase
      .rpc("request_role_governance_change", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_operation: input.operation,
        p_target_role_id: targetRoleId,
        p_target_membership_id: targetMembershipId,
        p_permission_key: targetPermissionKey,
        p_role_key: roleKey,
        p_role_name: roleName,
        p_role_description: roleDescription,
        p_idempotency_key: input.idempotencyKey,
      })
      .maybeSingle();
    if (error || !data) throw requestFailure(error?.code);
    const result = parseRoleGovernanceRequestResult(data);

    return ok(
      {
        governanceRequest: {
          id: result.requestId,
          operation: input.operation,
          targetRoleId,
          targetMembershipId,
          targetPermissionKey,
          roleKey,
          roleName,
          roleDescription,
          status: result.status,
        },
        replayed: result.replayed,
        persisted: true,
        demo: false,
      },
      result.replayed ? 200 : 201,
      requestId,
    );
  });
}
