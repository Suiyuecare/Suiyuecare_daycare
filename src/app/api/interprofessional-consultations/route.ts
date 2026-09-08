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
  correlateInterprofessionalConsultationReceipt,
  parseInterprofessionalConsultationDatabaseReceipt,
  parseInterprofessionalConsultationMutation,
} from "@/lib/interprofessional-consultations/parser";
import {
  CONSULTATION_ACTIONS,
  type ConsultationAction,
  type InterprofessionalConsultationMutationInput,
} from "@/lib/interprofessional-consultations/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function databaseWriteFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "INTERPROFESSIONAL_CONSULTATION_NOT_AUTHORIZED",
    "目前角色、機構、分支、個案指派、承辦資格或近期雙因素驗證不允許這項操作。", 403,
  );
  if (code === "40001") return databaseFailure(
    "INTERPROFESSIONAL_CONSULTATION_SEQUENCE_CONFLICT",
    "照會已有新的事件、狀態或人員範圍；請重新載入後再操作。", 409,
  );
  if (code === "23505") return databaseFailure(
    "INTERPROFESSIONAL_CONSULTATION_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同內容；請保留資料並重新載入。", 409,
  );
  if (["22023", "22P02", "23503", "23514"].includes(code ?? "")) {
    return databaseFailure(
      "INVALID_INTERPROFESSIONAL_CONSULTATION_STATE",
      "照會內容、承辦人、期限、狀態、回覆或更正目標未通過驗證。", 400,
    );
  }
  return databaseFailure(
    "INTERPROFESSIONAL_CONSULTATION_SAVE_FAILED",
    "操作結果尚未確認；請保留內容並以相同操作鍵重試。", 409,
  );
}

async function authorizeBase() {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY", "展示模式只顯示合成照會，不會寫入或假裝成功。", 403,
  );
  if (
    !actor.scopes.includes("clients.read") ||
    !actor.scopes.includes("interprofessional_consultations.read")
  ) {
    throw new IntegrationError(
      "INTERPROFESSIONAL_CONSULTATION_NOT_AUTHORIZED", "目前角色沒有個案及跨專業照會讀取權限。", 403,
    );
  }
  return actor;
}

async function authorizeAction(
  actor: TenantContext, action: ConsultationAction,
) {
  const permission = action === "create" ? "interprofessional_consultations.create"
    : action === "assign" || action === "reassign"
      ? "interprofessional_consultations.assign"
      : action === "close" || action === "reopen"
        ? "interprofessional_consultations.close"
        : "interprofessional_consultations.respond";
  if (!actor.scopes.includes(permission)) throw new IntegrationError(
    "INTERPROFESSIONAL_CONSULTATION_NOT_AUTHORIZED", "目前角色沒有這項照會操作權限。", 403,
  );
  if (["create", "assign", "reassign", "close", "reopen", "correct"].includes(action)) {
    await requireRecentAal2(actor);
  }
}

async function execute(input: InterprofessionalConsultationMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure(
    "SERVICE_NOT_CONFIGURED", "正式跨專業照會資料服務尚未設定。", 503,
  );
  const { data, error } = await supabase.rpc("mutate_interprofessional_consultation", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_action: input.action,
    p_consultation_key: input.consultationKey,
    p_previous_event_id: input.previousEventId,
    p_expected_sequence: input.expectedSequence,
    p_client_id: input.clientId,
    p_assignee_user_id: input.assigneeUserId,
    p_discipline_code: input.disciplineCode,
    p_discipline_label: input.disciplineLabel,
    p_urgency: input.urgency,
    p_requested_at: input.requestedAt,
    p_deadline_state: input.deadlineState,
    p_due_at: input.dueAt,
    p_problem_summary: input.problemSummary,
    p_entry_content: input.entryContent,
    p_corrects_event_id: input.correctsEventId,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle();
  if (error || !data) throw databaseWriteFailure(error?.code);
  return correlateInterprofessionalConsultationReceipt(
    parseInterprofessionalConsultationDatabaseReceipt(data), input,
    actor.organizationId, actor.branchId,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeBase();
    const requestedAction = request.headers.get("x-interprofessional-consultation-action");
    if (!CONSULTATION_ACTIONS.includes(requestedAction as ConsultationAction)) {
      throw new IntegrationError(
        "INVALID_INTERPROFESSIONAL_CONSULTATION",
        "缺少可驗證的跨專業照會動作標頭。",
        400,
        "x-interprofessional-consultation-action",
      );
    }
    const action = requestedAction as ConsultationAction;
    await authorizeAction(actor, action);
    const body = await readJsonObject(request, 32 * 1024);
    if (body.action !== action) {
      throw new IntegrationError(
        "INVALID_INTERPROFESSIONAL_CONSULTATION",
        "照會動作標頭與內容不一致。",
        400,
        "action",
      );
    }
    const input = parseInterprofessionalConsultationMutation(
      body, request.headers.get("idempotency-key"),
    );
    const receipt = await execute(input, actor);
    return ok({
      organizationId: receipt.organization_id,
      branchId: receipt.branch_id,
      operationId: receipt.operation_id,
      operationKind: receipt.operation_kind,
      consultationKey: receipt.consultation_key,
      eventId: receipt.event_id,
      eventSequence: receipt.event_sequence,
      previousEventId: receipt.previous_event_id,
      eventKind: receipt.event_kind,
      consultationStatus: receipt.consultation_status,
      assignmentState: receipt.assignment_state,
      assigneeUserId: receipt.assignee_user_id,
      deadlineState: receipt.deadline_state,
      notificationCount: receipt.notification_count,
      notificationQueueStatus: receipt.notification_queue_status,
      notificationDeliveryClaim: receipt.notification_delivery_claim,
      externalProviderStatus: receipt.external_provider_status,
      committedAt: receipt.committed_at,
      replayed: receipt.replayed,
      persisted: true as const,
      demo: false as const,
    }, receipt.replayed ? 200 : 201, requestId);
  });
}
