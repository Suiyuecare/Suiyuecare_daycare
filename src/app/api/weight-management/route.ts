import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseRecordWeight, parseWeightMutation, parseWeightOperationResult } from "@/lib/weight-management/parser";
import type { RecordWeightInput, WeightMutationInput, WeightOperationResult } from "@/lib/weight-management/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OperationRow = {
  operation_id: string; operation_kind: string; client_id: string;
  observation_id: string; correction_id: string | null; correction_version: number | null;
  prior_observation_id: string | null; rule_version_id: string | null;
  current_evidence_correction_version: number | null;
  prior_evidence_correction_version: number | null;
  acknowledgement_id: string | null; committed_at: string; replayed: boolean;
};

function failure(code?: string) {
  if (code === "42501") return databaseFailure("WEIGHT_NOT_AUTHORIZED", "目前角色、分支、個案範圍或工作階段不允許這項體重管理操作。", 403);
  if (code === "40001") return databaseFailure("WEIGHT_VERSION_CONFLICT", "量測更正鏈或警示證據已有新版本；請重新載入。", 409);
  if (code === "23505") return databaseFailure("WEIGHT_IDEMPOTENCY_CONFLICT", "相同冪等鍵曾用於不同內容，或該警示已確認。", 409);
  if (["23514", "23503"].includes(code ?? "")) return databaseFailure("INVALID_WEIGHT_STATE", "量測期間、終端版本、公斤值或警示證據未通過驗證。", 409);
  if (code === "22023") return databaseFailure("INVALID_WEIGHT_OPERATION", "輸入欄位或技術邊界未通過驗證。", 400);
  if (code === "22001" || code === "22003") return databaseFailure("INVALID_WEIGHT_OPERATION", "輸入超過技術欄位界線。", 400);
  return databaseFailure("WEIGHT_SAVE_FAILED", "操作尚未確認完成；請保留內容並使用相同冪等鍵重試。");
}

async function authorize(recent = false) {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式只讀取合成資料，不會寫入任何量測。", 403);
  if (!actor.scopes.includes("clients.read") || !actor.scopes.includes("quality_events.manage")) throw new IntegrationError("WEIGHT_NOT_AUTHORIZED", "目前角色沒有體重管理寫入權限。", 403);
  if (recent) await requireRecentAal2(actor);
  return actor;
}

function correlate(result: Omit<WeightOperationResult, "persisted" | "demo">, input: RecordWeightInput | WeightMutationInput) {
  if (result.operationKind !== input.action || result.clientId !== input.clientId ||
    (input.action === "record" && (result.correctionId !== null || result.correctionVersion !== null || result.priorObservationId !== null || result.ruleVersionId !== null || result.acknowledgementId !== null)) ||
    ((input.action === "correct" || input.action === "void") && (result.observationId !== input.observationId || result.correctionId === null || result.correctionVersion !== input.expectedCorrectionVersion + 1 || result.priorObservationId !== null || result.ruleVersionId !== null || result.acknowledgementId !== null)) ||
    (input.action === "acknowledge" && (result.observationId !== input.currentObservationId || result.priorObservationId !== input.priorObservationId || result.ruleVersionId !== input.ruleVersionId || result.currentEvidenceCorrectionVersion !== input.currentCorrectionVersion || result.priorEvidenceCorrectionVersion !== input.priorCorrectionVersion || result.acknowledgementId === null || result.correctionId !== null || result.correctionVersion !== null))) {
    throw new IntegrationError("WEIGHT_RECEIPT_INVALID", "資料庫完成憑證與本次請求不一致；畫面不會視為成功。", 502);
  }
  return result;
}

async function execute(input: RecordWeightInput | WeightMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式體重管理服務尚未設定。", 503);
  let response: { data: OperationRow | null; error: { code?: string } | null };
  if (input.action === "record") {
    response = await supabase.rpc("record_weight_observation", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId, p_observed_at: input.observedAt,
      p_weight_kg: input.weightKg, p_source: input.source,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  } else if (input.action === "correct" || input.action === "void") {
    response = await supabase.rpc("correct_weight_observation", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId, p_observation_id: input.observationId,
      p_expected_correction_version: input.expectedCorrectionVersion,
      p_correction_kind: input.action === "correct" ? "replace" : "void",
      p_replacement_weight_kg: input.replacementWeightKg,
      p_correction_reason: input.correctionReason, p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  } else {
    if (input.action !== "acknowledge") {
      throw new IntegrationError("INVALID_WEIGHT_OPERATION", "不支援的體重管理操作。", 400);
    }
    response = await supabase.rpc("acknowledge_weight_alert", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId, p_current_observation_id: input.currentObservationId,
      p_current_correction_version: input.currentCorrectionVersion,
      p_prior_observation_id: input.priorObservationId,
      p_prior_correction_version: input.priorCorrectionVersion,
      p_rule_version_id: input.ruleVersionId,
      p_acknowledgement_note: input.acknowledgementNote,
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle<OperationRow>();
  }
  if (response.error || !response.data) throw failure(response.error?.code);
  return correlate(parseWeightOperationResult(response.data), input);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize();
    const input = parseRecordWeight(await readJsonObject(request, 8 * 1024), request.headers.get("idempotency-key"));
    const result = await execute(input, actor);
    return ok({ ...result, persisted: true as const, demo: false as const }, result.replayed ? 200 : 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會更正、作廢或確認資料。", 403);
    const body = await readJsonObject(request, 8 * 1024);
    if (!actor.scopes.includes("clients.read") || !actor.scopes.includes("quality_events.manage")) throw new IntegrationError("WEIGHT_NOT_AUTHORIZED", "目前角色沒有體重管理寫入權限。", 403);
    await requireRecentAal2(actor);
    const input = parseWeightMutation(body, request.headers.get("idempotency-key"));
    const result = await execute(input, actor);
    return ok({ ...result, persisted: true as const, demo: false as const }, 200, requestId);
  });
}
