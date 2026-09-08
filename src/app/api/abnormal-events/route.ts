import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import {
  parseAbnormalEventMutation,
  parseAbnormalEventOperationResult,
  parseAbnormalEventReport,
} from "@/lib/abnormal-events/parser";
import type {
  AbnormalAction,
  AbnormalEventMutationInput,
  AbnormalEventOperationResult,
  ReportAbnormalEventInput,
} from "@/lib/abnormal-events/types";
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
  incident_id: string;
  entry_id: string | null;
  operation_kind: string;
  affected_target_kind: string;
  affected_client_id: string | null;
  chain_version: number;
  handling_status: string;
  responsible_membership_id: string;
  effective_due_date: string;
  committed_at: string;
  replayed: boolean;
};

function failure(code?: string) {
  if (code === "42501") return databaseFailure(
    "ABNORMAL_EVENT_NOT_AUTHORIZED",
    "目前角色、分支、個案指派或工作階段不允許這項異常事件操作。",
    403,
  );
  if (code === "40001") return databaseFailure(
    "ABNORMAL_EVENT_CHAIN_CONFLICT",
    "事件時間軸已有新內容；請重新載入後再操作。",
    409,
  );
  if (code === "23505") return databaseFailure(
    "ABNORMAL_EVENT_IDEMPOTENCY_CONFLICT",
    "相同冪等鍵曾用於不同內容；請保留資料並重新載入。",
    409,
  );
  if (code === "23514" || code === "23503") return databaseFailure(
    "ABNORMAL_EVENT_STATE_CONFLICT",
    "事件已結案、責任人或時間軸狀態已改變，或個案期間不允許這項操作。",
    409,
  );
  if (code === "22023" || code === "22003") return databaseFailure(
    "INVALID_ABNORMAL_EVENT",
    "事件時間、影響對象、重大性、補登理由、責任人、改善期限或時間軸內容未通過驗證。",
    400,
  );
  return databaseFailure(
    "ABNORMAL_EVENT_SAVE_FAILED",
    "異常事件操作尚未確認完成；請保留內容並使用相同冪等鍵重試。",
  );
}

async function authorize(permission: "quality_events.manage" | "quality_events.close") {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY",
    "展示模式只使用合成異常事件，不會寫入正式或本機資料。",
    403,
  );
  if (!actor.scopes.includes("clients.read") || !actor.scopes.includes(permission)) {
    throw new IntegrationError(
      "ABNORMAL_EVENT_NOT_AUTHORIZED",
      "目前角色沒有這項異常事件操作權限。",
      403,
    );
  }
  if (permission === "quality_events.close") await requireRecentAal2(actor);
  return actor;
}

function correlate(
  result: Omit<AbnormalEventOperationResult, "persisted" | "demo">,
  expected: {
    action: AbnormalAction;
    affectedTargetKind: string;
    affectedClientId: string | null;
    incidentId?: string;
    expectedChainVersion?: number;
  },
) {
  const status = expected.action === "report" ? "reported"
    : expected.action === "close" ? "closed" : "in_progress";
  if (
    result.operationKind !== expected.action ||
    result.affectedTargetKind !== expected.affectedTargetKind ||
    result.affectedClientId !== expected.affectedClientId ||
    result.handlingStatus !== status ||
    (expected.action === "report"
      ? result.entryId !== null || result.chainVersion !== 0
      : result.entryId === null) ||
    (expected.incidentId !== undefined && result.incidentId !== expected.incidentId) ||
    (expected.expectedChainVersion !== undefined &&
      result.chainVersion !== expected.expectedChainVersion + 1)
  ) throw new IntegrationError(
    "ABNORMAL_EVENT_RECEIPT_INVALID",
    "資料庫完成憑證與本次影響對象、事件、動作、鏈版本或狀態不一致；畫面不會把操作當作成功。",
    502,
  );
  return result;
}

