import { ok } from "@/lib/api/response";
import {
  parseAdaptationAssessmentMutation,
  parseAdaptationAssessmentOperationResult,
  parseAdaptationFollowUpMutation,
  parseAdaptationFollowUpOperationResult,
  parseCreateAdaptationDraft,
} from "@/lib/adaptation-assessments/parser";
import type {
  AdaptationAssessmentMutationInput,
  AdaptationAssessmentOperationResult,
  AdaptationFollowUpMutationInput,
  AdaptationFollowUpOperationResult,
  CreateAdaptationDraftInput,
} from "@/lib/adaptation-assessments/types";
import type { TenantContext } from "@/lib/domain/types";
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

type AssessmentOperationRow = {
  operation_id: string;
  client_id: string;
  assessment_key: string;
  version_id: string;
  assessment_version: number;
  record_state: string;
  assessed_on: string;
  adaptation_status: string;
  reassessment_due_on: string;
  needs_follow_up: boolean;
  form_version_reference: string;
  committed_at: string;
  replayed: boolean;
};

type FollowUpOperationRow = {
  operation_id: string;
  client_id: string;
  assessment_key: string;
  follow_up_event_id: string;
  follow_up_sequence: number;
  follow_up_status: string;
  due_on: string | null;
  committed_at: string;
  replayed: boolean;
};

function adaptationFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "ADAPTATION_NOT_AUTHORIZED",
      "目前角色、機構、分支、個案指派或工作階段不允許這項適應評估操作。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "ADAPTATION_VERSION_CONFLICT",
      "評估或追蹤已有新版本；請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "ADAPTATION_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容；請保留資料並重新載入。",
      409,
    );
  }
  if (errorCode === "23514" || errorCode === "23503" || errorCode === "55000") {
    return databaseFailure(
      "ADAPTATION_STATE_CONFLICT",
      "評估已簽署、版本鏈已改變，或追蹤狀態不允許這項操作。",
      409,
    );
  }
  if (errorCode === "22023" || errorCode === "22003") {
    return databaseFailure(
      "INVALID_ADAPTATION_ASSESSMENT",
      "人工評估內容、日期、複評期限、追蹤資料、理由或版本未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "ADAPTATION_SAVE_FAILED",
    "適應評估操作尚未確認完成；請保留內容並使用相同冪等鍵重試。",
  );
}

async function authorize(
  permission: "social_work_records.manage" | "social_work_records.sign",
) {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只使用合成適應評估，不會寫入正式或本機資料。",
      403,
    );
  }
  if (
    !actor.scopes.includes("clients.read") ||
    !actor.scopes.includes("social_work_records.read") ||
    !actor.scopes.includes(permission)
  ) {
    throw new IntegrationError(
      "ADAPTATION_NOT_AUTHORIZED",
      "目前角色沒有這項適應評估操作權限。",
      403,
    );
  }
  if (permission === "social_work_records.sign") await requireRecentAal2(actor);
  return actor;
}

function correlateAssessmentReceipt(
  result: Omit<AdaptationAssessmentOperationResult, "persisted" | "demo">,
  input: CreateAdaptationDraftInput | AdaptationAssessmentMutationInput,
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
    (input.action === "create_draft" && result.assessmentVersion !== 1) ||
    (input.action !== "sign" && (
      result.assessedOn !== input.assessedOn ||
      result.adaptationStatus !== input.adaptationStatus ||
      result.reassessmentDueOn !== input.reassessmentDueOn ||
      result.needsFollowUp !== input.needsFollowUp ||
      result.formVersionReference !== input.formVersionReference
    )) || result.formVersionReference !== "manual-adaptation-v1"
  ) {
    throw new IntegrationError(
      "ADAPTATION_RECEIPT_INVALID",
      "資料庫完成憑證與本次評估操作不一致；畫面不會把操作當作成功。",
      502,
    );
  }
  return result;
}

function correlateFollowUpReceipt(
  result: Omit<AdaptationFollowUpOperationResult, "persisted" | "demo">,
  input: AdaptationFollowUpMutationInput,
) {
  const expectedStatus = input.action === "track" ? "pending"
    : input.action === "complete_follow_up" ? "completed" : "cancelled";
  if (
    result.action !== input.action || result.clientId !== input.clientId ||
    result.assessmentKey !== input.assessmentKey ||
    result.followUpStatus !== expectedStatus ||
    result.followUpSequence !== input.expectedSequence + 1 ||
    result.dueOn !== (input.action === "track" ? input.dueOn : null)
  ) {
    throw new IntegrationError(
      "ADAPTATION_RECEIPT_INVALID",
      "資料庫完成憑證與本次追蹤操作不一致；畫面不會把操作當作成功。",
      502,
    );
  }
  return result;
}

