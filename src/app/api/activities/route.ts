import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest, databaseFailure, handleIntegrationRoute,
  readJsonObject, requireRecentAal2,
} from "@/lib/integrations/http";
import {
  correlateActivityResult, parseActivityMutation, parseActivityOperationResult,
} from "@/lib/activities/parser";
import type { ActivityMutationInput } from "@/lib/activities/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OperationRow = {
  operation_id: string; operation_kind: string; activity_id: string;
  schedule_version_id: string; schedule_version: number;
  previous_schedule_version_id: string | null; status_event_id: string;
  status_sequence: number; previous_status_event_id: string | null; status: string;
  responsible_user_id: string; participant_client_ids: string[];
  committed_at: string; replayed: boolean;
};

function failure(code?: string) {
  if (code === "42501") return databaseFailure("ACTIVITY_NOT_AUTHORIZED", "目前角色、分支、負責人、參與個案或工作階段不允許這項活動操作。", 403);
  if (code === "40001") return databaseFailure("ACTIVITY_VERSION_CONFLICT", "活動排程或狀態已有新版本；請重新載入。", 409);
  if (code === "23505") return databaseFailure("ACTIVITY_IDEMPOTENCY_CONFLICT", "相同冪等鍵曾用於不同內容，請確認上次結果後再操作。", 409);
  if (["23514", "23503", "55000"].includes(code ?? "")) return databaseFailure("INVALID_ACTIVITY_STATE", "活動歷史、狀態轉換或關聯資料未通過驗證。", 422);
  if (["22001", "22003", "22023"].includes(code ?? "")) return databaseFailure("INVALID_ACTIVITY_OPERATION", "活動欄位、時間或技術邊界未通過驗證。", 400);
  return databaseFailure("ACTIVITY_SAVE_FAILED", "操作完成狀態不明；請保留內容並以相同冪等鍵重試。", 500);
}

async function authorize(input: ActivityMutationInput) {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式只讀取合成活動，不會寫入正式資料。", 403);
  if (!actor.scopes.includes("clients.read") || !actor.scopes.includes("activity.manage") ||
      (input.action === "cancel" && !actor.scopes.includes("activity.cancel"))) {
    throw new IntegrationError("ACTIVITY_NOT_AUTHORIZED", "目前角色沒有這項活動管理權限。", 403);
  }
  if (input.action === "cancel") await requireRecentAal2(actor);
  return actor;
}

async function execute(input: ActivityMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式活動管理服務尚未設定。", 503);
  const { data, error } = await supabase.rpc("mutate_activity", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId, p_action: input.action,
    p_activity_id: input.activityId,
    p_expected_schedule_version_id: input.expectedScheduleVersionId,
    p_expected_schedule_version: input.expectedScheduleVersion,
    p_expected_status_event_id: input.expectedStatusEventId,
    p_expected_status_sequence: input.expectedStatusSequence,
    p_activity_type: input.activityType, p_title: input.title,
    p_search_summary: input.searchSummary, p_location: input.location,
    p_starts_at: input.startsAt, p_ends_at: input.endsAt,
    p_responsible_user_id: input.responsibleUserId,
    p_participant_client_ids: input.participantClientIds,
    p_capacity: input.capacity, p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<OperationRow>();
  if (error || !data) throw failure(error?.code);
  return correlateActivityResult(parseActivityOperationResult(data), input);
}

async function mutate(request: Request, expected: "create" | "non-create") {
  return handleIntegrationRoute(async (requestId) => {
    const body = await readJsonObject(request, 16 * 1024);
    const input = parseActivityMutation(body, request.headers.get("idempotency-key"));
    if ((expected === "create") !== (input.action === "create")) {
      throw new IntegrationError("INVALID_ACTIVITY_METHOD", expected === "create"
        ? "建立活動請使用 create 操作。" : "修改或狀態操作不得使用 create。", 400, "action");
    }
    const actor = await authorize(input);
    const result = await execute(input, actor);
    return ok({ ...result, persisted: true as const, demo: false as const },
      input.action === "create" && !result.replayed ? 201 : 200, requestId);
  });
}

export async function POST(request: Request) { return mutate(request, "create"); }
export async function PATCH(request: Request) { return mutate(request, "non-create"); }