async function report(input: ReportAbnormalEventInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式異常事件服務尚未設定。", 503);
  const { data, error } = await supabase.rpc("report_abnormal_event", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_affected_target_kind: input.affectedTargetKind,
    p_affected_client_id: input.affectedClientId,
    p_affected_target_label: input.affectedTargetLabel,
    p_occurred_at: input.occurredAt,
    p_location: input.location,
    p_event_type: input.eventType,
    p_event_summary: input.eventSummary,
    p_immediate_action: input.immediateAction,
    p_major_state: input.majorState,
    p_responsible_membership_id: input.responsibleMembershipId,
    p_improvement_due_date: input.improvementDueDate,
    p_late_entry_reason: input.lateEntryReason,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<OperationRow>();
  if (error || !data) throw failure(error?.code);
  return correlate(parseAbnormalEventOperationResult(data), {
    action: "report",
    affectedTargetKind: input.affectedTargetKind,
    affectedClientId: input.affectedClientId,
  });
}

async function mutate(input: AbnormalEventMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式異常事件服務尚未設定。", 503);
  const common = {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_affected_target_kind: input.affectedTargetKind,
    p_affected_client_id: input.affectedClientId,
    p_incident_id: input.incidentId,
    p_occurred_at: input.occurredAt,
    p_expected_chain_version: input.expectedChainVersion,
    p_idempotency_key: input.idempotencyKey,
  };
  let rpc: string;
  let args: Record<string, unknown>;
  if (input.action === "manual_notification") {
    rpc = "add_abnormal_event_manual_notification";
    args = { ...common, p_notification_target: input.notificationTarget,
      p_notification_method: input.notificationMethod,
      p_notification_result: input.notificationResult };
  } else if (input.action === "improvement" || input.action === "follow_up") {
    rpc = input.action === "improvement"
      ? "add_abnormal_event_improvement"
      : "add_abnormal_event_follow_up";
    args = { ...common, p_entry_text: input.entryText,
      p_responsible_membership_id: input.responsibleMembershipId,
      p_due_date_action: input.dueDateAction, p_due_date_value: input.dueDateValue };
  } else if (input.action === "close") {
    rpc = "close_abnormal_event";
    args = { ...common, p_closure_outcome: input.closureOutcome,
      p_closure_reason: input.closureReason };
  } else {
    throw new IntegrationError("INVALID_ABNORMAL_EVENT", "不支援的異常事件操作。", 400);
  }
  const { data, error } = await supabase.rpc(rpc, args).maybeSingle<OperationRow>();
  if (error || !data) throw failure(error?.code);
  return correlate(parseAbnormalEventOperationResult(data), {
    action: input.action,
    affectedTargetKind: input.affectedTargetKind,
    affectedClientId: input.affectedClientId,
    incidentId: input.incidentId,
    expectedChainVersion: input.expectedChainVersion,
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize("quality_events.manage");
    const input = parseAbnormalEventReport(
      await readJsonObject(request, 16 * 1024),
      request.headers.get("idempotency-key"),
    );
    const result = await report(input, actor);
    return ok({ ...result, persisted: true as const, demo: false as const },
      result.replayed ? 200 : 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const headerAction = request.headers.get("x-abnormal-action");
    if (!["manual_notification", "improvement", "follow_up", "close"].includes(headerAction ?? "")) {
      throw new IntegrationError(
        "INVALID_ABNORMAL_EVENT",
        "缺少可驗證的異常事件動作標頭。",
        400,
        "x-abnormal-action",
      );
    }
    const action = headerAction as Exclude<AbnormalAction, "report">;
    const actor = await authorize(action === "close" ? "quality_events.close" : "quality_events.manage");
    const body = await readJsonObject(request, 16 * 1024);
    if (body.action !== action) throw new IntegrationError(
      "INVALID_ABNORMAL_EVENT",
      "動作標頭與內容不一致。",
      400,
      "action",
    );
    const input = parseAbnormalEventMutation(body, request.headers.get("idempotency-key"));
    const result = await mutate(input, actor);
    return ok({ ...result, persisted: true as const, demo: false as const }, 200, requestId);
  });
}
