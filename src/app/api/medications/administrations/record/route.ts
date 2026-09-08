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
  parseMedicationAdministration,
  type MedicationOutcome,
} from "@/lib/integrations/medications";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MedicationRpcRow = {
  operation_id: string;
  medication_administration_id: string;
  status: MedicationOutcome;
  administered_at: string;
  requires_second_verification: boolean;
  finalization_state: "pending_verification" | "signed";
  signed_at: string | null;
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

function medicationFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "MEDICATION_NOT_AUTHORIZED",
      "目前角色、分支、個案範圍或雙因素驗證不允許簽署這筆用藥。",
      403,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "MEDICATION_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同的用藥內容，請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23514" || errorCode === "23503" || errorCode === "55000") {
    return databaseFailure(
      "MEDICATION_STATE_CONFLICT",
      "排程、個案狀態、已簽用藥計畫、劑量／單位或簽署狀態不符合操作條件。",
      409,
    );
  }
  if (errorCode === "22023" || errorCode === "22003") {
    return databaseFailure(
      "INVALID_MEDICATION_ADMINISTRATION",
      "用藥狀態、時間、劑量、單位或原因未通過資料庫驗證。",
      400,
    );
  }
  return databaseFailure(
    "MEDICATION_SAVE_FAILED",
    "用藥結果尚未確認；請保留畫面內容並以相同冪等鍵重試。",
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) {
      throw new IntegrationError(
        "DEMO_READ_ONLY",
        "展示模式只顯示合成資料；用藥簽署已拒絕且不會保存。",
        403,
      );
    }
    if (!actor.scopes.includes("medications.administer")) {
      throw new IntegrationError(
        "MEDICATION_NOT_AUTHORIZED",
        "目前角色沒有用藥執行權限。",
        403,
      );
    }
    await requireRecentAal2(actor);

    const input = parseMedicationAdministration(
      await readJsonObject(request, 32 * 1024),
      request.headers.get("idempotency-key"),
      new Date(),
      // The database checks its durable receipt before mutable time, lifecycle,
      // and plan gates, so a production replay can still reach its ledger.
      { enforceTimeWindow: false },
    );

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式用藥後端尚未設定。",
        503,
      );
    }

    const { data, error } = await supabase
      .rpc("record_medication_administration", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_medication_administration_id: input.medicationAdministrationId,
        p_status: input.status,
        p_occurred_at: input.occurredAt,
        p_actual_dose: input.actualDose,
        p_dose_unit: input.doseUnit,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      })
      .maybeSingle<MedicationRpcRow>();

    if (error || !data) throw medicationFailure(error?.code);
    const administeredAt = receiptInstant(data.administered_at);
    const signedAt = receiptInstant(data.signed_at);
    if (
      !UUID_PATTERN.test(data.medication_administration_id) ||
      data.medication_administration_id.toLowerCase() !==
        input.medicationAdministrationId.toLowerCase() ||
      data.status !== input.status ||
      administeredAt !== input.occurredAt ||
      !["pending_verification", "signed"].includes(data.finalization_state) ||
      typeof data.replayed !== "boolean" ||
      typeof data.requires_second_verification !== "boolean" ||
      !UUID_PATTERN.test(data.operation_id) ||
      (data.finalization_state === "signed" && !signedAt) ||
      (data.finalization_state === "signed" &&
        data.requires_second_verification) ||
      (data.finalization_state === "signed" &&
        signedAt !== null &&
        administeredAt !== null &&
        new Date(signedAt).getTime() + 5 * 60 * 1_000 <
          new Date(administeredAt).getTime()) ||
      (data.finalization_state === "pending_verification" &&
        (!data.requires_second_verification || data.signed_at !== null))
    ) {
      throw databaseFailure(
        "MEDICATION_RESULT_INVALID",
        "用藥簽署結果未完整確認；請保留內容並以相同冪等鍵重試。",
        409,
      );
    }

    return ok(
      {
        operationId: data.operation_id,
        medicationAdministrationId: data.medication_administration_id,
        status: data.status,
        occurredAt: administeredAt!,
        requiresSecondVerification: data.requires_second_verification,
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
