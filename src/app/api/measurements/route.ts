import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import {
  parseVitalSet,
  vitalMeasurementRows,
  vitalSetDatabaseKey,
} from "@/lib/integrations/measurements";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assertOfflineCareScope } from "@/lib/offline/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VitalRpcRow = {
  id: string;
  measurement_kind: string;
  replayed: boolean;
};

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    assertOfflineCareScope(request, actor);
    if (!actor.demo && !actor.scopes.includes("health.write")) {
      throw new IntegrationError(
        "MEASUREMENT_NOT_AUTHORIZED",
        "目前角色沒有新增生命徵象的權限。",
        403,
      );
    }
    const input = parseVitalSet(
      await readJsonObject(request),
      request.headers.get("idempotency-key"),
      new Date(),
      // The database must inspect an existing committed set before applying
      // the new-write time window. Demo mode has no durable replay ledger, so
      // it continues to enforce the boundary here.
      { enforceTimeWindow: actor.demo },
    );
    const expectedRows = vitalMeasurementRows(
      actor.organizationId,
      actor.userId,
      input,
    );

    if (actor.demo) {
      return ok(
        {
          measurementKinds: expectedRows.map((row) => row.measurementKind),
          recordCount: expectedRows.length,
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
        "正式量測服務尚未設定。",
        503,
      );
    }

    const { data, error } = await supabase.rpc("record_vital_set", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_measured_at: input.measuredAt,
      p_idempotency_key: vitalSetDatabaseKey(
        actor.organizationId,
        actor.userId,
        input,
      ),
      p_systolic: input.values.systolic ?? null,
      p_diastolic: input.values.diastolic ?? null,
      p_pulse: input.values.pulse ?? null,
      p_temperature: input.values.temperature ?? null,
      p_oxygen_saturation: input.values.oxygen_saturation ?? null,
    });

    if (error) {
      const invalidInput = error.code === "22023";
      throw databaseFailure(
        error.code === "42501"
          ? "MEASUREMENT_NOT_AUTHORIZED"
          : error.code === "23505"
            ? "MEASUREMENT_IDEMPOTENCY_CONFLICT"
            : invalidInput
              ? "INVALID_VITAL_SET"
              : "MEASUREMENT_SAVE_FAILED",
        error.code === "42501"
          ? "目前角色或個案範圍不允許新增量測。"
          : error.code === "23505"
            ? "相同冪等鍵曾用於不同的量測內容。"
            : invalidInput
              ? "量測時間、數值或精度不符合規則。"
              : "量測未儲存；請確認時間與數值後，以相同冪等鍵重試。",
        error.code === "42501" ? 403 : invalidInput ? 400 : 409,
      );
    }

    const records = (data ?? []) as unknown as VitalRpcRow[];
    const expectedKinds = expectedRows
      .map((row) => row.measurementKind)
      .sort();
    const returnedKinds = records
      .map((record) => record.measurement_kind)
      .sort();
    const hasMixedReplayState =
      records.some((record) => record.replayed) &&
      records.some((record) => !record.replayed);
    if (
      records.length !== expectedRows.length ||
      new Set(returnedKinds).size !== returnedKinds.length ||
      returnedKinds.some((kind, index) => kind !== expectedKinds[index]) ||
      hasMixedReplayState
    ) {
      throw databaseFailure(
        "MEASUREMENT_SET_INCOMPLETE",
        "量測組未完整確認；請保留畫面內容並以相同冪等鍵重試。",
        409,
      );
    }

    return ok(
      {
        measurementKinds: records.map((record) => record.measurement_kind),
        recordCount: records.length,
        replayed: records.every((record) => record.replayed),
        persisted: true,
        demo: false,
      },
      records.every((record) => record.replayed) ? 200 : 201,
      requestId,
    );
  });
}
