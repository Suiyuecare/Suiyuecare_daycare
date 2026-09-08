import { ok } from "@/lib/api/response";
import {
  parseClientMasterOperationResult,
  parseCreateLocalClient,
  parseUpdateLocalClient,
  hasClientMasterWriteAuthority,
} from "@/lib/clients/master";
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

type ClientMasterRpcRow = {
  operation_id: string;
  client_id: string;
  row_version: number;
  replayed: boolean;
};

function clientMasterFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "CLIENT_MASTER_NOT_AUTHORIZED",
      "目前角色、分支、個案指派、資料來源、狀態或重新驗證不允許這項主檔操作。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "CLIENT_MASTER_VERSION_CONFLICT",
      "個案資料已由其他人更新；請重新載入最新版本後再修改。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "CLIENT_MASTER_CONFLICT",
      "個案代碼已存在，或相同冪等鍵曾用於不同內容；請重新載入確認。",
      409,
    );
  }
  if (errorCode === "23514" || errorCode === "23503") {
    return databaseFailure(
      "CLIENT_MASTER_STATE_CONFLICT",
      "分支、個案狀態或主檔內容不符合目前操作條件。",
      409,
    );
  }
  if (errorCode === "22023" || errorCode === "22003") {
    return databaseFailure(
      "INVALID_CLIENT_MASTER",
      "個案代碼、姓名、出生日期或資料版本未通過資料庫驗證。",
      400,
    );
  }
  return databaseFailure(
    "CLIENT_MASTER_SAVE_FAILED",
    "個案主檔尚未確認完成；請保留內容並以相同冪等鍵重試。",
  );
}

async function authorizeClientMasterWrite(requireViewAll = false) {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只使用合成資料；新增與修改都不會寫入正式或本機資料。",
      403,
    );
  }
  if (!hasClientMasterWriteAuthority(
    actor.scopes,
    requireViewAll ? "create" : "update",
  )) {
    throw new IntegrationError(
      "CLIENT_MASTER_NOT_AUTHORIZED",
      requireViewAll
        ? "此表單包含出生日期；新增個案需要讀取、管理、出生日期欄位及分支內完整個案範圍權限。"
        : "此表單包含出生日期；目前角色需要讀取、管理及出生日期欄位權限。",
      403,
    );
  }
  await requireRecentAal2(actor);
  return actor;
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeClientMasterWrite(true);
    const input = parseCreateLocalClient(
      await readJsonObject(request, 32 * 1024),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式個案主檔服務尚未設定。",
        503,
      );
    }

    const { data, error } = await supabase
      .rpc("create_local_client", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_client_code: input.clientCode,
        p_display_name: input.displayName,
        p_date_of_birth: input.dateOfBirth,
        p_idempotency_key: input.idempotencyKey,
      })
      .maybeSingle<ClientMasterRpcRow>();
    if (error || !data) throw clientMasterFailure(error?.code);
    const result = parseClientMasterOperationResult(data);

    return ok(
      { ...result, persisted: true, demo: false },
      result.replayed ? 200 : 201,
      requestId,
    );
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeClientMasterWrite();
    const input = parseUpdateLocalClient(
      await readJsonObject(request, 32 * 1024),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式個案主檔服務尚未設定。",
        503,
      );
    }

    const { data, error } = await supabase
      .rpc("update_local_client", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_client_id: input.clientId,
        p_client_code: input.clientCode,
        p_display_name: input.displayName,
        p_date_of_birth: input.dateOfBirth,
        p_expected_row_version: input.expectedRowVersion,
        p_idempotency_key: input.idempotencyKey,
      })
      .maybeSingle<ClientMasterRpcRow>();
    if (error || !data) throw clientMasterFailure(error?.code);
    const result = parseClientMasterOperationResult(data, input.clientId);

    return ok(
      { ...result, persisted: true, demo: false },
      200,
      requestId,
    );
  });
}
