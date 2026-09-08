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
  parseCreatePhysicalTherapyDraft,
  parsePhysicalTherapyAssessmentMutation,
  parsePhysicalTherapyOperationResult,
} from "@/lib/physical-therapy-assessments/parser";
import type {
  CreatePhysicalTherapyDraftInput,
  PhysicalTherapyAssessmentMutationInput,
  PhysicalTherapyAssessmentOperationResult,
} from "@/lib/physical-therapy-assessments/types";
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
  therapist_user_id: string;
  service_status_at_assessment: string;
  reassessment_due_on: string;
  form_version_reference: string;
  committed_at: string;
  replayed: boolean;
};

type PhysicalTherapyOperation =
  "create_draft" | "revise_draft" | "sign" | "correct";

function requireOperationHeader(
  request: Request,
  allowed: readonly PhysicalTherapyOperation[],
) {
  const operation = request.headers.get("x-physical-therapy-operation");
  if (!allowed.includes(operation as PhysicalTherapyOperation)) {
    throw new IntegrationError(
      "INVALID_PHYSICAL_THERAPY_ASSESSMENT",
      "缺少或不支援的物理治療評估操作標頭。",
      400,
      "x-physical-therapy-operation",
    );
  }
  return operation as PhysicalTherapyOperation;
}

function physicalTherapyFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "PHYSICAL_THERAPY_NOT_AUTHORIZED",
      "目前專業身分、權限、機構、分支、個案指派或工作階段不允許這項物理治療評估操作。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "PHYSICAL_THERAPY_VERSION_CONFLICT",
      "評估已有新版本；請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "PHYSICAL_THERAPY_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容；請保留資料並重新載入。",
      409,
    );
  }
  if (["23514", "23503", "55000"].includes(errorCode ?? "")) {
    return databaseFailure(
      "PHYSICAL_THERAPY_STATE_CONFLICT",
      "評估已簽署、版本鏈已改變，或目前狀態不允許這項操作。",
      409,
    );
  }
  if (["22023", "22003", "23502"].includes(errorCode ?? "")) {
    return databaseFailure(
      "INVALID_PHYSICAL_THERAPY_ASSESSMENT",
      "人工評估內容、日期、到期依據、測量項目、理由或版本未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "PHYSICAL_THERAPY_SAVE_FAILED",
    "物理治療評估尚未確認完成；請保留內容並使用相同冪等鍵重試。",
  );
}

async function authorize(
  permission: "physical_therapy_assessments.manage" | "physical_therapy_assessments.sign",
) {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只使用合成物理治療評估，不會寫入正式或本機資料。",
      403,
    );
  }
  if (
    !actor.roles.includes("professional") ||
    !actor.scopes.includes("clients.read") ||
    !actor.scopes.includes("physical_therapy_assessments.read") ||
    !actor.scopes.includes(permission)
  ) {
    throw new IntegrationError(
      "PHYSICAL_THERAPY_NOT_AUTHORIZED",
      "目前身分不是具備指定權限的專業人員。",
      403,
    );
  }
  // Page 34 requires a recent same-session AAL2 challenge for every write,
  // including drafts, revisions and exact idempotent replays.
  await requireRecentAal2(actor);
  return actor;
}

function correlateReceipt(
  result: Omit<PhysicalTherapyAssessmentOperationResult, "persisted" | "demo">,
  input: CreatePhysicalTherapyDraftInput | PhysicalTherapyAssessmentMutationInput,
  actor: TenantContext,
) {
  const expectedState = input.action === "create_draft" ||
    input.action === "revise_draft" ? "draft"
    : input.action === "sign" ? "signed" : "corrected";
  if (
    result.action !== input.action || result.clientId !== input.clientId ||
    result.recordState !== expectedState ||
    result.therapistUserId !== actor.userId ||
    ("assessmentKey" in input && result.assessmentKey !== input.assessmentKey) ||
    ("expectedVersion" in input &&
      result.assessmentVersion !== input.expectedVersion + 1) ||
    (input.action === "create_draft" && result.assessmentVersion !== 1) ||
    (input.action !== "sign" && (
      result.assessedOn !== input.assessedOn ||
      result.reassessmentDueOn !== input.reassessmentDueOn ||
      result.formVersionReference !== input.formVersionReference
    )) ||
    result.formVersionReference !== "manual-physical-therapy-v1"
  ) {
    throw new IntegrationError(
      "PHYSICAL_THERAPY_RECEIPT_INVALID",
      "資料庫完成憑證與本次評估操作不一致；畫面不會把操作當作成功。",
      502,
    );
  }
  return result;
}

