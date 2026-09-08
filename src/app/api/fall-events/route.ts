import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import {
  parseFallEventMutation,
  parseFallEventOperationResult,
  parseFallEventReport,
} from "@/lib/fall-events/parser";
import type {
  FallEventMutationInput,
  FallEventOperationResult,
  ReportFallEventInput,
} from "@/lib/fall-events/types";
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
  client_id: string;
  entry_id: string | null;
  chain_version: number;
  handling_status: string;
  committed_at: string;
  replayed: boolean;
};

function fallEventFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "FALL_EVENT_NOT_AUTHORIZED",
      "目前角色、分支、個案指派或工作階段不允許這項跌倒事件操作。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "FALL_EVENT_CHAIN_CONFLICT",
      "事件時間軸已有新內容；請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "FALL_EVENT_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同內容；請保留資料並重新載入。",
      409,
    );
  }
  if (errorCode === "23514" || errorCode === "23503") {
    return databaseFailure(
      "FALL_EVENT_STATE_CONFLICT",
      "事件已結案、鏈結已改變，或個案期間不允許這項操作。",
      409,
    );
  }
  if (errorCode === "22023" || errorCode === "22003") {
    return databaseFailure(
      "INVALID_FALL_EVENT",
      "事件時間、補登理由、傷害資訊、時間軸內容或鏈版本未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "FALL_EVENT_SAVE_FAILED",
    "跌倒事件操作尚未確認完成；請保留內容並使用相同冪等鍵重試。",
  );
}

async function authorize(permission: "quality_events.manage" | "quality_events.close") {
  const actor = await authorizeStaffRequest();
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只使用合成事件，不會寫入正式或本機資料。",
      403,
    );
  }
  if (!actor.scopes.includes("clients.read") || !actor.scopes.includes(permission)) {
    throw new IntegrationError(
      "FALL_EVENT_NOT_AUTHORIZED",
      "目前角色沒有這項跌倒事件操作權限。",
      403,
    );
  }
  if (permission === "quality_events.close") await requireRecentAal2(actor);
  return actor;
}

function correlateReceipt(
  result: Omit<FallEventOperationResult, "persisted" | "demo">,
  expectation: {
    action: "report" | "treatment" | "follow_up" | "close";
    clientId: string;
    incidentId?: string;
    expectedChainVersion?: number;
  },
) {
  const expectedStatus = expectation.action === "report"
    ? "reported"
    : expectation.action === "close" ? "closed" : "in_progress";
  if (
    result.clientId !== expectation.clientId ||
    result.handlingStatus !== expectedStatus ||
    (expectation.action === "report"
      ? result.entryId !== null || result.chainVersion !== 0
      : result.entryId === null) ||
    (expectation.incidentId !== undefined && result.incidentId !== expectation.incidentId) ||
    (expectation.expectedChainVersion !== undefined &&
      result.chainVersion !== expectation.expectedChainVersion + 1)
  ) {
    throw new IntegrationError(
      "FALL_EVENT_RECEIPT_INVALID",
      "資料庫完成憑證與本次操作不一致；畫面不會把操作當作成功。",
      502,
    );
  }
  return result;
}

async function executeReport(input: ReportFallEventInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式跌倒事件服務尚未設定。", 503);
  const { data, error } = await supabase.rpc("report_fall_event", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_occurred_at: input.occurredAt,
    p_location: input.location,
    p_event_summary: input.eventSummary,
    p_injury_degree_state: input.injuryDegreeState,
    p_injury_degree_text: input.injuryDegreeText,
    p_late_entry_reason: input.lateEntryReason,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<OperationRow>();
  if (error || !data) throw fallEventFailure(error?.code);
  return correlateReceipt(parseFallEventOperationResult(data), {
    action: "report",
    clientId: input.clientId,
  });
}

async function executeMutation(input: FallEventMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式跌倒事件服務尚未設定。", 503);
  let result: { data: OperationRow | null; error: { code?: string } | null };
  if (input.action === "close") {
    result = await supabase.rpc("close_fall_event", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_incident_id: input.incidentId,
      p_occurred_at: input.occurredAt,
      p_closure_outcome: input.closureOutcome,
      p_closure_reason: input.closureReason,
      p_expected_chain_version: input.expectedChainVersion,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  } else {
    const rpc = input.action === "treatment"
      ? "add_fall_event_treatment"
      : "add_fall_event_follow_up";
    result = await supabase.rpc(rpc, {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_incident_id: input.incidentId,
      p_occurred_at: input.occurredAt,
      p_entry_text: input.entryText,
      p_expected_chain_version: input.expectedChainVersion,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  }
  if (result.error || !result.data) throw fallEventFailure(result.error?.code);
  return correlateReceipt(parseFallEventOperationResult(result.data), {
    action: input.action,
    clientId: input.clientId,
    incidentId: input.incidentId,
    expectedChainVersion: input.expectedChainVersion,
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize("quality_events.manage");
    const input = parseFallEventReport(
      await readJsonObject(request, 12 * 1024),
      request.headers.get("idempotency-key"),
    );
    const result = await executeReport(input, actor);
    return ok(
      { ...result, persisted: true as const, demo: false as const },
      result.replayed ? 200 : 201,
      requestId,
    );
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    // Read only the action discriminator after ordinary staff authorization;
    // detailed validation still occurs only after the matching permission gate.
    const actor = await authorizeStaffRequest();
    if (actor.demo) {
      throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會寫入事件資料。", 403);
    }
    const body = await readJsonObject(request, 12 * 1024);
    const permission = body.action === "close" ? "quality_events.close" : "quality_events.manage";
    if (!actor.scopes.includes("clients.read") || !actor.scopes.includes(permission)) {
      throw new IntegrationError("FALL_EVENT_NOT_AUTHORIZED", "目前角色沒有這項跌倒事件操作權限。", 403);
    }
    if (permission === "quality_events.close") await requireRecentAal2(actor);
    const input = parseFallEventMutation(body, request.headers.get("idempotency-key"));
    const result = await executeMutation(input, actor);
    return ok(
      { ...result, persisted: true as const, demo: false as const },
      200,
      requestId,
    );
  });
}
