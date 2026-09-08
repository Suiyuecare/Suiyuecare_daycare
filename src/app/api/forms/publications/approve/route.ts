import { ok } from "@/lib/api/response";
import {
  parseFormPublicationApproval,
  parseFormPublicationApprovalResult,
} from "@/lib/form-governance/parser";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function approvalFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "FORM_PUBLICATION_APPROVAL_NOT_AUTHORIZED",
      "目前角色、分支、雙人分工或最近 15 分鐘重新驗證證據不允許核准。",
      403,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "FORM_PUBLICATION_APPROVAL_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於另一筆核准，或這筆申請已由其他決定完成。",
      409,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "FORM_PUBLICATION_CONTENT_CHANGED",
      "送審後表單名稱、欄位或計分規則已變更，禁止核准；請重新建立送審版本。",
      409,
    );
  }
  if (errorCode === "23P01") {
    return databaseFailure(
      "FORM_PUBLICATION_PERIOD_OVERLAP",
      "生效期間與已發布或歷史版本重疊，禁止發布。",
      409,
    );
  }
  if (["23514", "23503", "55000"].includes(errorCode ?? "")) {
    return databaseFailure(
      "FORM_PUBLICATION_STATE_CONFLICT",
      "此申請、草稿或版本狀態已不符合核准條件；請重新載入。",
      409,
    );
  }
  if (errorCode === "22023") {
    return databaseFailure(
      "INVALID_FORM_PUBLICATION_APPROVAL",
      "表單核准欄位未通過資料庫驗證。",
      400,
    );
  }
  return databaseFailure(
    "FORM_PUBLICATION_APPROVAL_FAILED",
    "核准尚未確認完成；請保留畫面並以相同冪等鍵重試。",
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (!actor.demo && !actor.scopes.includes("forms.manage")) {
      throw new IntegrationError(
        "FORM_PUBLICATION_APPROVAL_NOT_AUTHORIZED",
        "目前角色沒有表單與規則版本治理權限。",
        403,
      );
    }
    await requireRecentAal2(actor);
    if (actor.demo) {
      throw new IntegrationError(
        "DEMO_READ_ONLY",
        "展示模式僅供查看；表單核准不會模擬成功或寫入資料。",
        403,
      );
    }

    const input = parseFormPublicationApproval(
      await readJsonObject(request, 4 * 1024),
      request.headers.get("idempotency-key"),
    );

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式表單治理資料服務尚未設定。",
        503,
      );
    }

    const { data, error } = await supabase
      .rpc("approve_form_publication", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_request_id: input.requestId,
        p_idempotency_key: input.idempotencyKey,
      })
      .maybeSingle();
    if (error || !data) throw approvalFailure(error?.code);

    const result = parseFormPublicationApprovalResult(data, input.requestId);
    return ok(
      {
        publication: {
          requestId: result.requestId,
          formVersionId: result.formVersionId,
          status: result.status,
          publishedAt: result.publishedAt,
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
