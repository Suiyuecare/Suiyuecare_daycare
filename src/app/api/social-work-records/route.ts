import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import {
  parseCreateSocialWorkDraft,
  parseSocialWorkFollowUpMutation,
  parseSocialWorkFollowUpOperationResult,
  parseSocialWorkRecordMutation,
  parseSocialWorkRecordOperationResult,
} from "@/lib/social-work-records/parser";
import type {
  CreateSocialWorkDraftInput,
  SocialWorkFollowUpMutationInput,
  SocialWorkFollowUpOperationResult,
  SocialWorkRecordMutationInput,
  SocialWorkRecordOperationResult,
} from "@/lib/social-work-records/types";
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

type RecordOperationRow = {
  operation_id: string;
  record_key: string;
  version_id: string;
  record_version: number;
  record_state: string;
  committed_at: string;
  replayed: boolean;
};

type FollowUpOperationRow = {
  operation_id: string;
  record_key: string;
  follow_up_event_id: string;
  follow_up_sequence: number;
  follow_up_status: string;
  committed_at: string;
  replayed: boolean;
};

function socialWorkFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "SOCIAL_WORK_NOT_AUTHORIZED",
      "目前角色、機構、分支、個案指派或工作階段不允許這項社工服務操作。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "SOCIAL_WORK_VERSION_CONFLICT",
      "紀錄或追蹤已有新版本；請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "SOCIAL_WORK_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容；請保留資料並重新載入。",
      409,
    );
  }
  if (errorCode === "23514" || errorCode === "23503" || errorCode === "55000") {
    return databaseFailure(
      "SOCIAL_WORK_STATE_CONFLICT",
      "紀錄已簽署、版本鏈已改變，或追蹤狀態不允許這項操作。",
      409,
    );
  }
  if (errorCode === "22023" || errorCode === "22003") {
    return databaseFailure(
      "INVALID_SOCIAL_WORK_RECORD",
      "實際發生時間、服務內容、結果、追蹤資料、理由或版本未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "SOCIAL_WORK_SAVE_FAILED",
    "社工服務操作尚未確認完成；請保留內容並使用相同冪等鍵重試。",
  );
}

async function authorize(
  permission: "social_work_records.manage" | "social_work_records.sign",
) {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只使用合成社工紀錄，不會寫入正式或本機資料。",
      403,
    );
  }
  if (
    !actor.scopes.includes("clients.read") ||
    !actor.scopes.includes("social_work_records.read") ||
    !actor.scopes.includes(permission)
  ) {
    throw new IntegrationError(
      "SOCIAL_WORK_NOT_AUTHORIZED",
      "目前角色沒有這項社工服務操作權限。",
      403,
    );
  }
  if (permission === "social_work_records.sign") await requireRecentAal2(actor);
  return actor;
}

function correlateRecordReceipt(
  result: Omit<SocialWorkRecordOperationResult, "persisted" | "demo">,
  expectation: {
    action: SocialWorkRecordOperationResult["action"];
    recordKey?: string;
    expectedVersion?: number;
  },
) {
  const expectedState = expectation.action === "create_draft" ||
    expectation.action === "revise_draft" ? "draft"
    : expectation.action === "sign" ? "signed" : "corrected";
  if (
    result.action !== expectation.action || result.recordState !== expectedState ||
    (expectation.recordKey !== undefined && result.recordKey !== expectation.recordKey) ||
    (expectation.expectedVersion !== undefined &&
      result.recordVersion !== expectation.expectedVersion + 1) ||
    (expectation.action === "create_draft" && result.recordVersion !== 1)
  ) {
    throw new IntegrationError(
      "SOCIAL_WORK_RECEIPT_INVALID",
      "資料庫完成憑證與本次紀錄操作不一致；畫面不會把操作當作成功。",
      502,
    );
  }
  return result;
}

