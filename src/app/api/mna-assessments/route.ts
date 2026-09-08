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
  parseCreateMnaAssessment,
  parseMnaAssessmentMutation,
} from "@/lib/mna-assessments/parser";
import type {
  CorrectMnaAssessmentInput,
  CreateMnaAssessmentInput,
  MnaAssessmentMutationInput,
  ReviseMnaAssessmentInput,
  SignMnaAssessmentInput,
} from "@/lib/mna-assessments/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BlockedOperationRow = {
  operation_id: string;
  action: string;
  client_id: string;
  actor_user_id: string;
  idempotency_key: string;
  status: string;
  replayed: boolean;
};

function mnaFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "MNA_NOT_AUTHORIZED",
      "目前專業身分、機構、分支、個案指派、專頁權限或近期雙因素驗證不允許這項 MNA 操作。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "MNA_VERSION_CONFLICT",
      "MNA 紀錄已有新版本；請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "MNA_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容；請保留資料並重新載入。",
      409,
    );
  }
  if (errorCode === "55000") {
    return databaseFailure(
      "MNA_LICENSE_NOT_CONFIGURED",
      "MNA 台灣中文表單與電子實作授權、題本版本、計分公式及畫面審查尚未配置；草稿、計分、風險、簽署、更正與自動後續處置均已封鎖。",
      409,
    );
  }
  if (["22023", "22003", "23502", "23514", "23503"].includes(
    errorCode ?? "",
  )) {
    return databaseFailure(
      "INVALID_MNA_ASSESSMENT",
      "MNA 操作、表單種類、治理版本、預期版本或更正理由未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "MNA_OPERATION_UNKNOWN",
    "MNA 操作結果尚未確認；內容未改變時請保留並使用同一冪等鍵重試。",
  );
}

async function authorizeWrite(permission: "mna_assessments.manage" |
  "mna_assessments.sign") {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只顯示合成結果，不會寫入正式或本機資料。",
      403,
    );
  }
  if (!actor.roles.includes("professional") ||
    !actor.scopes.includes("clients.read") ||
    !actor.scopes.includes("mna_assessments.read") ||
    !actor.scopes.includes(permission)) {
    throw new IntegrationError(
      "MNA_NOT_AUTHORIZED",
      "目前身分不是具備 MNA 專頁權限的專業人員。",
      403,
    );
  }
  // Authorization and same-session recent AAL2 precede body parsing.
  await requireRecentAal2(actor);
  return actor;
}

async function database() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "MNA 正式服務尚未設定。",
      503,
    );
  }
  return supabase;
}

function confirmBlockedReceipt(
  row: BlockedOperationRow | null,
  input: CreateMnaAssessmentInput | MnaAssessmentMutationInput,
  actor: TenantContext,
): never {
  if (!row || row.action !== input.action || row.client_id !== input.clientId ||
    row.actor_user_id !== actor.userId ||
    row.idempotency_key !== input.idempotencyKey ||
    row.status !== "blocked_license_not_configured" ||
    typeof row.replayed !== "boolean") {
    throw new IntegrationError(
      "MNA_RECEIPT_INVALID",
      "資料庫封鎖憑證與本次操作不一致；系統不會把操作當作成功。",
      502,
    );
  }
  throw mnaFailure("55000");
}

async function executeBlockedCreate(
  input: CreateMnaAssessmentInput,
  actor: TenantContext,
): Promise<never> {
  const supabase = await database();
  const { data, error } = await supabase.rpc("create_mna_assessment_draft", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessed_on: input.assessedOn,
    p_form_variant: input.formVariant,
    p_governance_version_id: input.governanceVersionId,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<BlockedOperationRow>();
  if (error) throw mnaFailure(error.code);
  return confirmBlockedReceipt(data, input, actor);
}

async function executeBlockedMutation(
  input: MnaAssessmentMutationInput,
  actor: TenantContext,
): Promise<never> {
  const supabase = await database();
  let rpc: string;
  let args: Record<string, unknown>;
  const common = {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_assessment_key: input.assessmentKey,
    p_previous_version_id: input.previousVersionId,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey,
  };
  if (input.action === "revise_draft") {
    const revise: ReviseMnaAssessmentInput = input;
    rpc = "revise_mna_assessment_draft";
    args = {
      ...common,
      p_assessed_on: revise.assessedOn,
      p_form_variant: revise.formVariant,
      p_governance_version_id: revise.governanceVersionId,
    };
  } else if (input.action === "correct") {
    const correct: CorrectMnaAssessmentInput = input;
    rpc = "correct_mna_assessment";
    args = { ...common, p_correction_reason: correct.correctionReason };
  } else {
    const sign: SignMnaAssessmentInput = input;
    rpc = "sign_mna_assessment";
    args = { ...common, p_expected_version: sign.expectedVersion };
  }
  const { data, error } = await supabase.rpc(rpc, args)
    .maybeSingle<BlockedOperationRow>();
  if (error) throw mnaFailure(error.code);
  return confirmBlockedReceipt(data, input, actor);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async () => {
    const actor = await authorizeWrite("mna_assessments.manage");
    const input = parseCreateMnaAssessment(
      await readJsonObject(request, 32 * 1024),
      request.headers.get("idempotency-key"),
    );
    return executeBlockedCreate(input, actor);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async () => {
    const declaredAction = request.headers.get("x-mna-operation");
    if (declaredAction !== "revise_draft" && declaredAction !== "sign" &&
      declaredAction !== "correct") {
      throw new IntegrationError(
        "INVALID_MNA_ASSESSMENT",
        "請先宣告受治理的 MNA 操作。",
        400,
        "x-mna-operation",
      );
    }
    const actor = await authorizeWrite(declaredAction === "sign" ||
      declaredAction === "correct"
      ? "mna_assessments.sign" : "mna_assessments.manage");
    const input = parseMnaAssessmentMutation(
      await readJsonObject(request, 32 * 1024),
      request.headers.get("idempotency-key"),
    );
    if (input.action !== declaredAction) {
      throw new IntegrationError(
        "INVALID_MNA_ASSESSMENT",
        "操作標頭與內容不一致。",
        400,
        "action",
      );
    }
    return executeBlockedMutation(input, actor);
  });
}
