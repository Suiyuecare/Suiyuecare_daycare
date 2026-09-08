import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import {
  parseCreateSocialResource,
  parseSocialResourceMutation,
  parseSocialResourceOperationResult,
} from "@/lib/social-resources/parser";
import type {
  CreateSocialResourceInput,
  SocialResourceMutationInput,
} from "@/lib/social-resources/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OperationRow = {
  operation_id: string;
  resource_id: string;
  row_version: number;
  status: string;
  last_confirmed_on: string | null;
  replayed: boolean;
};

function socialResourceFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "SOCIAL_RESOURCE_NOT_AUTHORIZED",
      "目前角色、機構、分支或工作階段不允許這項社會資源操作。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "SOCIAL_RESOURCE_VERSION_CONFLICT",
      "資源已由其他人更新；請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "SOCIAL_RESOURCE_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容；請重新載入確認。",
      409,
    );
  }
  if (errorCode === "23514" || errorCode === "23503") {
    return databaseFailure(
      "SOCIAL_RESOURCE_STATE_CONFLICT",
      "資源狀態、有效期間或分支關聯不允許這項操作。",
      409,
    );
  }
  if (errorCode === "22023" || errorCode === "22003") {
    return databaseFailure(
      "INVALID_SOCIAL_RESOURCE",
      "資源欄位、明確資訊狀態、日期或版本未通過資料庫驗證。",
      400,
    );
  }
  return databaseFailure(
    "SOCIAL_RESOURCE_SAVE_FAILED",
    "社會資源操作尚未確認完成；請保留內容並使用相同冪等鍵重試。",
  );
}

async function authorizeSocialResourceManagement() {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只使用合成資源；不會寫入正式或本機資料。",
      403,
    );
  }
  if (!actor.scopes.includes("social_resources.manage")) {
    throw new IntegrationError(
      "SOCIAL_RESOURCE_NOT_AUTHORIZED",
      "目前角色沒有管理社會資源的權限。",
      403,
    );
  }
  return actor;
}

async function executeCreate(input: CreateSocialResourceInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式社會資源服務尚未設定。", 503);
  const { data, error } = await supabase.rpc("create_social_resource", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_reference_year: input.referenceYear,
    p_name: input.name,
    p_resource_type: input.resourceType,
    p_audience_state: input.audienceState,
    p_audience_detail: input.audienceDetail,
    p_eligibility_state: input.eligibilityState,
    p_eligibility_detail: input.eligibilityDetail,
    p_contact_state: input.contactState,
    p_contact_detail: input.contactDetail,
    p_validity_state: input.validityState,
    p_valid_from: input.validFrom,
    p_valid_until: input.validUntil,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<OperationRow>();
  if (error || !data) throw socialResourceFailure(error?.code);
  return parseSocialResourceOperationResult(data);
}

async function executeMutation(input: SocialResourceMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式社會資源服務尚未設定。", 503);
  let result: { data: OperationRow | null; error: { code?: string } | null };
  if (input.action === "update") {
    result = await supabase.rpc("update_social_resource", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_resource_id: input.resourceId,
      p_reference_year: input.referenceYear,
      p_name: input.name,
      p_resource_type: input.resourceType,
      p_audience_state: input.audienceState,
      p_audience_detail: input.audienceDetail,
      p_eligibility_state: input.eligibilityState,
      p_eligibility_detail: input.eligibilityDetail,
      p_contact_state: input.contactState,
      p_contact_detail: input.contactDetail,
      p_validity_state: input.validityState,
      p_valid_from: input.validFrom,
      p_valid_until: input.validUntil,
      p_expected_row_version: input.expectedRowVersion,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  } else if (input.action === "confirm") {
    result = await supabase.rpc("confirm_social_resource", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_resource_id: input.resourceId,
      p_expected_row_version: input.expectedRowVersion,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  } else {
    result = await supabase.rpc("deactivate_social_resource", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_resource_id: input.resourceId,
      p_expected_row_version: input.expectedRowVersion,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  }
  const { data, error } = result;
  if (error || !data) throw socialResourceFailure(error?.code);
  return parseSocialResourceOperationResult(data);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    // Authorization deliberately precedes body parsing so unauthenticated or
    // demo callers cannot use validation differences as an oracle.
    const actor = await authorizeSocialResourceManagement();
    const input = parseCreateSocialResource(
      await readJsonObject(request, 16 * 1024),
      request.headers.get("idempotency-key"),
    );
    const result = await executeCreate(input, actor);
    return ok(
      { ...result, persisted: true as const, demo: false as const },
      result.replayed ? 200 : 201,
      requestId,
    );
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeSocialResourceManagement();
    const input = parseSocialResourceMutation(
      await readJsonObject(request, 16 * 1024),
      request.headers.get("idempotency-key"),
    );
    const result = await executeMutation(input, actor);
    return ok(
      { ...result, persisted: true as const, demo: false as const },
      200,
      requestId,
    );
  });
}
