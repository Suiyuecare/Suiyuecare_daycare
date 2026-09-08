import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { BODY_MUTATION_MAX_BYTES, parseBodyAssessmentMutation, parseBodyAssessmentReceipt } from "@/lib/body-assessments/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const operation = request.headers.get("x-body-assessment-operation");
    if (!operation || !["create", "revise", "sign", "correct"].includes(operation)) throw new IntegrationError(
      "INVALID_BODY_ASSESSMENT_OPERATION", "缺少身體評估操作標頭。", 400);
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式僅提供合成資料閱讀。", 403);
    const signing = operation === "sign" || operation === "correct";
    if (!["clients.read", "body_assessments.read", signing ? "body_assessments.sign" : "body_assessments.manage"]
      .every((s) => actor.scopes.includes(s))) throw new IntegrationError("BODY_ASSESSMENT_NOT_AUTHORIZED", "缺少完整身體評估操作權限。", 403);
    if (signing) await requireRecentAal2(actor);
    const input = parseBodyAssessmentMutation(await readJsonObject(request, BODY_MUTATION_MAX_BYTES), request.headers.get("idempotency-key"));
    if (input.payload.action !== operation) throw new IntegrationError("INVALID_BODY_ASSESSMENT_OPERATION", "操作標頭與內容不一致。", 400);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式身體評估服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("mutate_body_assessment", { p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId, p_payload: input.payload, p_idempotency_key: input.idempotencyKey }).maybeSingle();
    if (error || !data) {
      if (error?.code === "42501") throw databaseFailure("BODY_ASSESSMENT_NOT_AUTHORIZED", "目前角色、工作階段或個案指派不允許此操作。", 403);
      if (error?.code === "40001") throw databaseFailure("BODY_ASSESSMENT_VERSION_CONFLICT", "版本已更新，請重新載入後確認。", 409);
      if (error?.code === "23505") throw databaseFailure("BODY_ASSESSMENT_IDEMPOTENCY_CONFLICT", "相同操作鍵已用於不同內容。", 409);
      if (["23514", "22023", "22P02", "22007", "22008"].includes(error?.code ?? "")) throw databaseFailure(
        "INVALID_BODY_ASSESSMENT_OPERATION", "部位、狀態、理由或異常人工處置未通過驗證。", 400);
      throw databaseFailure("BODY_ASSESSMENT_RESULT_UNCERTAIN", "結果尚未確認，請保留相同操作鍵重試。", 409);
    }
    const result = parseBodyAssessmentReceipt(data, input, actor);
    return ok(result, result.replayed ? 200 : 201, requestId);
  });
}
