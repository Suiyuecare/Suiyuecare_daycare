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
  correlateInsulinReceipt,
  parseInsulinDatabaseReceipt,
  parseInsulinMutation,
} from "@/lib/insulin-administrations/parser";
import {
  INSULIN_ACTIONS,
  type InsulinAction,
  type InsulinMutationInput,
} from "@/lib/insulin-administrations/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function databaseWriteFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "INSULIN_NOT_AUTHORIZED",
    "目前角色、個案指派、有效資格或同一工作階段的近期雙因素驗證不允許這項操作。", 403,
  );
  if (code === "55000") return databaseFailure(
    "INSULIN_GOVERNANCE_NOT_CONFIGURED",
    "正式資格、胰島素指定、劑量或逾時補登治理尚未完成發布。", 503,
  );
  if (code === "40001") return databaseFailure(
    "INSULIN_VERSION_CONFLICT",
    "施打紀錄已有較新的不可變事件；請重新載入後再操作。", 409,
  );
  if (code === "23505") return databaseFailure(
    "INSULIN_IDEMPOTENCY_OR_SLOT_CONFLICT",
    "相同操作鍵或計畫時點已有紀錄；請保留內容並重新載入。", 409,
  );
  if (code === "23514") return databaseFailure(
    "INSULIN_PLAN_OR_RULE_CONFLICT",
    "有效用藥計畫、治理版本、劑量或事件狀態不一致。", 409,
  );
  if (["22023", "22P02", "23503"].includes(code ?? "")) return databaseFailure(
    "INVALID_INSULIN_ADMINISTRATION",
    "排程、劑量、部位、理由或版本鏈未通過驗證。", 400,
  );
  return databaseFailure(
    "INSULIN_SAVE_RESULT_UNKNOWN",
    "操作結果尚未確認；請保留內容並以相同操作鍵重試。", 409,
  );
}

function declaredAction(request: Request): InsulinAction {
  const value = request.headers.get("x-insulin-operation");
  if (!INSULIN_ACTIONS.includes(value as InsulinAction)) throw new IntegrationError(
    "INVALID_INSULIN_OPERATION",
    "請先以受治理操作標頭宣告有效的胰島素操作。", 400,
    "x-insulin-operation",
  );
  return value as InsulinAction;
}

async function authorizeBase() {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY", "展示模式只顯示合成胰島素流程，不會寫入或假裝成功。", 403,
  );
  if (!actor.scopes.includes("clients.read") ||
      !actor.scopes.includes("medications.read") ||
      !actor.scopes.includes("insulin_administrations.read")) {
    throw new IntegrationError(
      "INSULIN_NOT_AUTHORIZED", "目前角色沒有個案、用藥與胰島素紀錄讀取權限。", 403,
    );
  }
  return actor;
}

async function authorizeAction(actor: TenantContext, action: InsulinAction) {
  const permission = action === "authorize_late" ? "insulin_administrations.authorize_late"
    : action === "execute" ? "insulin_administrations.execute"
      : "insulin_administrations.verify";
  if (!actor.scopes.includes(permission)) throw new IntegrationError(
    "INSULIN_NOT_AUTHORIZED", "目前角色沒有這項胰島素操作權限。", 403,
  );
  await requireRecentAal2(actor);
}

async function execute(input: InsulinMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure(
    "SERVICE_NOT_CONFIGURED", "正式胰島素資料服務尚未設定。", 503,
  );
  const isReview = input.action === "review";
  const isExecute = input.action === "execute";
  const { data, error } = await supabase.rpc("mutate_insulin_administration", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_action: input.action,
    p_administration_key: input.administrationKey,
    p_previous_event_id: input.previousEventId,
    p_expected_sequence: input.expectedSequence,
    p_medication_plan_id: isReview ? null : input.medicationPlanId,
    p_scheduled_for: isReview ? null : input.scheduledFor,
    p_dose_text: isExecute ? input.doseText : null,
    p_dose_unit: isExecute ? input.doseUnit : null,
    p_site_code: isExecute ? input.siteCode : null,
    p_site_text: isExecute ? input.siteText : null,
    p_late_reason: input.action === "authorize_late" ? input.lateReason : null,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle();
  if (error || !data) throw databaseWriteFailure(error?.code);
  return correlateInsulinReceipt(
    parseInsulinDatabaseReceipt(data), input, actor.organizationId, actor.branchId,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const action = declaredAction(request);
    const actor = await authorizeBase();
    await authorizeAction(actor, action);
    const input = parseInsulinMutation(
      await readJsonObject(request, 16 * 1024), request.headers.get("idempotency-key"),
    );
    if (input.action !== action) throw new IntegrationError(
      "INVALID_INSULIN_OPERATION", "操作標頭與胰島素內容不一致。", 400, "action",
    );
    const receipt = await execute(input, actor);
    return ok({
      organizationId: receipt.organization_id,
      branchId: receipt.branch_id,
      operationId: receipt.operation_id,
      operationKind: receipt.operation_kind,
      administrationKey: receipt.administration_key,
      eventId: receipt.event_id,
      eventSequence: receipt.event_sequence,
      previousEventId: receipt.previous_event_id,
      state: receipt.state,
      medicationPlanId: receipt.medication_plan_id,
      governanceVersionId: receipt.governance_version_id,
      scheduledFor: receipt.scheduled_for,
      executedAt: receipt.executed_at,
      reviewedAt: receipt.reviewed_at,
      contentHash: receipt.content_hash,
      qualificationStatus: receipt.qualification_status,
      doseRuleStatus: receipt.dose_rule_status,
      lateEntryRuleStatus: receipt.late_entry_rule_status,
      completionStatus: receipt.completion_status,
      offlineStatus: receipt.offline_status,
      committedAt: receipt.committed_at,
      replayed: receipt.replayed,
      persisted: true as const,
      demo: false as const,
    }, receipt.replayed ? 200 : 201, requestId);
  });
}
