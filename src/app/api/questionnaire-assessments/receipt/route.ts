import { z } from "zod";
import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute } from "@/lib/integrations/http";
import { questionnaireFormKeySchema } from "@/lib/questionnaire-assessments/contract";
import { parseQuestionnaireOperationReceipt } from "@/lib/questionnaire-assessments/operation-receipt";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const headersSchema = z.object({ organizationId: uuid, branchId: uuid, clientId: uuid,
  formKey: questionnaireFormKeySchema, action: z.enum(["create", "revise"]), idempotencyKey: uuid, nonce: uuid }).strict();
function unavailable(): never {
  throw new IntegrationError("QUESTIONNAIRE_OPERATION_RECEIPT_UNAVAILABLE", "原操作結果尚未確認；請保留原內容並稍後再查。", 503);
}
function permission(form: z.infer<typeof questionnaireFormKeySchema>) {
  return `${form === "spmsq" ? "questionnaire_cognition" : form === "barthel_adl" || form === "lawton_iadl"
    ? "questionnaire_adl" : form === "eat10_swallowing" ? "questionnaire_swallowing" : form === "bsrs5" || form === "gds_15"
      ? "questionnaire_emotion" : form === "fall_risk_taipei_115" ? "questionnaire_fall" : "questionnaire_nutrition"}.read`;
}

/** One bodyless, read-only lookup. Auth, RPC and proof parsing share one hard
 * deadline; a provider ignoring cancellation cannot publish a late response. */
export async function GET(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const parsed = headersSchema.safeParse({ organizationId: request.headers.get("x-organization-id"),
      branchId: request.headers.get("x-branch-id"), clientId: request.headers.get("x-client-id"),
      formKey: request.headers.get("x-questionnaire-form-key"), action: request.headers.get("x-questionnaire-operation"),
      idempotencyKey: request.headers.get("idempotency-key"), nonce: request.headers.get("x-questionnaire-receipt-nonce") });
    const length = request.headers.get("content-length");
    if (!parsed.success || request.method !== "GET" || new URL(request.url).search || request.body !== null ||
      request.headers.has("x-idempotency-key") || request.headers.has("transfer-encoding") || length !== null && length !== "0") {
      throw new IntegrationError("INVALID_QUESTIONNAIRE_RECEIPT_REQUEST", "請提供有效的原操作查證識別。", 400);
    }
    let stopped = request.signal.aborted;
    const controller = new AbortController();
    const active = () => { if (stopped) unavailable(); };
    let rejectBounded!: () => void;
    const bounded = new Promise<never>((_, reject) => {
      rejectBounded = () => { stopped = true; controller.abort(); reject(new IntegrationError("QUESTIONNAIRE_OPERATION_RECEIPT_UNAVAILABLE", "原操作結果尚未確認；請保留原內容並稍後再查。", 503)); };
    });
    const timer = setTimeout(rejectBounded, 20_000);
    request.signal.addEventListener("abort", rejectBounded, { once: true });
    try {
      const work = (async () => {
        active();
        // Unsigned drafts use existing approved Google AAL1/AAL2 admission.
        // Do not call the default AAL2-only authorizeStaffRequest or new MFA.
        const actor = await getTenantContext("staff"); active();
        if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先以已核准的帳號登入。", 401);
        if (actor.demo || !actor.scopes.includes("clients.read") || !actor.scopes.includes(permission(parsed.data.formKey))) {
          throw new IntegrationError("QUESTIONNAIRE_NOT_AUTHORIZED", "目前授權無法查證原評估操作。", 403);
        }
        if (!actor.branchId) throw new IntegrationError("BRANCH_CONTEXT_REQUIRED", "請先選擇服務分點。", 409);
        if (parsed.data.organizationId !== actor.organizationId.toLowerCase() || parsed.data.branchId !== actor.branchId.toLowerCase()) {
          throw new IntegrationError("QUESTIONNAIRE_NOT_AUTHORIZED", "查證範圍與目前登入範圍不符。", 403);
        }
        const expected = { ...parsed.data, actorUserId: actor.userId.toLowerCase() };
        let result;
        try {
          const supabase = await createServerSupabaseClient(); active();
          if (!supabase) unavailable();
          result = await supabase.rpc("questionnaire_assessment_operation_receipt", {
            p_expected_organization_id: expected.organizationId, p_expected_branch_id: expected.branchId,
            p_form_key: expected.formKey, p_client_id: expected.clientId, p_action: expected.action,
            p_idempotency_key: expected.idempotencyKey, p_nonce: expected.nonce,
          }).abortSignal(controller.signal);
        } catch { unavailable(); }
        active();
        if (!result || typeof result !== "object" || !("data" in result) || !("error" in result)) unavailable();
        if (result.error) {
          if (result.error.code === "42501") throw new IntegrationError("QUESTIONNAIRE_NOT_AUTHORIZED", "目前授權無法查證原評估操作。", 403);
          if (result.error.code === "22023") throw new IntegrationError("INVALID_QUESTIONNAIRE_RECEIPT_REQUEST", "原操作查證識別未通過驗證。", 400);
          unavailable();
        }
        try { return ok(parseQuestionnaireOperationReceipt(result.data, expected), 200, requestId); }
        catch { unavailable(); }
      })();
      return await Promise.race([work, bounded]);
    } finally {
      stopped = true; clearTimeout(timer); request.signal.removeEventListener("abort", rejectBounded);
    }
  });
}
