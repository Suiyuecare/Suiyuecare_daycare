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
  buildFallRiskTrialPreview,
  parseCreateFallRiskDraft,
  parseFallRiskAssessmentMutation,
  parseFallRiskOperationResult,
} from "@/lib/fall-risk-assessments/parser";
import type {
  CreateFallRiskDraftInput,
  FallRiskAssessmentOperationResult,
  ReviseFallRiskDraftInput,
  SignFallRiskAssessmentInput,
} from "@/lib/fall-risk-assessments/types";
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
  preview_candidate_points: number | null;
  preview_band_key: string | null;
  content_hash: string;
  committed_at: string;
  replayed: boolean;
};

function fallRiskFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "FALL_RISK_NOT_AUTHORIZED",
      "目前角色、機構、分支、個案指派、權限或近期雙因素驗證不允許這項跌倒風險候選草稿操作。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "FALL_RISK_VERSION_CONFLICT",
      "候選草稿已有新版本；請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "FALL_RISK_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容；請保留資料並重新載入。",
      409,
    );
  }
  if (errorCode === "55000") {
    return databaseFailure(
      "FALL_RISK_RULE_NOT_ACTIVATED",
      "候選規則尚未經雙人核准啟用；正式簽署、風險分類與照顧決策均已封鎖。",
      409,
    );
  }
  if (["23514", "23503"].includes(errorCode ?? "")) {
    return databaseFailure(
      "FALL_RISK_STATE_CONFLICT",
      "候選草稿的不可變版本鏈或規則快照不允許這項操作。",
      409,
    );
  }
  if (["22023", "22003", "23502"].includes(errorCode ?? "")) {
    return databaseFailure(
      "INVALID_FALL_RISK_ASSESSMENT",
      "評估日期、六項人工因子或候選規則版本未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "FALL_RISK_SAVE_FAILED",
    "跌倒風險候選草稿結果尚未確認；請保留內容並使用相同冪等鍵重試。",
  );
}

async function authorizeWrite(permission: "fall_risk_assessments.manage" |
  "fall_risk_assessments.sign") {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只使用合成跌倒風險候選草稿，不會寫入正式或本機資料。",
      403,
    );
  }
  if (!actor.scopes.includes("clients.read") ||
    !actor.scopes.includes("fall_risk_assessments.read") ||
    !actor.scopes.includes(permission)) {
    throw new IntegrationError(
      "FALL_RISK_NOT_AUTHORIZED",
      "目前角色沒有這項跌倒風險候選草稿權限。",
      403,
    );
  }
  // Authorization and recent AAL2 intentionally precede request body parsing.
  await requireRecentAal2(actor);
  return actor;
}

function correlateReceipt(
  result: Omit<FallRiskAssessmentOperationResult, "persisted" | "demo">,
  input: CreateFallRiskDraftInput | ReviseFallRiskDraftInput,
  actor: TenantContext,
) {
  const preview = buildFallRiskTrialPreview(input.answers);
  if (result.action !== input.action || result.clientId !== input.clientId ||
    result.authorUserId !== actor.userId || result.assessedOn !== input.assessedOn ||
    result.ruleVersionId !== input.ruleVersionId ||
    result.governanceStatus !== "candidate_unactivated" ||
    result.previewStatus !== preview.status ||
    result.previewCandidatePoints !== preview.candidatePoints ||
    result.previewBandKey !== preview.bandKey ||
    (input.action === "create_draft" && result.assessmentVersion !== 1) ||
    (input.action === "revise_draft" &&
      (result.assessmentKey !== input.assessmentKey ||
        result.assessmentVersion !== input.expectedVersion + 1))) {
    throw new IntegrationError(
      "FALL_RISK_RECEIPT_INVALID",
      "資料庫完成憑證與本次候選草稿不一致；畫面不會把操作當作成功。",
      502,
    );
  }
  return result;
}

async function executeCreate(input: CreateFallRiskDraftInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式跌倒風險候選草稿服務尚未設定。", 503);
  }
  const { data, error } = await supabase.rpc("create_fall_risk_assessment_draft", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessed_on: input.assessedOn,
    p_answers: input.answers,
    p_rule_version_id: input.ruleVersionId,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<OperationRow>();
  if (error || !data) throw fallRiskFailure(error?.code);
  return correlateReceipt(parseFallRiskOperationResult(data, input.action), input, actor);
}

async function executeRevise(input: ReviseFallRiskDraftInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式跌倒風險候選草稿服務尚未設定。", 503);
  }
  const { data, error } = await supabase.rpc("revise_fall_risk_assessment_draft", {
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
  if (error || !data) throw fallRiskFailure(error?.code);
  return correlateReceipt(parseFallRiskOperationResult(data, input.action), input, actor);
}

async function executeBlockedSign(
  input: SignFallRiskAssessmentInput,
  actor: TenantContext,
): Promise<never> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式跌倒風險候選草稿服務尚未設定。", 503);
  }
  const { error } = await supabase.rpc("sign_fall_risk_assessment", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessment_key: input.assessmentKey,
    p_previous_version_id: input.previousVersionId,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<{ blocked: boolean }>();
  if (error) throw fallRiskFailure(error.code);
  throw fallRiskFailure("55000");
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeWrite("fall_risk_assessments.manage");
    const input = parseCreateFallRiskDraft(
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
    const declaredAction = request.headers.get("x-fall-risk-operation");
    if (declaredAction !== "revise_draft" && declaredAction !== "sign") {
      throw new IntegrationError(
        "INVALID_FALL_RISK_ASSESSMENT",
        "請先宣告受治理的跌倒風險候選操作。",
        400,
        "x-fall-risk-operation",
      );
    }
    const actor = await authorizeWrite(declaredAction === "sign"
      ? "fall_risk_assessments.sign" : "fall_risk_assessments.manage");
    const input = parseFallRiskAssessmentMutation(
      await readJsonObject(request, 128 * 1024),
      request.headers.get("idempotency-key"),
    );
    if (input.action !== declaredAction) {
      throw new IntegrationError(
        "INVALID_FALL_RISK_ASSESSMENT",
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
