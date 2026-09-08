import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import {
  FEEDBACK_MUTATION_MAX_BYTES,
  parseFeedbackComplaintMutation,
  parseFeedbackComplaintReceipt,
} from "@/lib/feedback-complaints/parser";
import type {
  FeedbackAction,
  FeedbackComplaintMutationInput,
} from "@/lib/feedback-complaints/types";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OperationRow = {
  operation_id: string;
  action: string;
  case_id: string;
  case_number: string;
  event_id: string;
  version: number;
  status: string;
  effective_risk: string;
  due_at: string;
  committed_at: string;
  replayed: boolean;
};

function databaseError(code?: string) {
  if (code === "42501") return databaseFailure(
    "FEEDBACK_NOT_AUTHORIZED",
    "目前角色、分支、敏感欄位權限或工作階段不允許這項意見與申訴操作。", 403,
  );
  if (code === "40001") return databaseFailure(
    "FEEDBACK_VERSION_CONFLICT",
    "案件已有新的不可變事件；請重新載入後再操作。", 409,
  );
  if (code === "23505") return databaseFailure(
    "FEEDBACK_IDEMPOTENCY_CONFLICT",
    "相同冪等鍵曾用於不同內容；請保留資料並重新載入。", 409,
  );
  if (code === "23503" || code === "23514") return databaseFailure(
    "FEEDBACK_STATE_CONFLICT",
    "期限規則、承辦人、案件狀態或更正目標已改變；本次操作未套用。", 409,
  );
  if (code === "22023" || code === "22003") return databaseFailure(
    "INVALID_FEEDBACK_OPERATION",
    "案件內容、時間、期限規則、版本或操作欄位未通過驗證。", 400,
  );
  return databaseFailure(
    "FEEDBACK_SAVE_FAILED",
    "意見與申訴操作結果尚未確認；請保留內容並以相同冪等鍵重試。",
  );
}

async function authorize(action: FeedbackAction) {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY", "展示模式只使用合成案件，不會寫入正式或本機資料。", 403,
  );
  const required = action === "close" ? "complaints.close" : "complaints.manage";
  if (!actor.scopes.includes("complaints.read") || !actor.scopes.includes(required) ||
    (action === "correct" && !actor.scopes.includes("complaints.sensitive"))) {
    throw new IntegrationError(
      "FEEDBACK_NOT_AUTHORIZED", "目前角色沒有這項意見與申訴操作權限。", 403,
    );
  }
  if (action === "correct" || action === "close") await requireRecentAal2(actor);
  return actor;
}

function ensureActionHeader(request: Request, expected: FeedbackAction) {
  const action = request.headers.get("x-feedback-operation");
  if (action !== expected) throw new IntegrationError(
    "INVALID_FEEDBACK_OPERATION", "動作標頭與 HTTP 方法或內容不一致。", 400,
    "x-feedback-operation",
  );
}

async function runMutation(
  input: FeedbackComplaintMutationInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure(
    "SERVICE_NOT_CONFIGURED", "正式意見與申訴資料服務尚未設定。", 503,
  );
  if (input.action === "create") {
    const { data, error } = await supabase.rpc("submit_feedback_complaint", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_deadline_rule_id: input.deadlineRuleId,
      p_received_at: input.receivedAt,
      p_reporter_name: input.reporterName,
      p_reporter_contact: input.reporterContact,
      p_subject: input.subject,
      p_description: input.description,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
    if (error || !data) throw databaseError(error?.code);
    return parseFeedbackComplaintReceipt(data, input);
  }
  const common = {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_action: input.action,
    p_case_id: input.caseId,
    p_expected_version: input.expectedVersion,
    p_assignee_membership_id: input.action === "assign"
      ? input.assigneeMembershipId : null,
    p_note: input.action === "assign" || input.action === "progress"
      ? input.note : null,
    p_corrected_event_id: input.action === "correct" ? input.correctedEventId : null,
    p_correction_reason: input.action === "correct" ? input.correctionReason : null,
    p_reporter_name: input.action === "correct" ? input.reporterName : null,
    p_reporter_contact: input.action === "correct" ? input.reporterContact : null,
    p_subject: input.action === "correct" ? input.subject : null,
    p_description: input.action === "correct" ? input.description : null,
    p_resolution: input.action === "close" ? input.resolution : null,
    p_idempotency_key: input.idempotencyKey,
  };
  const { data, error } = await supabase.rpc(
    "append_feedback_complaint_event", common,
  ).maybeSingle<OperationRow>();
  if (error || !data) throw databaseError(error?.code);
  return parseFeedbackComplaintReceipt(data, input);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    ensureActionHeader(request, "create");
    const actor = await authorize("create");
    const body = await readJsonObject(request, FEEDBACK_MUTATION_MAX_BYTES);
    if (body.action !== "create") throw new IntegrationError(
      "INVALID_FEEDBACK_OPERATION", "POST 僅接受建立案件。", 400, "action",
    );
    const input = parseFeedbackComplaintMutation(
      body, request.headers.get("idempotency-key"),
    );
    const receipt = await runMutation(input, actor);
    return ok(receipt, receipt.replayed ? 200 : 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actionHeader = request.headers.get("x-feedback-operation");
    if (!["assign", "progress", "correct", "close"].includes(actionHeader ?? "")) {
      throw new IntegrationError(
        "INVALID_FEEDBACK_OPERATION", "PATCH 動作標頭無效。", 400,
        "x-feedback-operation",
      );
    }
    const action = actionHeader as FeedbackAction;
    const actor = await authorize(action);
    const body = await readJsonObject(request, FEEDBACK_MUTATION_MAX_BYTES);
    if (!["assign", "progress", "correct", "close"].includes(String(body.action))) {
      throw new IntegrationError(
        "INVALID_FEEDBACK_OPERATION", "PATCH 不支援這項案件動作。", 400, "action",
      );
    }
    const input = parseFeedbackComplaintMutation(
      body, request.headers.get("idempotency-key"),
    );
    ensureActionHeader(request, input.action);
    const receipt = await runMutation(input, actor);
    return ok(receipt, 200, requestId);
  });
}
