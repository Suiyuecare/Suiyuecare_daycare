import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import {
  parseRoleGovernanceApproval,
  parseRoleGovernanceApprovalResult,
} from "@/lib/role-governance/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function approvalFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "ROLE_GOVERNANCE_APPROVAL_NOT_AUTHORIZED",
      "目前角色、分支、雙人分工或最近 15 分鐘重新驗證證據不允許核准。",
      403,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "ROLE_GOVERNANCE_APPROVAL_CONFLICT",
      "相同冪等鍵曾用於另一筆核准，或這筆申請已由其他人決定。",
      409,
    );
  }
  if (["23514", "23503", "40001", "55000"].includes(errorCode ?? "")) {
    return databaseFailure(
      "ROLE_GOVERNANCE_STATE_CONFLICT",
      "送審後角色、權限、成員或身分類型狀態已變更；核准未套用。",
      409,
    );
  }
  if (errorCode === "22023") {
    return databaseFailure(
      "INVALID_ROLE_GOVERNANCE_APPROVAL",
      "角色變更核准欄位未通過資料庫驗證。",
      400,
    );
  }
  return databaseFailure(
    "ROLE_GOVERNANCE_APPROVAL_FAILED",
    "核准尚未確認完成；請保留畫面並以相同冪等鍵重試。",
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) {
      throw new IntegrationError(
        "DEMO_WRITE_DISABLED",
        "展示模式只提供合成資料檢視，角色治理核准不會執行或持久化。",
        403,
      );
    }
    if (!actor.demo && !actor.scopes.includes("roles.manage")) {
      throw new IntegrationError(
        "ROLE_GOVERNANCE_APPROVAL_NOT_AUTHORIZED",
        "目前角色沒有角色與資料範圍治理權限。",
        403,
      );
    }
    await requireRecentAal2(actor);
    const input = parseRoleGovernanceApproval(
      await readJsonObject(request, 16 * 1024),
      request.headers.get("idempotency-key"),
    );

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式角色治理資料服務尚未設定。",
        503,
      );
    }
    const { data, error } = await supabase
      .rpc("approve_role_governance_change", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_request_id: input.requestId,
        p_idempotency_key: input.idempotencyKey,
      })
      .maybeSingle();
    if (error || !data) throw approvalFailure(error?.code);
    const result = parseRoleGovernanceApprovalResult(data, input.requestId);

    return ok(
      {
        governanceRequest: {
          id: result.requestId,
          status: result.status,
          appliedAt: result.appliedAt,
        },
        replayed: result.replayed,
        persisted: true,
        demo: false,
      },
      200,
      requestId,
    );
  });
}
