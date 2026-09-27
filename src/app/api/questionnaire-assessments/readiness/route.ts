import { z } from "zod";

import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute } from "@/lib/integrations/http";
import { questionnaireFormKeySchema } from "@/lib/questionnaire-assessments/contract";
import { buildQuestionnaireReadinessReport } from "@/lib/questionnaire-assessments/readiness-source";
import type { QuestionnaireFormKey } from "@/lib/questionnaire-assessments/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const querySchema = z.object({
  form_key: questionnaireFormKeySchema,
  client_id: uuid,
  version_id: uuid,
  content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  read_nonce: uuid,
}).strict();

function readPermission(form: QuestionnaireFormKey) {
  const prefix = form === "spmsq" ? "questionnaire_cognition"
    : form === "barthel_adl" || form === "lawton_iadl" ? "questionnaire_adl"
      : form === "eat10_swallowing" ? "questionnaire_swallowing"
        : form === "bsrs5" || form === "gds_15" ? "questionnaire_emotion"
          : form === "fall_risk_taipei_115" ? "questionnaire_fall"
            : "questionnaire_nutrition";
  return `${prefix}.read`;
}

function unavailable() {
  return databaseFailure("QUESTIONNAIRE_READINESS_UNAVAILABLE", "本次評估的完成條件暫時無法確認，請稍後重新檢查。", 503);
}

function databaseError(code?: string) {
  if (code === "42501") return databaseFailure("QUESTIONNAIRE_NOT_AUTHORIZED", "目前帳號或個案指派不允許查閱此評估。", 403);
  if (code === "40001") return databaseFailure("QUESTIONNAIRE_VERSION_CONFLICT", "評估版本已變更，請重新讀取後再檢查。", 409);
  if (code === "22023") return databaseFailure("QUESTIONNAIRE_READINESS_INVALID", "評估版本或檢查條件無效。", 400);
  return unavailable();
}

// This read evaluates one already-persisted, explicitly selected draft. It
// neither saves answers nor grants scoring/signing/correction authority.
export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const parameters = new URL(request.url).searchParams;
    const length = request.headers.get("content-length");
    if (request.method !== "GET" || request.body !== null ||
      (length !== null && length !== "0") || request.headers.has("transfer-encoding") ||
      [...parameters.keys()].some((key) => parameters.getAll(key).length !== 1)) {
      throw new IntegrationError("QUESTIONNAIRE_READINESS_INVALID", "請使用不含內容的單次評估檢查。", 400);
    }
    const query = querySchema.safeParse(Object.fromEntries(parameters));
    if (!query.success) throw new IntegrationError("QUESTIONNAIRE_READINESS_INVALID", "表單、版本或檢查條件無效。", 400);

    const actor = await getTenantContext("staff");
    if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先以已核准的帳號登入。", 401);
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會檢查正式個案評估。", 403);
    if (!actor.branchId) throw new IntegrationError("BRANCH_CONTEXT_REQUIRED", "請先選擇服務分點。", 409);
    if (!actor.scopes.includes("clients.read") || !actor.scopes.includes(readPermission(query.data.form_key))) {
      throw new IntegrationError("QUESTIONNAIRE_NOT_AUTHORIZED", "目前帳號沒有此評估表單的查閱權限。", 403);
    }

    let source: unknown;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const supabase = await createServerSupabaseClient();
      if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式資料服務尚未設定。", 503);
      const controller = new AbortController();
      const deadline = new Promise<never>((_, reject) => {
        deadlineTimer = setTimeout(() => {
          // Settle independently of cooperative SDK cancellation. The SDK
          // promise includes response decoding and may never honor abort.
          reject(unavailable());
          controller.abort();
        }, 20_000);
      });
      const reading = supabase.rpc("questionnaire_assessment_readiness_source", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_form_key: query.data.form_key,
        p_client_id: query.data.client_id,
        p_version_id: query.data.version_id,
        p_expected_content_hash: query.data.content_hash,
        p_read_nonce: query.data.read_nonce,
      }).abortSignal(controller.signal);
      const { data, error } = await Promise.race([reading, deadline]);
      if (error || data === null || data === undefined) throw databaseError(error?.code);
      source = data;
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw unavailable();
    } finally { if (deadlineTimer !== undefined) clearTimeout(deadlineTimer); }

    try {
      const report = buildQuestionnaireReadinessReport(source, {
        organizationId: actor.organizationId,
        branchId: actor.branchId,
        actorUserId: actor.userId,
        formKey: query.data.form_key,
        clientId: query.data.client_id,
        versionId: query.data.version_id,
        contentHash: query.data.content_hash,
        readNonce: query.data.read_nonce,
      });
      return ok(report, 200, requestId);
    } catch { throw unavailable(); }
  });
}