async function executeCreate(
  input: CreateAdaptationDraftInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式適應評估尚未設定。", 503);
  }
  const { data, error } = await supabase.rpc("create_adaptation_assessment_draft", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessed_on: input.assessedOn,
    p_adaptation_status: input.adaptationStatus,
    p_assessment_summary: input.assessmentSummary,
    p_reassessment_due_on: input.reassessmentDueOn,
    p_needs_follow_up: input.needsFollowUp,
    p_form_version_reference: input.formVersionReference,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<AssessmentOperationRow>();
  if (error || !data) throw adaptationFailure(error?.code);
  return correlateAssessmentReceipt(
    parseAdaptationAssessmentOperationResult(data, input.action), input,
  );
}

async function executeAssessmentMutation(
  input: AdaptationAssessmentMutationInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式適應評估尚未設定。", 503);
  }
  let result: { data: AssessmentOperationRow | null; error: { code?: string } | null };
  if (input.action === "revise_draft") {
    result = await supabase.rpc("revise_adaptation_assessment_draft", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_assessment_key: input.assessmentKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_assessed_on: input.assessedOn,
      p_adaptation_status: input.adaptationStatus,
      p_assessment_summary: input.assessmentSummary,
      p_reassessment_due_on: input.reassessmentDueOn,
      p_needs_follow_up: input.needsFollowUp,
      p_form_version_reference: input.formVersionReference,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<AssessmentOperationRow>();
  } else if (input.action === "sign") {
    result = await supabase.rpc("sign_adaptation_assessment", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_assessment_key: input.assessmentKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<AssessmentOperationRow>();
  } else {
    result = await supabase.rpc("correct_adaptation_assessment", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_assessment_key: input.assessmentKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_assessed_on: input.assessedOn,
      p_adaptation_status: input.adaptationStatus,
      p_assessment_summary: input.assessmentSummary,
      p_reassessment_due_on: input.reassessmentDueOn,
      p_needs_follow_up: input.needsFollowUp,
      p_form_version_reference: input.formVersionReference,
      p_correction_reason: input.correctionReason,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<AssessmentOperationRow>();
  }
  if (result.error || !result.data) throw adaptationFailure(result.error?.code);
  return correlateAssessmentReceipt(
    parseAdaptationAssessmentOperationResult(result.data, input.action), input,
  );
}

async function executeFollowUp(
  input: AdaptationFollowUpMutationInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式適應評估尚未設定。", 503);
  }
  const { data, error } = await supabase.rpc("mutate_adaptation_follow_up", {
    p_action: input.action,
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessment_key: input.assessmentKey,
    p_assessment_version_id: input.assessmentVersionId,
    p_expected_sequence: input.expectedSequence,
    p_due_on: input.dueOn,
    p_follow_up_plan: input.followUpPlan,
    p_follow_up_outcome: input.followUpOutcome,
    p_transition_reason: input.transitionReason,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<FollowUpOperationRow>();
  if (error || !data) throw adaptationFailure(error?.code);
  return correlateFollowUpReceipt(
    parseAdaptationFollowUpOperationResult(data, input.action), input,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize("social_work_records.manage");
    const input = parseCreateAdaptationDraft(
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
    const actor = await authorizeStaffRequest();
    if (actor.demo) {
      throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會寫入適應評估。", 403);
    }
    const body = await readJsonObject(request, 16 * 1024);
    const signing = body.action === "sign" || body.action === "correct";
    const permission = signing ? "social_work_records.sign" : "social_work_records.manage";
    if (
      !actor.scopes.includes("clients.read") ||
      !actor.scopes.includes("social_work_records.read") ||
      !actor.scopes.includes(permission)
    ) {
      throw new IntegrationError(
        "ADAPTATION_NOT_AUTHORIZED",
        "目前角色沒有這項適應評估操作權限。",
        403,
      );
    }
    if (signing) await requireRecentAal2(actor);

    const result = ["track", "complete_follow_up", "cancel_follow_up"].includes(
      String(body.action),
    )
      ? await executeFollowUp(
        parseAdaptationFollowUpMutation(body, request.headers.get("idempotency-key")),
        actor,
      )
      : await executeAssessmentMutation(
        parseAdaptationAssessmentMutation(body, request.headers.get("idempotency-key")),
        actor,
      );
    return ok(
      { ...result, persisted: true as const, demo: false as const },
      result.replayed ? 200 : 201,
      requestId,
    );
  });
}
