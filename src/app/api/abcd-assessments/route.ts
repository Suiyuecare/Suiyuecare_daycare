import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute,
  readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { ABCD_ASSESSMENT_MUTATION_MAX_BYTES, abcdAssessmentPayload,
  parseAbcdAssessmentMutation, parseAbcdAssessmentReceipt } from "@/lib/abcd-assessments/parser";
import type { AbcdAssessmentMutationInput } from "@/lib/abcd-assessments/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApiRequestId = ReturnType<typeof import("node:crypto").randomUUID>;
type Operation = "create" | "revise" | "sign" | "correct";

function declaredOperation(request: Request): Operation {
  const value = request.headers.get("x-abcd-assessment-operation");
  if (!value || !["create", "revise", "sign", "correct"].includes(value)) {
    throw new IntegrationError("INVALID_ABCD_ASSESSMENT_OPERATION",
      "缺少或不支援的 ABCD 人工候選評估受治理操作標頭。", 400,
      "x-abcd-assessment-operation");
  }
  return value as Operation;
}

function matches(operation: Operation, input: AbcdAssessmentMutationInput) {
  return (operation === "create" && input.action === "save_assessment" && input.mode === "create") ||
    (operation === "revise" && input.action === "save_assessment" && input.mode === "revise") ||
    (operation === "sign" && input.action === "sign_assessment") ||
    (operation === "correct" && input.action === "correct_assessment");
}

async function authorize(operation: Operation): Promise<TenantContext> {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
    "展示模式僅顯示合成 ABCD 候選紀錄，不會寫入正式資料。", 403);
  const required = ["clients.read", "abcd_assessments.read", "abcd_assessments.manage"];
  if (required.some((scope) => !actor.scopes.includes(scope))) throw new IntegrationError(
    "ABCD_ASSESSMENT_NOT_AUTHORIZED", "目前角色沒有完整的 ABCD 候選評估操作權限。", 403);
  if (["sign", "correct"].includes(operation)) await requireRecentAal2(actor);
  return actor;
}

function failure(code?: string) {
  if (code === "42501") return databaseFailure("ABCD_ASSESSMENT_NOT_AUTHORIZED",
    "目前角色、分支、個案指派或工作階段不允許這項 ABCD 候選評估操作。", 403);
  if (code === "40001") return databaseFailure("ABCD_ASSESSMENT_VERSION_CONFLICT",
    "評估版本、A／B／C／D 類型、年度或內容雜湊已改變；請重新載入。", 409);
  if (code === "23505") return databaseFailure("ABCD_ASSESSMENT_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同內容，或相同個案／年度／類型已有另一版本鏈。", 409);
  if (["23514", "23503", "55000"].includes(code ?? "")) return databaseFailure(
    "ABCD_ASSESSMENT_STATE_CONFLICT", "評估狀態、線性版本鏈或人工三態不允許這項操作。", 409);
  if (["22023", "22P02", "22007", "22008"].includes(code ?? "")) return databaseFailure(
    "INVALID_ABCD_ASSESSMENT_OPERATION", "人工摘要、結果、複評日期、類型或年度未通過驗證。", 400);
  return databaseFailure("ABCD_ASSESSMENT_RESULT_UNCERTAIN",
    "ABCD 候選評估結果尚未確認；請保留內容並使用相同操作鍵重試。", 409);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId: ApiRequestId) => {
    const operation = declaredOperation(request);
    const actor = await authorize(operation);
    const input = parseAbcdAssessmentMutation(
      await readJsonObject(request, ABCD_ASSESSMENT_MUTATION_MAX_BYTES),
      request.headers.get("idempotency-key"));
    if (!matches(operation, input)) throw new IntegrationError("INVALID_ABCD_ASSESSMENT_OPERATION",
      "受治理操作標頭與 ABCD 候選評估內容不一致。", 400);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式 ABCD 候選評估服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("mutate_abcd_assessment", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
      p_action: input.action, p_payload: abcdAssessmentPayload(input),
      p_idempotency_key: input.idempotencyKey,
    }).maybeSingle();
    if (error || !data) throw failure(error?.code);
    const result = parseAbcdAssessmentReceipt(data, input, actor.organizationId, actor.branchId);
    return ok(result, result.replayed ? 200 : 201, requestId);
  });
}