async function executeCreate(
  input: CreatePhysicalTherapyDraftInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式物理治療評估尚未設定。",
      503,
    );
  }
  const { data, error } = await supabase.rpc(
    "create_physical_therapy_assessment_draft",
    {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_assessed_on: input.assessedOn,
      p_reassessment_due_on: input.reassessmentDueOn,
      p_due_basis: input.dueBasis,
      p_measurements: input.measurements,
      p_functional_observation: input.functionalObservation,
      p_goals: input.goals,
      p_recommendations: input.recommendations,
      p_follow_up_plan: input.followUpPlan,
      p_form_version_reference: input.formVersionReference,
      p_idempotency_key: input.idempotencyKey,
    },
  ).maybeSingle<OperationRow>();
  if (error || !data) throw physicalTherapyFailure(error?.code);
  return correlateReceipt(
    parsePhysicalTherapyOperationResult(data, input.action),
    input,
    actor,
  );
}

async function executeMutation(
  input: PhysicalTherapyAssessmentMutationInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式物理治療評估尚未設定。",
      503,
    );
  }
  let result: {
    data: OperationRow | null;
    error: { code?: string } | null;
  };
  if (input.action === "revise_draft") {
    result = await supabase.rpc("revise_physical_therapy_assessment_draft", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_assessment_key: input.assessmentKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_assessed_on: input.assessedOn,
      p_reassessment_due_on: input.reassessmentDueOn,
      p_due_basis: input.dueBasis,
      p_measurements: input.measurements,
      p_functional_observation: input.functionalObservation,
      p_goals: input.goals,
      p_recommendations: input.recommendations,
      p_follow_up_plan: input.followUpPlan,
      p_form_version_reference: input.formVersionReference,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  } else if (input.action === "sign") {
    result = await supabase.rpc("sign_physical_therapy_assessment", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_assessment_key: input.assessmentKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  } else {
    result = await supabase.rpc("correct_physical_therapy_assessment", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_assessment_key: input.assessmentKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_assessed_on: input.assessedOn,
      p_reassessment_due_on: input.reassessmentDueOn,
      p_due_basis: input.dueBasis,
      p_measurements: input.measurements,
      p_functional_observation: input.functionalObservation,
      p_goals: input.goals,
      p_recommendations: input.recommendations,
      p_follow_up_plan: input.followUpPlan,
      p_form_version_reference: input.formVersionReference,
      p_correction_reason: input.correctionReason,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  }
  if (result.error || !result.data) {
    throw physicalTherapyFailure(result.error?.code);
  }
  return correlateReceipt(
    parsePhysicalTherapyOperationResult(result.data, input.action),
    input,
    actor,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    requireOperationHeader(request, ["create_draft"]);
    const actor = await authorize("physical_therapy_assessments.manage");
    const input = parseCreatePhysicalTherapyDraft(
      await readJsonObject(request, 192 * 1024),
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
    const operation = requireOperationHeader(
      request,
      ["revise_draft", "sign", "correct"],
    );
    const actor = await authorize(
      operation === "sign" || operation === "correct"
        ? "physical_therapy_assessments.sign"
        : "physical_therapy_assessments.manage",
    );
    const body = await readJsonObject(request, 192 * 1024);
    const input = parsePhysicalTherapyAssessmentMutation(
      body,
      request.headers.get("idempotency-key"),
    );
    if (input.action !== operation) {
      throw new IntegrationError(
        "INVALID_PHYSICAL_THERAPY_ASSESSMENT",
        "物理治療評估操作標頭與內容不一致。",
        400,
        "action",
      );
    }
    const result = await executeMutation(input, actor);
    return ok(
      { ...result, persisted: true as const, demo: false as const },
      result.replayed ? 200 : 201,
      requestId,
    );
  });
}