function correlateFollowUpReceipt(
  result: Omit<SocialWorkFollowUpOperationResult, "persisted" | "demo">,
  input: SocialWorkFollowUpMutationInput,
) {
  const expectedStatus = input.action === "track" ? "pending"
    : input.action === "complete_follow_up" ? "completed" : "cancelled";
  if (
    result.action !== input.action || result.recordKey !== input.recordKey ||
    result.followUpStatus !== expectedStatus ||
    result.followUpSequence !== input.expectedSequence + 1
  ) {
    throw new IntegrationError(
      "SOCIAL_WORK_RECEIPT_INVALID",
      "資料庫完成憑證與本次追蹤操作不一致；畫面不會把操作當作成功。",
      502,
    );
  }
  return result;
}

async function executeCreate(input: CreateSocialWorkDraftInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式社工服務紀錄尚未設定。", 503);
  }
  const { data, error } = await supabase.rpc("create_social_work_service_draft", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_occurred_at: input.occurredAt,
    p_service_type: input.serviceType,
    p_service_content: input.serviceContent,
    p_service_result: input.serviceResult,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<RecordOperationRow>();
  if (error || !data) throw socialWorkFailure(error?.code);
  return correlateRecordReceipt(
    parseSocialWorkRecordOperationResult(data, input.action),
    { action: input.action },
  );
}

async function executeRecordMutation(
  input: SocialWorkRecordMutationInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式社工服務紀錄尚未設定。", 503);
  }
  let result: { data: RecordOperationRow | null; error: { code?: string } | null };
  if (input.action === "revise_draft") {
    result = await supabase.rpc("revise_social_work_service_draft", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_record_key: input.recordKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_occurred_at: input.occurredAt,
      p_service_type: input.serviceType,
      p_service_content: input.serviceContent,
      p_service_result: input.serviceResult,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<RecordOperationRow>();
  } else if (input.action === "sign") {
    result = await supabase.rpc("sign_social_work_service_record", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_record_key: input.recordKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<RecordOperationRow>();
  } else {
    result = await supabase.rpc("correct_social_work_service_record", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_record_key: input.recordKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_occurred_at: input.occurredAt,
      p_service_type: input.serviceType,
      p_service_content: input.serviceContent,
      p_service_result: input.serviceResult,
      p_correction_reason: input.correctionReason,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<RecordOperationRow>();
  }
  if (result.error || !result.data) throw socialWorkFailure(result.error?.code);
  return correlateRecordReceipt(
    parseSocialWorkRecordOperationResult(result.data, input.action),
    {
      action: input.action,
      recordKey: input.recordKey,
      expectedVersion: input.expectedVersion,
    },
  );
}

async function executeFollowUp(
  input: SocialWorkFollowUpMutationInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式社工服務紀錄尚未設定。", 503);
  }
  const { data, error } = await supabase.rpc("mutate_social_work_follow_up", {
    p_action: input.action,
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_record_key: input.recordKey,
    p_service_version_id: input.serviceVersionId,
    p_expected_sequence: input.expectedSequence,
    p_due_on: input.dueOn,
    p_follow_up_plan: input.followUpPlan,
    p_follow_up_outcome: input.followUpOutcome,
    p_transition_reason: input.transitionReason,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<FollowUpOperationRow>();
  if (error || !data) throw socialWorkFailure(error?.code);
  return correlateFollowUpReceipt(
    parseSocialWorkFollowUpOperationResult(data, input.action),
    input,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize("social_work_records.manage");
    const input = parseCreateSocialWorkDraft(
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
    // Ordinary staff authorization deliberately precedes detailed body parsing.
    const actor = await authorizeStaffRequest();
    if (actor.demo) {
      throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會寫入社工服務紀錄。", 403);
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
        "SOCIAL_WORK_NOT_AUTHORIZED",
        "目前角色沒有這項社工服務操作權限。",
        403,
      );
    }
    if (signing) await requireRecentAal2(actor);

    const result = ["track", "complete_follow_up", "cancel_follow_up"].includes(
      String(body.action),
    )
      ? await executeFollowUp(
        parseSocialWorkFollowUpMutation(body, request.headers.get("idempotency-key")),
        actor,
      )
      : await executeRecordMutation(
        parseSocialWorkRecordMutation(body, request.headers.get("idempotency-key")),
        actor,
      );
    return ok(
      { ...result, persisted: true as const, demo: false as const },
      200,
      requestId,
    );
  });
}
