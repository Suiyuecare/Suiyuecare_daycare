import { ok } from "@/lib/api/response";
import {
  parseFormPublicationRequest,
  parseFormPublicationRequestResult,
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

function requestFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "FORM_PUBLICATION_NOT_AUTHORIZED",
      "目前角色、機構、分支或最近 15 分鐘重新驗證證據不允許送審。",
      403,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "FORM_PUBLICATION_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容，或此版本已有待核准申請；請重新載入。",
      409,
    );
  }
  if (errorCode === "23514") {
    return databaseFailure(
      "FORM_PUBLICATION_STATE_CONFLICT",
      "只有已設定生效日且仍為草稿的機構自訂版本可以送審。",
      409,
    );
  }
  if (errorCode === "22023") {
    return databaseFailure(
      "INVALID_FORM_PUBLICATION_REQUEST",
      "表單送審欄位未通過資料庫驗證。",
      400,
    );
  }
  return databaseFailure(
    "FORM_PUBLICATION_REQUEST_FAILED",
    "送審尚未確認完成；請保留畫面並以相同冪等鍵重試。",
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (!actor.demo && !actor.scopes.includes("forms.manage")) {
      throw new IntegrationError(
        "FORM_PUBLICATION_NOT_AUTHORIZED",
        "目前角色沒有表單與規則版本治理權限。",
        403,
      );
    }
    await requireRecentAal2(actor);
    if (actor.demo) {
      throw new IntegrationError(
        "DEMO_READ_ONLY",
        "展示模式僅供查看；表單送審不會模擬成功或寫入資料。",
        403,
      );
    }

    const input = parseFormPublicationRequest(
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
      .rpc("request_form_publication", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_form_version_id: input.formVersionId,
        p_idempotency_key: input.idempotencyKey,
      })
      .maybeSingle();
    if (error || !data) throw requestFailure(error?.code);

    const result = parseFormPublicationRequestResult(data);
    return ok(
      {
        publication: {
          requestId: result.requestId,
          formVersionId: input.formVersionId,
          status: result.status,
          formContentHash: result.formContentHash,
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
