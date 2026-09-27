import { z } from "zod";

import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { getQuestionnaireForm } from "@/lib/questionnaire-assessments/forms";
import { parseQuestionnaireAssessmentPage, parseQuestionnaireHistoryPage, parseQuestionnaireSnapshot, questionnaireReceiptSchema } from "@/lib/questionnaire-assessments/contract";
import { parseQuestionnaireMutation } from "@/lib/questionnaire-assessments/mutation-contract";
import type { QuestionnaireFormKey } from "@/lib/questionnaire-assessments/types";
import {
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PostgreSQL emits canonical lowercase UUIDs. Normalize validated request IDs
// before hashing, RPC calls and receipt correlation, including retry keys.
const uuid = z.string().uuid().transform((value) => value.toLowerCase());

function databaseError(errorCode?: string) {
  if (errorCode === "42501") return databaseFailure(
    "QUESTIONNAIRE_NOT_AUTHORIZED", "目前的角色、個案指派或資料範圍不允許這項評估操作。", 403,
  );
  if (errorCode === "40001") return databaseFailure(
    "QUESTIONNAIRE_VERSION_CONFLICT", "這份草稿已有新版本，請重新載入後再修訂。", 409,
  );
  if (errorCode === "23505") return databaseFailure(
    "QUESTIONNAIRE_IDEMPOTENCY_CONFLICT", "操作識別碼已用於其他內容，請重新載入並重試。", 409,
  );
  if (["22023", "22003", "22007", "22008", "23514", "23502"].includes(errorCode ?? "")) return databaseFailure(
    "QUESTIONNAIRE_INVALID", "表單版本、日期或答案不符合欄位規則。", 400,
  );
  return databaseFailure(
    "QUESTIONNAIRE_SAVE_FAILED", "評估草稿是否保存尚未確認；請保留內容並以相同操作識別碼重試。",
  );
}

function permissionScope(formKey: QuestionnaireFormKey, permission: "read" | "manage") {
  const prefix = formKey === "spmsq"
    ? "questionnaire_cognition"
    : formKey === "barthel_adl" || formKey === "lawton_iadl"
      ? "questionnaire_adl"
      : formKey === "eat10_swallowing"
        ? "questionnaire_swallowing"
        : formKey === "bsrs5" || formKey === "gds_15"
          ? "questionnaire_emotion"
          : formKey === "fall_risk_taipei_115"
            ? "questionnaire_fall"
            : "questionnaire_nutrition";
  return `${prefix}.${permission}`;
}

async function authorize(formKey: QuestionnaireFormKey, permission: "read" | "manage") {
  // These endpoints only read or append unsigned drafts. Signing policies remain separate.
  const actor = await getTenantContext("staff");
  if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先以已核准的帳號登入。", 401);
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY", "展示模式不會保存真實個案評估。", 403,
  );
  if (!actor.branchId) throw new IntegrationError("BRANCH_CONTEXT_REQUIRED", "請先選擇服務分點。", 409);
  if (!actor.scopes.includes("clients.read") ||
    !actor.scopes.includes(permissionScope(formKey, "read")) ||
    (permission === "manage" && !actor.scopes.includes(permissionScope(formKey, "manage")))) {
    throw new IntegrationError(
      "QUESTIONNAIRE_NOT_AUTHORIZED", "目前帳號沒有此評估表單的權限。", 403,
    );
  }
  return actor;
}

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const parameters = new URL(request.url).searchParams;
    const formKey = parameters.get("form_key") as QuestionnaireFormKey | null;
    const clientId = parameters.get("client_id")?.toLowerCase() ?? null;
    const mode = parameters.get("mode") ?? "snapshot";
    const assessmentKey = parameters.get("assessment_key")?.toLowerCase() ?? null;
    const beforeVersion = parameters.get("before_version");
    const beforeCreatedAt = parameters.get("before_created_at");
    const beforeAssessmentKey = parameters.get("before_assessment_key")?.toLowerCase() ?? null;
    const allowed = ["form_key", "client_id", "mode", "assessment_key", "before_version", "before_created_at", "before_assessment_key"];
    if (!formKey || !getQuestionnaireForm(formKey) ||
      (clientId !== null && !uuid.safeParse(clientId).success) ||
      [...parameters.keys()].some((key) => !allowed.includes(key) || parameters.getAll(key).length !== 1) ||
      !["snapshot", "assessments", "versions"].includes(mode) ||
      (mode !== "snapshot" && !clientId) ||
      (mode === "snapshot" && [assessmentKey, beforeVersion, beforeCreatedAt, beforeAssessmentKey].some((value) => value !== null)) ||
      (mode === "versions" && (!uuid.safeParse(assessmentKey).success || beforeCreatedAt !== null || beforeAssessmentKey !== null ||
        (beforeVersion !== null && (!/^[1-9]\d{0,6}$/u.test(beforeVersion) || Number(beforeVersion) > 1000001)))) ||
      (mode === "assessments" && (assessmentKey !== null || beforeVersion !== null ||
        (beforeCreatedAt === null) !== (beforeAssessmentKey === null) ||
        (beforeCreatedAt !== null && (!z.string().datetime({ offset: true }).safeParse(beforeCreatedAt).success || !uuid.safeParse(beforeAssessmentKey).success))))) {
      throw new IntegrationError("QUESTIONNAIRE_INVALID", "表單或個案篩選條件無效。", 400);
    }
    const actor = await authorize(formKey, "read");
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式資料服務尚未設定。", 503);
    const rpc = mode === "versions" ? "questionnaire_assessment_history" : mode === "assessments" ? "questionnaire_assessment_list" : "questionnaire_assessment_snapshot";
    const { data, error } = await supabase.rpc(rpc, {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_form_key: formKey,
      p_client_id: clientId,
      ...(mode === "versions" ? { p_assessment_key: assessmentKey, p_before_version: beforeVersion ? Number(beforeVersion) : null } : {}),
      ...(mode === "assessments" ? { p_before_created_at: beforeCreatedAt, p_before_assessment_key: beforeAssessmentKey } : {}),
    });
    if (error || !data) throw databaseError(error?.code);
    try {
      const validated = mode === "versions" ? parseQuestionnaireHistoryPage(data, formKey, clientId!, assessmentKey!)
        : mode === "assessments" ? parseQuestionnaireAssessmentPage(data, formKey, clientId!)
          : parseQuestionnaireSnapshot(data, formKey, clientId);
      return ok(validated, 200, requestId);
    } catch { throw databaseFailure("QUESTIONNAIRE_SNAPSHOT_INVALID", "評估清單或版本尚未完整確認，請重新載入。", 503); }
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const formKey = new URL(request.url).searchParams.get("form_key") as QuestionnaireFormKey | null;
    if (!formKey || !getQuestionnaireForm(formKey)) throw new IntegrationError(
      "QUESTIONNAIRE_INVALID", "缺少有效的表單識別碼。", 400,
    );
    const actor = await authorize(formKey, "manage");
    const raw = await readJsonObject(request, 64 * 1024);
    const operationId = uuid.safeParse(request.headers.get("idempotency-key"));
    if (!operationId.success) throw new IntegrationError(
      "QUESTIONNAIRE_INVALID", "缺少有效的操作識別碼。", 400,
    );
    const input = parseQuestionnaireMutation(raw, operationId.data);
    if (!input || input.form_key !== formKey) throw new IntegrationError(
      "QUESTIONNAIRE_INVALID", "表單答案或修訂版本資料無效。", 400,
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式資料服務尚未設定。", 503);
    const { idempotencyKey, ...payload } = input;
    const { data, error } = await supabase.rpc("mutate_questionnaire_assessment", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_payload: payload,
      p_idempotency_key: idempotencyKey,
    });
    if (error || !data) throw databaseError(error?.code);
    const receipt = questionnaireReceiptSchema.safeParse(data);
    if (!receipt.success || receipt.data.action !== input.action || receipt.data.clientId !== input.client_id ||
      receipt.data.formKey !== input.form_key || receipt.data.assessedOn !== input.assessed_on ||
      receipt.data.version !== (input.expected_version ?? 0) + 1 ||
      ("assessment_key" in input && receipt.data.assessmentKey !== input.assessment_key)) {
      throw databaseFailure("QUESTIONNAIRE_RECEIPT_INVALID", "草稿保存回應尚未完整確認；請保留內容並以相同操作識別碼重試。", 503);
    }
    return ok(receipt.data, 201, requestId);
  });
}
