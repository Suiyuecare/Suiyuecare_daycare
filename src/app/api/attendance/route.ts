import { ok } from "@/lib/api/response";
import { parseAttendanceEvent } from "@/lib/integrations/attendance";
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

type AttendanceRpcRow = {
  operation_id: string;
  attendance_id: string;
  service_date: string;
  status: "present" | "absent" | "leave";
  checked_in_at: string | null;
  checked_out_at: string | null;
  source: "staff" | "staff_backfill";
  replayed: boolean;
};

function attendanceFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "ATTENDANCE_NOT_AUTHORIZED",
      "目前角色、分支、個案範圍或重新驗證狀態不允許這項出勤操作。",
      403,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "ATTENDANCE_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同的出勤內容。請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23514") {
    return databaseFailure(
      "ATTENDANCE_STATE_CONFLICT",
      "目前服務日已有互斥出勤狀態、尚未簽到，或簽退時間早於簽到時間。",
      409,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "ATTENDANCE_CONCURRENT_CHANGE",
      "出勤已由其他工作人員更新；請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "22023") {
    return databaseFailure(
      "ATTENDANCE_EVENT_REJECTED",
      "事件時間、補登理由或操作種類未通過資料庫驗證。",
      400,
    );
  }
  return databaseFailure(
    "ATTENDANCE_SAVE_FAILED",
    "出勤未確認完成；請保留畫面內容並以相同冪等鍵重試。",
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (!actor.demo && !actor.scopes.includes("attendance.write")) {
      throw new IntegrationError(
        "ATTENDANCE_NOT_AUTHORIZED",
        "目前角色沒有登錄出勤的權限。",
        403,
      );
    }

    const input = parseAttendanceEvent(
      await readJsonObject(request, 32 * 1024),
      request.headers.get("idempotency-key"),
    );
    if (actor.demo) {
      return ok(
        {
          operation: {
            clientId: input.clientId,
            eventKind: input.eventKind,
            occurredAt: input.occurredAt,
            source: input.isBackfill ? "staff_backfill" : "staff",
          },
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
        "正式出勤服務尚未設定。",
        503,
      );
    }

    const { data, error } = await supabase
      .rpc("record_attendance_event", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_client_id: input.clientId,
        p_event_kind: input.eventKind,
        p_occurred_at: input.occurredAt,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      })
      .maybeSingle<AttendanceRpcRow>();

    if (error || !data) throw attendanceFailure(error?.code);

    return ok(
      {
        operation: {
          id: data.operation_id,
          attendanceId: data.attendance_id,
          clientId: input.clientId,
          eventKind: input.eventKind,
          occurredAt: input.occurredAt,
          serviceDate: data.service_date,
          status: data.status,
          checkedInAt: data.checked_in_at,
          checkedOutAt: data.checked_out_at,
          source: data.source,
        },
        replayed: data.replayed,
        persisted: true,
        demo: false,
      },
      data.replayed ? 200 : 201,
      requestId,
    );
  });
}
