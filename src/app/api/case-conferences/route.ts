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
  correlateCaseConferenceReceipt,
  parseCaseConferenceDatabaseReceipt,
  parseCaseConferenceMutation,
} from "@/lib/case-conferences/parser";
import {
  CASE_CONFERENCE_ACTIONS,
  type CaseConferenceAction,
  type CaseConferenceMutationInput,
} from "@/lib/case-conferences/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function databaseWriteFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "CASE_CONFERENCE_NOT_AUTHORIZED",
    "目前角色、機構、分支、個案指派或近期雙因素驗證不允許這項操作。", 403,
  );
  if (code === "40001") return databaseFailure(
    "CASE_CONFERENCE_VERSION_CONFLICT",
    "會議已有較新的版本或狀態；請重新載入後再操作。", 409,
  );
  if (code === "23505") return databaseFailure(
    "CASE_CONFERENCE_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同內容；請保留資料並重新載入。", 409,
  );
  if (["22023", "22P02", "23503", "23514"].includes(code ?? "")) {
    return databaseFailure(
      "INVALID_CASE_CONFERENCE_STATE",
      "會議內容、出席者、行動、期限、簽署或更正版本未通過驗證。", 400,
    );
  }
  return databaseFailure(
    "CASE_CONFERENCE_SAVE_FAILED",
    "操作結果尚未確認；請保留內容並以相同操作鍵重試。", 409,
  );
}

async function authorizeBase() {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY", "展示模式只顯示合成個案研討，不會寫入或假裝成功。", 403,
  );
  if (!actor.scopes.includes("clients.read") ||
      !actor.scopes.includes("case_conferences.read")) {
    throw new IntegrationError(
      "CASE_CONFERENCE_NOT_AUTHORIZED", "目前角色沒有個案及個案研討讀取權限。", 403,
    );
  }
  return actor;
}

function declaredAction(request: Request): CaseConferenceAction {
  const value = request.headers.get("x-case-conference-operation");
  if (!CASE_CONFERENCE_ACTIONS.includes(value as CaseConferenceAction)) {
    throw new IntegrationError(
      "INVALID_CASE_CONFERENCE_OPERATION",
      "請先以受治理操作標頭宣告有效的個案研討操作。", 400, "x-case-conference-operation",
    );
  }
  return value as CaseConferenceAction;
}

async function authorizeAction(actor: TenantContext, action: CaseConferenceAction) {
  if (action === "create" || action === "revise") {
    if (!actor.scopes.includes("case_conferences.manage")) throw new IntegrationError(
      "CASE_CONFERENCE_NOT_AUTHORIZED", "目前角色沒有建立或修訂個案研討的權限。", 403,
    );
    return;
  }
  if (!actor.scopes.includes("case_conferences.sign") ||
      (action === "correct" && !actor.scopes.includes("case_conferences.manage"))) {
    throw new IntegrationError(
      "CASE_CONFERENCE_NOT_AUTHORIZED", "目前角色沒有簽署或更正個案研討的權限。", 403,
    );
  }
  await requireRecentAal2(actor);
}

async function execute(input: CaseConferenceMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure(
    "SERVICE_NOT_CONFIGURED", "正式個案研討資料服務尚未設定。", 503,
  );
  const { data, error } = await supabase.rpc("mutate_case_conference", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_action: input.action,
    p_meeting_key: input.meetingKey,
    p_previous_version_id: input.previousVersionId,
    p_expected_version: input.expectedVersion,
    p_corrects_version_id: input.correctsVersionId,
    p_client_id: input.clientId,
    p_meeting_starts_at: input.meetingStartsAt,
    p_meeting_ends_at: input.meetingEndsAt,
    p_problem_statement: input.problemStatement,
    p_decision_summary: input.decisionSummary,
    p_attendees: input.attendees?.map((entry) => ({
      user_id: entry.userId, attendance_status: entry.attendanceStatus,
    })) ?? null,
    p_action_items: input.actionItems?.map((entry) => ({
      action_id: entry.actionId,
      item_order: entry.itemOrder,
      action_text: entry.actionText,
      responsible_user_id: entry.responsibleUserId,
      deadline_state: entry.deadlineState,
      due_date: entry.dueDate,
      action_status: entry.actionStatus,
    })) ?? null,
    p_correction_reason: input.correctionReason,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle();
  if (error || !data) throw databaseWriteFailure(error?.code);
  return correlateCaseConferenceReceipt(
    parseCaseConferenceDatabaseReceipt(data), input,
    actor.organizationId, actor.branchId,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const action = declaredAction(request);
    const actor = await authorizeBase();
    await authorizeAction(actor, action);
    const input = parseCaseConferenceMutation(
      await readJsonObject(request, 64 * 1024), request.headers.get("idempotency-key"),
    );
    if (input.action !== action) throw new IntegrationError(
      "INVALID_CASE_CONFERENCE_OPERATION",
      "操作標頭與個案研討內容不一致。", 400, "action",
    );
    const receipt = await execute(input, actor);
    return ok({
      organizationId: receipt.organization_id,
      branchId: receipt.branch_id,
      operationId: receipt.operation_id,
      operationKind: receipt.operation_kind,
      meetingKey: receipt.meeting_key,
      versionId: receipt.version_id,
      version: receipt.version,
      previousVersionId: receipt.previous_version_id,
      correctsVersionId: receipt.corrects_version_id,
      versionKind: receipt.version_kind,
      conferenceStatus: receipt.conference_status,
      signedAt: receipt.signed_at,
      contentHash: receipt.content_hash,
      attachmentStatus: receipt.attachment_status,
      exportStatus: receipt.export_status,
      notificationStatus: receipt.notification_status,
      externalDeliveryStatus: receipt.external_delivery_status,
      deliveryClaim: receipt.delivery_claim,
      offlineStatus: receipt.offline_status,
      committedAt: receipt.committed_at,
      replayed: receipt.replayed,
      persisted: true as const,
      demo: false as const,
    }, receipt.replayed ? 200 : 201, requestId);
  });
}
