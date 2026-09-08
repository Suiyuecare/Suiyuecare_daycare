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
  buildChewingTrialPreview,
  parseCreateChewingDraft,
  parseChewingAssessmentMutation,
  parseChewingOperationResult,
} from "@/lib/chewing-assessments/parser";
import type {
  CreateChewingDraftInput,
  CorrectChewingAssessmentInput,
  ChewingAssessmentOperationResult,
  ReviseChewingDraftInput,
  SignChewingAssessmentInput,
} from "@/lib/chewing-assessments/types";
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

function chewingFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "CHEWING_NOT_AUTHORIZED",
      "目前專業身分、機構、分支、個案指派、權限或近期雙因素驗證不允許這項人工咀嚼觀察操作。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "CHEWING_VERSION_CONFLICT",
      "候選草稿已有新版本；請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "CHEWING_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容；請保留資料並重新載入。",
      409,
    );
  }
  if (errorCode === "55000") {
    return databaseFailure(
      "CHEWING_RULE_NOT_ACTIVATED",
      "正式咀嚼評估工具、授權來源、權重與能力分級規則尚未經雙人核准發布；正式簽署、更正生效、分數、能力分級、診斷、照顧決策與營養／吞嚥轉介均已封鎖。",
      409,
    );
  }
  if (["23514", "23503"].includes(errorCode ?? "")) {
    return databaseFailure(
      "CHEWING_STATE_CONFLICT",
      "候選草稿的不可變版本鏈或規則快照不允許這項操作。",
      409,
    );
  }
  if (["22023", "22003", "23502"].includes(errorCode ?? "")) {
    return databaseFailure(
      "INVALID_CHEWING_ASSESSMENT",
      "觀察日期、六項人工咀嚼觀察、候選欄位版本或更正理由未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "CHEWING_SAVE_FAILED",
    "人工咀嚼觀察草稿結果尚未確認；請保留內容並使用相同冪等鍵重試。",
  );
}

async function authorizeWrite(permission: "chewing_assessments.manage" |
  "chewing_assessments.sign") {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只使用合成人工咀嚼觀察草稿，不會寫入正式或本機資料。",
      403,
    );
  }
  if (!actor.roles.includes("professional") ||
    !actor.scopes.includes("clients.read") ||
    !actor.scopes.includes("chewing_assessments.read") ||
    !actor.scopes.includes(permission)) {
    throw new IntegrationError(
      "CHEWING_NOT_AUTHORIZED",
      "目前身分不是具備咀嚼評估專頁權限的專業人員。",
      403,
    );
  }
  // Authorization and recent AAL2 intentionally precede request body parsing.
  await requireRecentAal2(actor);
  return actor;
}

function correlateReceipt(
  result: Omit<ChewingAssessmentOperationResult, "persisted" | "demo">,
  input: CreateChewingDraftInput | ReviseChewingDraftInput,
  actor: TenantContext,
) {
  const preview = buildChewingTrialPreview(input.answers);
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
      "CHEWING_RECEIPT_INVALID",
      "資料庫完成憑證與本次人工咀嚼觀察草稿不一致；畫面不會把操作當作成功。",
      502,
    );
  }
  return result;
}

async function executeCreate(input: CreateChewingDraftInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式人工咀嚼觀察草稿服務尚未設定。", 503);
  }
  const { data, error } = await supabase.rpc("create_chewing_assessment_draft", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessed_on: input.assessedOn,
    p_answers: input.answers,
    p_rule_version_id: input.ruleVersionId,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<OperationRow>();
  if (error || !data) throw chewingFailure(error?.code);
  return correlateReceipt(parseChewingOperationResult(data, input.action), input, actor);
}

async function executeRevise(input: ReviseChewingDraftInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式人工咀嚼觀察草稿服務尚未設定。", 503);
  }
  const { data, error } = await supabase.rpc("revise_chewing_assessment_draft", {
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
  if (error || !data) throw chewingFailure(error?.code);
  return correlateReceipt(parseChewingOperationResult(data, input.action), input, actor);
}

async function executeBlockedSign(
  input: SignChewingAssessmentInput,
  actor: TenantContext,
): Promise<never> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式人工咀嚼觀察草稿服務尚未設定。", 503);
  }
  const { error } = await supabase.rpc("sign_chewing_assessment", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessment_key: input.assessmentKey,
    p_previous_version_id: input.previousVersionId,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<{ blocked: boolean }>();
  if (error) throw chewingFailure(error.code);
  throw chewingFailure("55000");
}

async function executeBlockedCorrection(
  input: CorrectChewingAssessmentInput,
  actor: TenantContext,
): Promise<never> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式人工咀嚼觀察草稿服務尚未設定。", 503);
  }
  const { error } = await supabase.rpc("correct_chewing_assessment", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessment_key: input.assessmentKey,
    p_previous_version_id: input.previousVersionId,
    p_expected_version: input.expectedVersion,
    p_correction_reason: input.correctionReason,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<{ blocked: boolean }>();
  if (error) throw chewingFailure(error.code);
  throw chewingFailure("55000");
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeWrite("chewing_assessments.manage");
    const input = parseCreateChewingDraft(
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
    const declaredAction = request.headers.get("x-chewing-operation");
    if (declaredAction !== "revise_draft" && declaredAction !== "sign" &&
      declaredAction !== "correct") {
      throw new IntegrationError(
        "INVALID_CHEWING_ASSESSMENT",
        "請先宣告受治理的人工咀嚼觀察操作。",
        400,
        "x-chewing-operation",
      );
    }
    const actor = await authorizeWrite(declaredAction === "sign" ||
      declaredAction === "correct"
      ? "chewing_assessments.sign" : "chewing_assessments.manage");
    const input = parseChewingAssessmentMutation(
      await readJsonObject(request, 128 * 1024),
      request.headers.get("idempotency-key"),
    );
    if (input.action !== declaredAction) {
      throw new IntegrationError(
        "INVALID_CHEWING_ASSESSMENT",
        "操作標頭與內容不一致。",
        400,
        "action",
      );
    }
    if (input.action === "sign") return executeBlockedSign(input, actor);
    if (input.action === "correct") return executeBlockedCorrection(input, actor);
    const result = await executeRevise(input, actor);
    return ok({ ...result, persisted: true as const, demo: false as const },
      result.replayed ? 200 : 201, requestId);
  });
}
