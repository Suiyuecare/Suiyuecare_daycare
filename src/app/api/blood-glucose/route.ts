import { ok } from "@/lib/api/response";
import {
  bloodGlucoseDatabaseKey,
  parseBloodGlucoseMeasurement,
  type BloodGlucoseMealContext,
  type BloodGlucoseUnit,
} from "@/lib/integrations/blood-glucose";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BloodGlucoseRpcRow = {
  id: string;
  client_id: string;
  measured_at: string;
  meal_context: BloodGlucoseMealContext;
  numeric_value: number | string;
  unit: BloodGlucoseUnit;
  source: string;
  replayed: boolean;
};

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (!actor.demo && !actor.scopes.includes("health.write")) {
      throw new IntegrationError(
        "BLOOD_GLUCOSE_NOT_AUTHORIZED",
        "目前角色沒有新增血糖量測的權限。",
        403,
      );
    }

    const input = parseBloodGlucoseMeasurement(
      await readJsonObject(request, 32 * 1024),
      request.headers.get("idempotency-key"),
      new Date(),
      // Durable exact replay is resolved in the database before the new-write
      // clock and lifecycle gates. Demo has no durable ledger, so it keeps the
      // application-side boundary.
      { enforceTimeWindow: actor.demo },
    );

    if (actor.demo) {
      return ok(
        {
          clientId: input.clientId,
          measuredAt: input.measuredAt,
          mealContext: input.mealContext,
          value: input.value,
          unit: input.unit,
          source: "staff",
          replayed: false,
          persisted: false,
          demo: true,
        },
        200,
        requestId,
      );
    }

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式血糖量測服務尚未設定。",
        503,
      );
    }

    const { data, error } = await supabase.rpc("record_blood_glucose", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_measured_at: input.measuredAt,
      p_meal_context: input.mealContext,
      p_numeric_value: input.value,
      p_unit: input.unit,
      p_idempotency_key: bloodGlucoseDatabaseKey(
        actor.organizationId,
        actor.branchId,
        actor.userId,
        input,
      ),
    });

    if (error) {
      const invalidInput = error.code === "22023";
      throw databaseFailure(
        error.code === "42501"
          ? "BLOOD_GLUCOSE_NOT_AUTHORIZED"
          : error.code === "23505"
            ? "BLOOD_GLUCOSE_IDEMPOTENCY_CONFLICT"
            : invalidInput
              ? "INVALID_BLOOD_GLUCOSE"
              : "BLOOD_GLUCOSE_SAVE_FAILED",
        error.code === "42501"
          ? "目前角色或個案範圍不允許新增血糖量測。"
          : error.code === "23505"
            ? "相同冪等鍵曾用於不同的血糖量測內容。"
            : invalidInput
              ? "量測時間、情境、數值、單位或精度不符合規則。"
              : "血糖量測未確認儲存；請保留內容並以相同冪等鍵重試。",
        error.code === "42501" ? 403 : invalidInput ? 400 : 409,
      );
    }

    const records = (data ?? []) as unknown as BloodGlucoseRpcRow[];
    const record = records[0];
    if (
      records.length !== 1 ||
      !record ||
      record.client_id !== input.clientId ||
      new Date(record.measured_at).toISOString() !== input.measuredAt ||
      record.meal_context !== input.mealContext ||
      Number(record.numeric_value) !== input.value ||
      record.unit !== input.unit ||
      record.source !== "staff" ||
      typeof record.replayed !== "boolean"
    ) {
      throw databaseFailure(
        "BLOOD_GLUCOSE_RESULT_INVALID",
        "血糖量測結果未完整確認；請保留內容並以相同冪等鍵重試。",
        409,
      );
    }

    return ok(
      {
        id: record.id,
        clientId: record.client_id,
        measuredAt: input.measuredAt,
        mealContext: record.meal_context,
        value: Number(record.numeric_value),
        unit: record.unit,
        source: record.source,
        replayed: record.replayed,
        persisted: true,
        demo: false,
      },
      record.replayed ? 200 : 201,
      requestId,
    );
  });
}
