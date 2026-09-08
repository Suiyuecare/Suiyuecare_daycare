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
  parseCreatePhysicalTherapyServiceDraft,
  parsePhysicalTherapyServiceMutation,
  parsePhysicalTherapyServiceOperationResult,
} from "@/lib/physical-therapy-services/parser";
import type {
  CreatePhysicalTherapyServiceDraftInput,
  PhysicalTherapyServiceMutationInput,
  PhysicalTherapyServiceOperationResult,
} from "@/lib/physical-therapy-services/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OperationRow = {
  operation_id: string;
  organization_id: string;
  branch_id: string;
  client_id: string;
  record_key: string;
  version_id: string;
  record_version: number;
  record_state: string;
  occurred_at: string;
  therapist_user_id: string;
  service_status_at_occurrence: string;
  assessment_reference_version_id: string | null;
  committed_at: string;
  replayed: boolean;
};

type PhysicalTherapyServiceOperation =
  "create_draft" | "revise_draft" | "sign" | "correct";

function requireOperationHeader(
  request: Request,
  allowed: readonly PhysicalTherapyServiceOperation[],
) {
  const operation = request.headers.get("x-physical-therapy-service-operation");
  if (!allowed.includes(operation as PhysicalTherapyServiceOperation)) {
    throw new IntegrationError(
      "INVALID_PHYSICAL_THERAPY_SERVICE",
      "缺少或不支援的物理治療服務紀錄操作標頭。",
      400,
      "x-physical-therapy-service-operation",
    );
  }
  return operation as PhysicalTherapyServiceOperation;
}

function physicalTherapyServiceFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "PHYSICAL_THERAPY_SERVICE_NOT_AUTHORIZED",
      "目前專業身分、權限、機構、分支、個案指派或工作階段不允許這項操作。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "PHYSICAL_THERAPY_SERVICE_VERSION_CONFLICT",
      "紀錄已有新版本；請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "PHYSICAL_THERAPY_SERVICE_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容；請保留資料並重新載入。",
      409,
    );
  }
  if (["23514", "23503", "55000"].includes(errorCode ?? "")) {
    return databaseFailure(
      "PHYSICAL_THERAPY_SERVICE_STATE_CONFLICT",
      "紀錄已簽署、版本鏈已改變，或目前狀態不允許這項操作。",
      409,
    );
  }
  if (["22023", "22003", "23502"].includes(errorCode ?? "")) {
    return databaseFailure(
      "INVALID_PHYSICAL_THERAPY_SERVICE",
      "發生時間、服務內容、個案反應、建議、理由或版本未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "PHYSICAL_THERAPY_SERVICE_SAVE_FAILED",
    "系統尚未確認操作結果；請保留內容並使用相同冪等鍵重試。",
  );
}

async function authorize(
  permission: "physical_therapy_services.manage" |
    "physical_therapy_services.sign",
  requiresRecentAal2: boolean,
) {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只使用合成服務紀錄，不會寫入資料。",
      403,
    );
  }
  if (
    !actor.roles.includes("professional") ||
    !actor.scopes.includes("clients.read") ||
    !actor.scopes.includes("physical_therapy_services.read") ||
    !actor.scopes.includes(permission)
  ) {
    throw new IntegrationError(
      "PHYSICAL_THERAPY_SERVICE_NOT_AUTHORIZED",
      "目前身分不是具備指定權限的專業人員。",
      403,
    );
  }
  if (requiresRecentAal2) await requireRecentAal2(actor);
  return actor;
}

function correlateReceipt(
  result: Omit<PhysicalTherapyServiceOperationResult, "persisted" | "demo">,
  input: CreatePhysicalTherapyServiceDraftInput |
    PhysicalTherapyServiceMutationInput,
  actor: TenantContext,
) {
  const expectedState = input.action === "create_draft" ||
    input.action === "revise_draft" ? "draft"
    : input.action === "sign" ? "signed" : "corrected";
  if (
    result.action !== input.action ||
    result.organizationId !== actor.organizationId ||
    result.branchId !== actor.branchId ||
    result.clientId !== input.clientId ||
    result.recordState !== expectedState ||
    result.therapistUserId !== actor.userId ||
    ("recordKey" in input && result.recordKey !== input.recordKey) ||
    ("expectedVersion" in input &&
      result.recordVersion !== input.expectedVersion + 1) ||
    (input.action === "create_draft" && result.recordVersion !== 1) ||
    (input.action !== "sign" && result.occurredAt !== input.occurredAt)
  ) {
    throw new IntegrationError(
      "PHYSICAL_THERAPY_SERVICE_RECEIPT_INVALID",
      "資料庫完成憑證與本次操作不一致；畫面不會把操作當作成功。",
      502,
    );
  }
  return result;
}

async function executeCreate(
  input: CreatePhysicalTherapyServiceDraftInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式物理治療服務紀錄尚未設定。",
      503,
    );
  }
  const { data, error } = await supabase.rpc(
    "create_physical_therapy_service_draft",
    {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_occurred_at: input.occurredAt,
      p_service_content: input.serviceContent,
      p_client_reaction: input.clientReaction,
      p_recommendation: input.recommendation,
      p_idempotency_key: input.idempotencyKey,
    },
  ).maybeSingle<OperationRow>();
  if (error || !data) throw physicalTherapyServiceFailure(error?.code);
  return correlateReceipt(
    parsePhysicalTherapyServiceOperationResult(data, input.action),
    input,
    actor,
  );
}

async function executeMutation(
  input: PhysicalTherapyServiceMutationInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式物理治療服務紀錄尚未設定。",
      503,
    );
  }
  let result: {
    data: OperationRow | null;
    error: { code?: string } | null;
  };
  if (input.action === "revise_draft") {
    result = await supabase.rpc("revise_physical_therapy_service_draft", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_record_key: input.recordKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_occurred_at: input.occurredAt,
      p_service_content: input.serviceContent,
      p_client_reaction: input.clientReaction,
      p_recommendation: input.recommendation,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  } else if (input.action === "sign") {
    result = await supabase.rpc("sign_physical_therapy_service_record", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_record_key: input.recordKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  } else {
    result = await supabase.rpc("correct_physical_therapy_service_record", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_record_key: input.recordKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_occurred_at: input.occurredAt,
      p_service_content: input.serviceContent,
      p_client_reaction: input.clientReaction,
      p_recommendation: input.recommendation,
      p_correction_reason: input.correctionReason,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  }
  if (result.error || !result.data) {
    throw physicalTherapyServiceFailure(result.error?.code);
  }
  return correlateReceipt(
    parsePhysicalTherapyServiceOperationResult(result.data, input.action),
    input,
    actor,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    requireOperationHeader(request, ["create_draft"]);
    const actor = await authorize("physical_therapy_services.manage", false);
    const input = parseCreatePhysicalTherapyServiceDraft(
      await readJsonObject(request, 128 * 1024),
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
    const highRisk = operation === "sign" || operation === "correct";
    const actor = await authorize(
      highRisk
        ? "physical_therapy_services.sign"
        : "physical_therapy_services.manage",
      highRisk,
    );
    const body = await readJsonObject(request, 128 * 1024);
    const input = parsePhysicalTherapyServiceMutation(
      body,
      request.headers.get("idempotency-key"),
    );
    if (input.action !== operation) {
      throw new IntegrationError(
        "INVALID_PHYSICAL_THERAPY_SERVICE",
        "物理治療服務紀錄操作標頭與內容不一致。",
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
