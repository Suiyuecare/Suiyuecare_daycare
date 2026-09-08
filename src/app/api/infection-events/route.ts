import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import {
  parseInfectionEventMutation,
  parseInfectionEventOperationResult,
  parseInfectionEventReport,
} from "@/lib/infection-events/parser";
import type {
  InfectionAction,
  InfectionEventMutationInput,
  InfectionEventOperationResult,
  ReportInfectionEventInput,
} from "@/lib/infection-events/types";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest, databaseFailure, handleIntegrationRoute, readJsonObject, requireRecentAal2,
} from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OperationRow = {
  operation_id: string; incident_id: string; client_id: string; entry_id: string | null;
  operation_kind: string; chain_version: number; handling_status: string;
  cluster_id: string | null; cluster_label: string | null; committed_at: string; replayed: boolean;
};

function failure(code?: string) {
  if (code === "42501") return databaseFailure("INFECTION_EVENT_NOT_AUTHORIZED", "目前角色、分支、個案指派或工作階段不允許這項感染事件操作。", 403);
  if (code === "40001") return databaseFailure("INFECTION_EVENT_CHAIN_CONFLICT", "事件時間軸已有新內容；請重新載入後再操作。", 409);
  if (code === "23505") return databaseFailure("INFECTION_EVENT_IDEMPOTENCY_CONFLICT", "相同冪等鍵曾用於不同內容；請保留資料並重新載入。", 409);
  if (code === "23514" || code === "23503") return databaseFailure("INFECTION_EVENT_STATE_CONFLICT", "事件已結案、群聚目標或鏈結已改變，或個案期間不允許這項操作。", 409);
  if (code === "22023" || code === "22003") return databaseFailure("INVALID_INFECTION_EVENT", "事件時間、感染類型、群聚目標、時間軸內容或鏈版本未通過驗證。", 400);
  return databaseFailure("INFECTION_EVENT_SAVE_FAILED", "感染事件操作尚未確認完成；請保留內容並使用相同冪等鍵重試。");
}

async function authorize(permission: "quality_events.manage" | "quality_events.close") {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式只使用合成事件，不會寫入任何資料。", 403);
  if (!actor.scopes.includes("clients.read") || !actor.scopes.includes(permission)) {
    throw new IntegrationError("INFECTION_EVENT_NOT_AUTHORIZED", "目前角色沒有這項感染事件操作權限。", 403);
  }
  if (permission === "quality_events.close") await requireRecentAal2(actor);
  return actor;
}

function correlate(
  result: Omit<InfectionEventOperationResult, "persisted" | "demo">,
  expected: { action: InfectionAction; clientId: string; incidentId?: string;
    expectedChainVersion?: number; clusterId?: string | null; clusterLabel?: string | null },
) {
  const status = expected.action === "report" ? "reported" : expected.action === "close" ? "closed" : "in_progress";
  const clusterAction = expected.action === "cluster_link" || expected.action === "cluster_unlink";
  const clusterMismatch = clusterAction
    ? expected.action === "cluster_link" && expected.clusterId === null
      ? result.clusterId === null || result.clusterLabel !== expected.clusterLabel
      : result.clusterId !== expected.clusterId || result.clusterLabel !== expected.clusterLabel
    : result.clusterId !== null || result.clusterLabel !== null;
  if (
    result.operationKind !== expected.action || result.clientId !== expected.clientId ||
    result.handlingStatus !== status || clusterMismatch ||
    (expected.action === "report" ? result.entryId !== null || result.chainVersion !== 0 : result.entryId === null) ||
    (expected.incidentId !== undefined && result.incidentId !== expected.incidentId) ||
    (expected.expectedChainVersion !== undefined && result.chainVersion !== expected.expectedChainVersion + 1)
  ) throw new IntegrationError("INFECTION_EVENT_RECEIPT_INVALID", "資料庫完成憑證與本次個案、事件、動作、鏈版本、狀態或群聚不一致；畫面不會把操作當作成功。", 502);
  return result;
}

async function report(input: ReportInfectionEventInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式感染事件服務尚未設定。", 503);
  const { data, error } = await supabase.rpc("report_infection_event", {
    p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId, p_occurred_at: input.occurredAt, p_location: input.location,
    p_event_summary: input.eventSummary, p_infection_type_state: input.infectionTypeState,
    p_infection_type_text: input.infectionTypeText, p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<OperationRow>();
  if (error || !data) throw failure(error?.code);
  return correlate(parseInfectionEventOperationResult(data), { action: "report", clientId: input.clientId });
}

async function mutate(input: InfectionEventMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式感染事件服務尚未設定。", 503);
  const common = { p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId, p_incident_id: input.incidentId, p_occurred_at: input.occurredAt,
    p_expected_chain_version: input.expectedChainVersion, p_idempotency_key: input.idempotencyKey };
  let rpc: string;
  let args: Record<string, unknown>;
  if (input.action === "close") {
    rpc = "close_infection_event";
    args = { ...common, p_closure_outcome: input.closureOutcome, p_closure_reason: input.closureReason };
  } else if (input.action === "cluster_link" || input.action === "cluster_unlink") {
    rpc = input.action === "cluster_link" ? "link_infection_event_cluster" : "unlink_infection_event_cluster";
    args = { ...common, p_cluster_id: input.clusterId, p_cluster_label: input.clusterLabel };
  } else if (input.action === "treatment" || input.action === "follow_up") {
    rpc = input.action === "treatment" ? "add_infection_event_treatment" : "add_infection_event_follow_up";
    args = { ...common, p_entry_text: input.entryText };
  } else {
    throw new IntegrationError("INVALID_INFECTION_EVENT", "不支援的感染事件動作。", 400);
  }
  const { data, error } = await supabase.rpc(rpc, args).maybeSingle<OperationRow>();
  if (error || !data) throw failure(error?.code);
  return correlate(parseInfectionEventOperationResult(data), {
    action: input.action, clientId: input.clientId, incidentId: input.incidentId,
    expectedChainVersion: input.expectedChainVersion,
    ...((input.action === "cluster_link" || input.action === "cluster_unlink")
      ? { clusterId: input.clusterId, clusterLabel: input.clusterLabel } : {}),
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize("quality_events.manage");
    const input = parseInfectionEventReport(await readJsonObject(request, 12 * 1024), request.headers.get("idempotency-key"));
    const result = await report(input, actor);
    return ok({ ...result, persisted: true as const, demo: false as const }, result.replayed ? 200 : 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const headerAction = request.headers.get("x-infection-action");
    if (!["treatment", "follow_up", "cluster_link", "cluster_unlink", "close"].includes(headerAction ?? "")) {
      throw new IntegrationError("INVALID_INFECTION_EVENT", "缺少可驗證的感染事件動作標頭。", 400, "x-infection-action");
    }
    const action = headerAction as Exclude<InfectionAction, "report">;
    const actor = await authorize(action === "close" ? "quality_events.close" : "quality_events.manage");
    const body = await readJsonObject(request, 12 * 1024);
    if (body.action !== action) throw new IntegrationError("INVALID_INFECTION_EVENT", "動作標頭與內容不一致。", 400, "action");
    const input = parseInfectionEventMutation(body, request.headers.get("idempotency-key"));
    const result = await mutate(input, actor);
    return ok({ ...result, persisted: true as const, demo: false as const }, 200, requestId);
  });
}
