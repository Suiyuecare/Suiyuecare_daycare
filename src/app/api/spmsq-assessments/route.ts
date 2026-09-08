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
  buildSpmsqTrialPreview,
  parseCreateSpmsqDraft,
  parseSpmsqAssessmentMutation,
  parseSpmsqOperationResult,
} from "@/lib/spmsq-assessments/parser";
import type {
  CreateSpmsqDraftInput,
  ReviseSpmsqDraftInput,
  SignSpmsqAssessmentInput,
  SpmsqAssessmentOperationResult,
} from "@/lib/spmsq-assessments/types";
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
  preview_raw_errors: number | null;
  preview_adjusted_errors: number | null;
  preview_band_key: string | null;
  committed_at: string;
  replayed: boolean;
};

function spmsqFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "SPMSQ_NOT_AUTHORIZED",
      "目前角色、機構、分支、個案指派、權限或近期雙因素驗證不允許這項 SPMSQ 草稿操作。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "SPMSQ_VERSION_CONFLICT",
      "候選草稿已有新版本；請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "SPMSQ_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容；請保留資料並重新載入。",
      409,
    );
  }
  if (errorCode === "55000") {
    return databaseFailure(
      "SPMSQ_RULE_NOT_ACTIVATED",
      "候選規則尚未正式核准生效；系統已封鎖正式簽署與照顧決策。",
      409,
    );
  }
  if (["23514", "23503"].includes(errorCode ?? "")) {
    return databaseFailure(
      "SPMSQ_STATE_CONFLICT",
      "候選草稿的不可變版本鏈或規則快照不允許這項操作。",
      409,
    );
  }
  if (["22023", "22003", "23502"].includes(errorCode ?? "")) {
    return databaseFailure(
      "INVALID_SPMSQ_ASSESSMENT",
      "評估日期、十題答案、教育脈絡、文化脈絡或規則版本未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "SPMSQ_SAVE_FAILED",
    "SPMSQ 候選草稿尚未確認完成；請保留內容並使用相同冪等鍵重試。",
  );
}

async function authorizeWrite() {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只使用合成 SPMSQ 草稿，不會寫入正式或本機資料。",
      403,
    );
  }
  if (
    !actor.scopes.includes("clients.read") ||
    !actor.scopes.includes("assessments.read") ||
    !actor.scopes.includes("assessments.manage")
  ) {
    throw new IntegrationError(
      "SPMSQ_NOT_AUTHORIZED",
      "目前角色沒有 SPMSQ 候選草稿的查看與管理權限。",
      403,
    );
  }
  // Every Page 11 write is high-risk. This check intentionally happens before
  // request.json()/request.text() so unauthorized content is never accepted.
  await requireRecentAal2(actor);
  return actor;
}

function correlateReceipt(
  result: Omit<SpmsqAssessmentOperationResult, "persisted" | "demo">,
  input: CreateSpmsqDraftInput | ReviseSpmsqDraftInput,
  actor: TenantContext,
) {
  const preview = buildSpmsqTrialPreview(
    input.answers,
    input.educationContext,
  );
  if (
    result.action !== input.action || result.clientId !== input.clientId ||
    result.authorUserId !== actor.userId ||
    result.assessedOn !== input.assessedOn ||
    result.ruleVersionId !== input.ruleVersionId ||
    result.governanceStatus !== "candidate_unactivated" ||
    result.previewStatus !== preview.status ||
    result.previewRawErrors !== preview.rawErrors ||
    result.previewAdjustedErrors !== preview.adjustedErrors ||
    result.previewBandKey !== preview.bandKey ||
    (input.action === "create_draft" && result.assessmentVersion !== 1) ||
    (input.action === "revise_draft" && (
      result.assessmentKey !== input.assessmentKey ||
      result.assessmentVersion !== input.expectedVersion + 1
    ))
  ) {
    throw new IntegrationError(
      "SPMSQ_RECEIPT_INVALID",
      "資料庫完成憑證與本次候選草稿不一致；畫面不會把操作當作成功。",
      502,
    );
  }
  return result;
}

async function executeCreate(
  input: CreateSpmsqDraftInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式 SPMSQ 草稿服務尚未設定。", 503);
  }
  const { data, error } = await supabase.rpc("create_spmsq_assessment_draft", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessed_on: input.assessedOn,
    p_answers: input.answers,
    p_education_context: input.educationContext,
    p_cultural_context: input.culturalContext,
    p_rule_version_id: input.ruleVersionId,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<OperationRow>();
  if (error || !data) throw spmsqFailure(error?.code);
  return correlateReceipt(
    parseSpmsqOperationResult(data, input.action),
    input,
    actor,
  );
}

async function executeRevise(
  input: ReviseSpmsqDraftInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式 SPMSQ 草稿服務尚未設定。", 503);
  }
  const { data, error } = await supabase.rpc("revise_spmsq_assessment_draft", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessment_key: input.assessmentKey,
    p_previous_version_id: input.previousVersionId,
    p_expected_version: input.expectedVersion,
    p_assessed_on: input.assessedOn,
    p_answers: input.answers,
    p_education_context: input.educationContext,
    p_cultural_context: input.culturalContext,
    p_rule_version_id: input.ruleVersionId,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<OperationRow>();
  if (error || !data) throw spmsqFailure(error?.code);
  return correlateReceipt(
    parseSpmsqOperationResult(data, input.action),
    input,
    actor,
  );
}

async function executeBlockedSign(
  input: SignSpmsqAssessmentInput,
  actor: TenantContext,
): Promise<never> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式 SPMSQ 草稿服務尚未設定。", 503);
  }
  const { error } = await supabase.rpc("sign_spmsq_assessment", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessment_key: input.assessmentKey,
    p_previous_version_id: input.previousVersionId,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<{ blocked: boolean }>();
  if (error) throw spmsqFailure(error.code);
  throw spmsqFailure("55000");
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeWrite();
    const input = parseCreateSpmsqDraft(
      await readJsonObject(request, 96 * 1024),
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
    const actor = await authorizeWrite();
    const input = parseSpmsqAssessmentMutation(
      await readJsonObject(request, 96 * 1024),
      request.headers.get("idempotency-key"),
    );
    if (input.action === "sign") return executeBlockedSign(input, actor);
    const result = await executeRevise(input, actor);
    return ok(
      { ...result, persisted: true as const, demo: false as const },
      result.replayed ? 200 : 201,
      requestId,
    );
  });
}
