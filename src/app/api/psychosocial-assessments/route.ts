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
  parseCreatePsychosocialDraft,
  parsePsychosocialAssessmentMutation,
  parsePsychosocialOperationResult,
} from "@/lib/psychosocial-assessments/parser";
import type {
  CreatePsychosocialDraftInput,
  PsychosocialAssessmentMutationInput,
  PsychosocialAssessmentOperationResult,
} from "@/lib/psychosocial-assessments/types";
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
  responsible_user_id: string;
  service_status_at_assessment: string;
  reassessment_due_on: string;
  form_version_reference: string;
  committed_at: string;
  replayed: boolean;
};

function psychosocialFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "PSYCHOSOCIAL_NOT_AUTHORIZED",
      "目前角色、機構、分支、個案指派或工作階段不允許這項心理社會評估操作。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "PSYCHOSOCIAL_VERSION_CONFLICT",
      "評估已有新版本；請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "PSYCHOSOCIAL_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容；請保留資料並重新載入。",
      409,
    );
  }
  if (["23514", "23503", "55000"].includes(errorCode ?? "")) {
    return databaseFailure(
      "PSYCHOSOCIAL_STATE_CONFLICT",
      "評估已簽署、版本鏈已改變，或目前狀態不允許這項操作。",
      409,
    );
  }
  if (["22023", "22003", "23502"].includes(errorCode ?? "")) {
    return databaseFailure(
      "INVALID_PSYCHOSOCIAL_ASSESSMENT",
      "人工評估內容、日期、到期依據、結構化面向、理由或版本未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "PSYCHOSOCIAL_SAVE_FAILED",
    "心理社會評估尚未確認完成；請保留內容並使用相同冪等鍵重試。",
  );
}

async function authorize(
  permission: "social_work_records.manage" | "social_work_records.sign",
) {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只使用合成心理社會評估，不會寫入正式或本機資料。",
      403,
    );
  }
  if (
    !actor.scopes.includes("clients.read") ||
    !actor.scopes.includes("social_work_records.read") ||
    !actor.scopes.includes(permission)
  ) {
    throw new IntegrationError(
      "PSYCHOSOCIAL_NOT_AUTHORIZED",
      "目前角色沒有這項心理社會評估操作權限。",
      403,
    );
  }
  if (permission === "social_work_records.sign") await requireRecentAal2(actor);
  return actor;
}

function correlateReceipt(
  result: Omit<PsychosocialAssessmentOperationResult, "persisted" | "demo">,
  input: CreatePsychosocialDraftInput | PsychosocialAssessmentMutationInput,
  actor: TenantContext,
) {
  const expectedState = input.action === "create_draft" ||
    input.action === "revise_draft" ? "draft"
    : input.action === "sign" ? "signed" : "corrected";
  if (
    result.action !== input.action || result.clientId !== input.clientId ||
    result.recordState !== expectedState ||
    ("assessmentKey" in input && result.assessmentKey !== input.assessmentKey) ||
    ("expectedVersion" in input &&
      result.assessmentVersion !== input.expectedVersion + 1) ||
    (input.action === "create_draft" && (
      result.assessmentVersion !== 1 ||
      result.responsibleUserId !== actor.userId
    )) ||
    (input.action !== "sign" && (
      result.assessedOn !== input.assessedOn ||
      result.reassessmentDueOn !== input.reassessmentDueOn ||
      result.formVersionReference !== input.formVersionReference
    )) ||
    result.formVersionReference !== "manual-psychosocial-v1"
  ) {
    throw new IntegrationError(
      "PSYCHOSOCIAL_RECEIPT_INVALID",
      "資料庫完成憑證與本次評估操作不一致；畫面不會把操作當作成功。",
      502,
    );
  }
  return result;
}

async function executeCreate(
  input: CreatePsychosocialDraftInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式心理社會評估尚未設定。",
      503,
    );
  }
  const { data, error } = await supabase.rpc(
    "create_psychosocial_assessment_draft",
    {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_assessed_on: input.assessedOn,
      p_reassessment_due_on: input.reassessmentDueOn,
      p_due_basis: input.dueBasis,
      p_dimensions: input.dimensions,
      p_assessment_summary: input.assessmentSummary,
      p_form_version_reference: input.formVersionReference,
      p_idempotency_key: input.idempotencyKey,
    },
  ).maybeSingle<OperationRow>();
  if (error || !data) throw psychosocialFailure(error?.code);
  return correlateReceipt(
    parsePsychosocialOperationResult(data, input.action),
    input,
    actor,
  );
}

async function executeMutation(
  input: PsychosocialAssessmentMutationInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式心理社會評估尚未設定。",
      503,
    );
  }
  let result: {
    data: OperationRow | null;
    error: { code?: string } | null;
  };
  if (input.action === "revise_draft") {
    result = await supabase.rpc("revise_psychosocial_assessment_draft", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_assessment_key: input.assessmentKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_assessed_on: input.assessedOn,
      p_reassessment_due_on: input.reassessmentDueOn,
      p_due_basis: input.dueBasis,
      p_dimensions: input.dimensions,
      p_assessment_summary: input.assessmentSummary,
      p_form_version_reference: input.formVersionReference,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  } else if (input.action === "sign") {
    result = await supabase.rpc("sign_psychosocial_assessment", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_assessment_key: input.assessmentKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  } else {
    result = await supabase.rpc("correct_psychosocial_assessment", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_assessment_key: input.assessmentKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_assessed_on: input.assessedOn,
      p_reassessment_due_on: input.reassessmentDueOn,
      p_due_basis: input.dueBasis,
      p_dimensions: input.dimensions,
      p_assessment_summary: input.assessmentSummary,
      p_form_version_reference: input.formVersionReference,
      p_correction_reason: input.correctionReason,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  }
  if (result.error || !result.data) {
    throw psychosocialFailure(result.error?.code);
  }
  return correlateReceipt(
    parsePsychosocialOperationResult(result.data, input.action),
    input,
    actor,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize("social_work_records.manage");
    const input = parseCreatePsychosocialDraft(
      await readJsonObject(request, 32 * 1024),
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
    const actor = await authorizeStaffRequest();
    if (actor.demo) {
      throw new IntegrationError(
        "DEMO_READ_ONLY",
        "展示模式不會寫入心理社會評估。",
        403,
      );
    }
    const body = await readJsonObject(request, 32 * 1024);
    const signing = body.action === "sign" || body.action === "correct";
    const permission = signing
      ? "social_work_records.sign"
      : "social_work_records.manage";
    if (
      !actor.scopes.includes("clients.read") ||
      !actor.scopes.includes("social_work_records.read") ||
      !actor.scopes.includes(permission)
    ) {
      throw new IntegrationError(
        "PSYCHOSOCIAL_NOT_AUTHORIZED",
        "目前角色沒有這項心理社會評估操作權限。",
        403,
      );
    }
    if (signing) await requireRecentAal2(actor);
    const input = parsePsychosocialAssessmentMutation(
      body,
      request.headers.get("idempotency-key"),
    );
    const result = await executeMutation(input, actor);
    return ok(
      { ...result, persisted: true as const, demo: false as const },
      result.replayed ? 200 : 201,
      requestId,
    );
  });
}
