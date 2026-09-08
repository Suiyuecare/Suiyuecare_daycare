import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import {
  MEDICATION_OUTCOMES,
  parseMedicationVerification,
  type MedicationOutcome,
} from "@/lib/integrations/medications";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MedicationVerificationRpcRow = {
  operation_id: string;
  medication_administration_id: string;
  status: MedicationOutcome;
  administered_at: string;
  requires_second_verification: true;
  finalization_state: "signed";
  signed_at: string;
  replayed: boolean;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function receiptInstant(value: unknown) {
  if (
    typeof value !== "string" ||
    !/(?:[zZ]|[+-]\d{2}:\d{2})$/u.test(value)
  ) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function verificationFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "MEDICATION_VERIFICATION_NOT_AUTHORIZED",
      "目前角色、分支、個案範圍或雙因素驗證不允許完成獨立覆核。",
      403,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "MEDICATION_VERIFICATION_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同的覆核內容，請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23514" || errorCode === "23503" || errorCode === "55000") {
    return databaseFailure(
      "MEDICATION_VERIFICATION_STATE_CONFLICT",
      "這筆用藥目前不是可由第二位不同人員覆核的待確認狀態。",
      409,
    );
  }
  if (errorCode === "22023") {
    return databaseFailure(
      "INVALID_MEDICATION_VERIFICATION",
      "用藥覆核資料未通過資料庫驗證。",
      400,
    );
  }
  return databaseFailure(
    "MEDICATION_VERIFICATION_FAILED",
    "獨立覆核尚未確認；請以相同冪等鍵重試。",
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) {
      throw new IntegrationError(
        "DEMO_READ_ONLY",
        "展示模式只顯示合成資料；用藥覆核已拒絕且不會保存。",
        403,
      );
    }
    if (!actor.scopes.includes("medications.verify")) {
      throw new IntegrationError(
        "MEDICATION_VERIFICATION_NOT_AUTHORIZED",
        "目前角色沒有用藥獨立覆核權限。",
        403,
      );
    }
    await requireRecentAal2(actor);

    const input = parseMedicationVerification(
      await readJsonObject(request, 16 * 1024),
      request.headers.get("idempotency-key"),
    );

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式用藥覆核後端尚未設定。",
        503,
      );
    }

    const { data, error } = await supabase
      .rpc("verify_medication_administration", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_medication_administration_id: input.medicationAdministrationId,
        p_idempotency_key: input.idempotencyKey,
      })
      .maybeSingle<MedicationVerificationRpcRow>();

    if (error || !data) throw verificationFailure(error?.code);
    const administeredAt = receiptInstant(data.administered_at);
    const signedAt = receiptInstant(data.signed_at);
    if (
      !UUID_PATTERN.test(data.medication_administration_id) ||
      data.medication_administration_id.toLowerCase() !==
        input.medicationAdministrationId.toLowerCase() ||
      !MEDICATION_OUTCOMES.includes(data.status) ||
      data.finalization_state !== "signed" ||
      !data.requires_second_verification ||
      !administeredAt ||
      !signedAt ||
      new Date(signedAt).getTime() + 5 * 60 * 1_000 <
        new Date(administeredAt).getTime() ||
      typeof data.replayed !== "boolean" ||
      !UUID_PATTERN.test(data.operation_id)
    ) {
      throw databaseFailure(
        "MEDICATION_VERIFICATION_RESULT_INVALID",
        "用藥覆核結果未完整確認；請以相同冪等鍵重試。",
        409,
      );
    }

    return ok(
      {
        operationId: data.operation_id,
        medicationAdministrationId: data.medication_administration_id,
        status: data.status,
        occurredAt: administeredAt,
        requiresSecondVerification: true as const,
        finalizationState: data.finalization_state,
        signedAt,
        replayed: data.replayed,
        persisted: true,
        demo: false,
      },
      data.replayed ? 200 : 201,
      requestId,
    );
  });
}
