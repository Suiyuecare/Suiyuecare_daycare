import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import {
  parseFirstVitalArrival,
  parseVitalSet,
  vitalMeasurementRows,
  vitalMeasurementKinds,
  vitalSetDatabaseKey,
} from "@/lib/integrations/measurements";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assertOfflineCareScope } from "@/lib/offline/scope";
import { taipeiServiceDateOf } from "@/lib/core-care/date";
import { canUseRoutineCare } from "@/lib/auth/routine-care";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VitalRpcRow = {
  id: string;
  measurement_kind: string;
  replayed: boolean;
};

type ArrivalRpcReceipt = {
  attendance_operation_id: string;
  attendance_id: string;
  checked_in_at: string;
  measured_at: string;
  service_date: string;
  measurement_kinds: string[];
  record_count: number;
  replayed: boolean;
};

function isArrivalReceipt(value: unknown): value is ArrivalRpcReceipt {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ArrivalRpcReceipt>;
  return typeof row.attendance_operation_id === "string" && typeof row.attendance_id === "string" &&
    typeof row.checked_in_at === "string" && !Number.isNaN(Date.parse(row.checked_in_at)) &&
    typeof row.measured_at === "string" && row.checked_in_at === row.measured_at &&
    typeof row.service_date === "string" && row.service_date === taipeiServiceDateOf(row.measured_at) &&
    Array.isArray(row.measurement_kinds) && row.measurement_kinds.every((kind) => typeof kind === "string") &&
    Number.isInteger(row.record_count) && typeof row.replayed === "boolean";
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest({ routinePermission: "health.write" });
    assertOfflineCareScope(request, actor);
    if (!actor.demo && !actor.scopes.includes("health.write")) {
      throw new IntegrationError(
        "MEASUREMENT_NOT_AUTHORIZED",
        "目前角色沒有新增生命徵象的權限。",
        403,
      );
    }
    const body = await readJsonObject(request);
    if (body.arrival_check_in === true) {
      if (actor.demo) {
        throw new IntegrationError("ARRIVAL_NOT_AVAILABLE_DEMO", "展示模式不會建立正式個案出勤。", 409);
      }
      if (!actor.scopes.includes("attendance.write") || !await canUseRoutineCare(actor, "attendance.write")) {
        throw new IntegrationError("ARRIVAL_NOT_AUTHORIZED", "目前角色沒有個案簽到權限。", 403);
      }
      const arrival = parseFirstVitalArrival(body, request.headers.get("idempotency-key"));
      const supabase = await createServerSupabaseClient();
      if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式量測服務尚未設定。", 503);
      const { data, error } = await supabase.rpc("record_first_vital_arrival", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_client_id: arrival.clientId,
        p_idempotency_key: vitalSetDatabaseKey(actor.organizationId, actor.userId, arrival),
        p_systolic: arrival.values.systolic ?? null,
        p_diastolic: arrival.values.diastolic ?? null,
        p_pulse: arrival.values.pulse ?? null,
        p_temperature: arrival.values.temperature ?? null,
        p_oxygen_saturation: arrival.values.oxygen_saturation ?? null,
        p_expected_service_date: arrival.serviceDate,
      });
      if (error) {
        const code = error.code;
        const dayChanged = code === "23514" && error.message === "arrival service date changed; refresh today work";
        throw databaseFailure(
          code === "42501" ? "ARRIVAL_NOT_AUTHORIZED" : dayChanged ? "ARRIVAL_DAY_CHANGED" : code === "23514" ? "ARRIVAL_STATE_CONFLICT" :
            code === "23505" ? "ARRIVAL_IDEMPOTENCY_CONFLICT" : code === "22023" ? "INVALID_VITAL_ARRIVAL" : "ARRIVAL_SAVE_FAILED",
          code === "42501" ? "目前角色或個案範圍不允許量測與簽到。" :
            dayChanged ? "服務日已變更；請重新打開今日工作，確認個案後再量測簽到。" :
            code === "23514" ? "今日排班、個案狀態或出勤不允許自動簽到；請重新載入並請主管核對。" :
              code === "23505" ? "相同操作鍵已有不同內容，請重新載入。" :
                code === "22023" ? "量測數值不符合輸入規則；出勤與量測均未儲存。" :
                  "量測與簽到未確認完成；保留內容，以相同操作重試。",
          code === "42501" ? 403 : code === "22023" ? 400 : 409,
        );
      }
      const expectedKinds = vitalMeasurementKinds(arrival.values);
      if (!isArrivalReceipt(data) || data.record_count !== expectedKinds.length ||
        data.measurement_kinds.length !== expectedKinds.length ||
        [...data.measurement_kinds].sort().some((kind, index) => kind !== expectedKinds[index])) {
        throw databaseFailure("ARRIVAL_RECEIPT_INCOMPLETE", "量測與簽到回覆不完整；保留內容，以相同操作重試。", 409);
      }
      return ok({ measurementKinds: data.measurement_kinds, recordCount: data.record_count,
        attendance: { operationId: data.attendance_operation_id, attendanceId: data.attendance_id,
          checkedInAt: data.checked_in_at, serviceDate: data.service_date },
        measuredAt: data.measured_at, replayed: data.replayed, persisted: true, demo: false },
      data.replayed ? 200 : 201, requestId);
    }
    const input = parseVitalSet(
      body,
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
        error.code === "23514"
          ? "FIRST_VITAL_REQUIRES_ARRIVAL"
          : error.code === "42501"
          ? "MEASUREMENT_NOT_AUTHORIZED"
          : error.code === "23505"
            ? "MEASUREMENT_IDEMPOTENCY_CONFLICT"
            : invalidInput
              ? "INVALID_VITAL_SET"
              : "MEASUREMENT_SAVE_FAILED",
        error.code === "23514"
          ? "照服員當日首筆量測須與個案簽到同時完成；請重新載入並使用「儲存量測並簽到」。若無法量測，請主任處理例外。"
          : error.code === "42501"
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
