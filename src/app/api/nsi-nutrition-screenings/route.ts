import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import {
  buildNsiNutritionTrialPreview,
  parseCreateNsiNutritionDraft,
  parseNsiNutritionScreeningMutation,
  parseNsiNutritionOperationResult,
} from "@/lib/nsi-nutrition-screenings/parser";
import type {
  CreateNsiNutritionDraftInput,
  NsiNutritionScreeningOperationResult,
  ReviseNsiNutritionDraftInput,
  SignNsiNutritionScreeningInput,
} from "@/lib/nsi-nutrition-screenings/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OperationRow = {
  operation_id: string;
  client_id: string;
  assessment_key: string;
  version_id: string;
  assessment_version: number;
  record_state: string;
  assessed_on: string;
  author_user_id: string;
  service_status_at_assessment: string;
  rule_version_id: string;
  governance_status: string;
  preview_status: string;
  preview_observed_count: number | null;
  content_hash: string;
  committed_at: string;
  replayed: boolean;
};

function nsiNutritionFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "NSI_NUTRITION_NOT_AUTHORIZED",
      "目前角色、機構、分支、個案指派、權限或近期雙因素驗證不允許這項人工營養觀察草稿操作。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "NSI_NUTRITION_VERSION_CONFLICT",
      "候選草稿已有新版本；請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "NSI_NUTRITION_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容；請保留資料並重新載入。",
      409,
    );
  }
  if (errorCode === "55000") {
    return databaseFailure(
      "NSI_NUTRITION_RULE_NOT_ACTIVATED",
      "正式 NSI 題本、授權來源、權重與分類規則尚未經雙人核准發布；正式簽署、分數、風險分類、診斷、照顧決策、營養追蹤與轉介均已封鎖。",
      409,
    );
  }
  if (["23514", "23503"].includes(errorCode ?? "")) {
    return databaseFailure(
      "NSI_NUTRITION_STATE_CONFLICT",
      "候選草稿的不可變版本鏈或規則快照不允許這項操作。",
      409,
    );
  }
  if (["22023", "22003", "23502"].includes(errorCode ?? "")) {
    return databaseFailure(
      "INVALID_NSI_NUTRITION_SCREENING",
      "觀察日期、六項人工營養觀察或候選欄位版本未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "NSI_NUTRITION_SAVE_FAILED",
    "人工營養觀察草稿結果尚未確認；請保留內容並使用相同冪等鍵重試。",
  );
}

async function authorizeWrite(permission: "nsi_nutrition_screenings.manage" |
  "nsi_nutrition_screenings.sign") {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只使用合成人工營養觀察草稿，不會寫入正式或本機資料。",
      403,
    );
  }
  if (!actor.scopes.includes("clients.read") ||
    !actor.scopes.includes("nsi_nutrition_screenings.read") ||
    !actor.scopes.includes(permission)) {
    throw new IntegrationError(
      "NSI_NUTRITION_NOT_AUTHORIZED",
      "目前角色沒有這項人工營養觀察草稿權限。",
      403,
    );
  }
  // Authorization and recent AAL2 intentionally precede request body parsing.
  await requireRecentAal2(actor);
  return actor;
}

function correlateReceipt(
  result: Omit<NsiNutritionScreeningOperationResult, "persisted" | "demo">,
  input: CreateNsiNutritionDraftInput | ReviseNsiNutritionDraftInput,
  actor: TenantContext,
) {
  const preview = buildNsiNutritionTrialPreview(input.answers);
  if (result.action !== input.action || result.clientId !== input.clientId ||
    result.authorUserId !== actor.userId || result.assessedOn !== input.assessedOn ||
    result.ruleVersionId !== input.ruleVersionId ||
    result.governanceStatus !== "candidate_unactivated" ||
    result.previewStatus !== preview.status ||
    result.previewObservedCount !== preview.observedCount ||
    (input.action === "create_draft" && result.assessmentVersion !== 1) ||
    (input.action === "revise_draft" &&
      (result.assessmentKey !== input.assessmentKey ||
        result.assessmentVersion !== input.expectedVersion + 1))) {
    throw new IntegrationError(
      "NSI_NUTRITION_RECEIPT_INVALID",
      "資料庫完成憑證與本次人工營養觀察草稿不一致；畫面不會把操作當作成功。",
      502,
    );
  }
  return result;
}

async function executeCreate(input: CreateNsiNutritionDraftInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式人工營養觀察草稿服務尚未設定。", 503);
  }
  const { data, error } = await supabase.rpc("create_nsi_nutrition_screening_draft", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessed_on: input.assessedOn,
    p_answers: input.answers,
    p_rule_version_id: input.ruleVersionId,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<OperationRow>();
  if (error || !data) throw nsiNutritionFailure(error?.code);
  return correlateReceipt(parseNsiNutritionOperationResult(data, input.action), input, actor);
}

async function executeRevise(input: ReviseNsiNutritionDraftInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式人工營養觀察草稿服務尚未設定。", 503);
  }
  const { data, error } = await supabase.rpc("revise_nsi_nutrition_screening_draft", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessment_key: input.assessmentKey,
    p_previous_version_id: input.previousVersionId,
    p_expected_version: input.expectedVersion,
    p_assessed_on: input.assessedOn,
    p_answers: input.answers,
    p_rule_version_id: input.ruleVersionId,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<OperationRow>();
  if (error || !data) throw nsiNutritionFailure(error?.code);
  return correlateReceipt(parseNsiNutritionOperationResult(data, input.action), input, actor);
}

async function executeBlockedSign(
  input: SignNsiNutritionScreeningInput,
  actor: TenantContext,
): Promise<never> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式人工營養觀察草稿服務尚未設定。", 503);
  }
  const { error } = await supabase.rpc("sign_nsi_nutrition_screening", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessment_key: input.assessmentKey,
    p_previous_version_id: input.previousVersionId,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<{ blocked: boolean }>();
  if (error) throw nsiNutritionFailure(error.code);
  throw nsiNutritionFailure("55000");
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeWrite("nsi_nutrition_screenings.manage");
    const input = parseCreateNsiNutritionDraft(
      await readJsonObject(request, 128 * 1024),
      request.headers.get("idempotency-key"),
    );
    const result = await executeCreate(input, actor);
    return ok({ ...result, persisted: true as const, demo: false as const },
      result.replayed ? 200 : 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const declaredAction = request.headers.get("x-nsi-nutrition-operation");
    if (declaredAction !== "revise_draft" && declaredAction !== "sign") {
      throw new IntegrationError(
        "INVALID_NSI_NUTRITION_SCREENING",
        "請先宣告受治理的人工營養觀察操作。",
        400,
        "x-nsi-nutrition-operation",
      );
    }
    const actor = await authorizeWrite(declaredAction === "sign"
      ? "nsi_nutrition_screenings.sign" : "nsi_nutrition_screenings.manage");
    const input = parseNsiNutritionScreeningMutation(
      await readJsonObject(request, 128 * 1024),
      request.headers.get("idempotency-key"),
    );
    if (input.action !== declaredAction) {
      throw new IntegrationError(
        "INVALID_NSI_NUTRITION_SCREENING",
        "操作標頭與內容不一致。",
        400,
        "action",
      );
    }
    if (input.action === "sign") return executeBlockedSign(input, actor);
    const result = await executeRevise(input, actor);
    return ok({ ...result, persisted: true as const, demo: false as const },
      result.replayed ? 200 : 201, requestId);
  });
}
