import { z } from "zod";

import { ok } from "@/lib/api/response";
import { getQuestionnaireForm } from "@/lib/questionnaire-assessments/forms";
import type { QuestionnaireAnswer, QuestionnaireFormKey } from "@/lib/questionnaire-assessments/types";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

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
  if (["22023", "22003", "23514", "23502"].includes(errorCode ?? "")) return databaseFailure(
    "QUESTIONNAIRE_INVALID", "表單版本、日期或答案不符合欄位規則。", 400,
  );
  return databaseFailure(
    "QUESTIONNAIRE_SAVE_FAILED", "評估草稿是否保存尚未確認；請保留內容並以相同操作識別碼重試。",
  );
}

function parseAnswers(formKey: QuestionnaireFormKey, value: unknown) {
  const form = getQuestionnaireForm(formKey);
  if (!form || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const questionIds = form.questions.map((question) => question.id);
  if (Object.keys(source).length !== questionIds.length || questionIds.some((key) => !(key in source))) return null;
  const answers: Record<string, QuestionnaireAnswer> = {};
  for (const question of form.questions) {
    const raw = source[question.id];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const answer = raw as Record<string, unknown>;
    if (answer.state === "missing" && Object.keys(answer).length === 1) {
      answers[question.id] = { state: "missing" };
      continue;
    }
    if (answer.state === "not_applicable" &&
      (formKey === "barthel_adl" || formKey === "lawton_iadl") &&
      typeof answer.reason === "string" && answer.reason.trim().length > 0 &&
      Object.keys(answer).sort().join(",") === "reason,state") {
      answers[question.id] = { state: "not_applicable", reason: answer.reason.trim() };
      continue;
    }
    if (answer.state !== "answered" || typeof answer.value !== "string" ||
      Object.keys(answer).sort().join(",") !== "state,value" ||
      !question.choices.some((choice) => choice.value === answer.value)) return null;
    answers[question.id] = { state: "answered", value: answer.value };
  }
  return answers;
}

function parseContext(formKey: QuestionnaireFormKey, value: unknown, answers: Record<string, QuestionnaireAnswer>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const form = getQuestionnaireForm(formKey);
  const allowed = new Set([
    ...(form?.measurementFields ?? []).map(({ key }) => key),
    ...(form?.contextFields ?? []).map(({ key }) => key),
    ...(form?.allowQualitativeNotes ? ["qualitative_note"] : []),
  ]);
  const contextFields = new Map((form?.contextFields ?? []).map((field) => [field.key, field]));
  if (Object.keys(raw).some((key) => !allowed.has(key))) return null;
  const context: Record<string, string> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry !== "string") return null;
    if (key === "qualitative_note") {
      if (entry.length > 3000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(entry)) return null;
      if (entry.trim()) context[key] = entry.trim();
      continue;
    }
    const contextField = contextFields.get(key);
    if (contextField) {
      if (entry && !contextField.choices.some((choice) => choice.value === entry)) return null;
      if (entry) context[key] = entry;
      continue;
    }
    if (!/^\d{1,3}(?:\.\d)?$/u.test(entry)) return null;
    const numeric = Number(entry);
    const [minimum, maximum] = key === "height_cm" ? [50, 240]
      : key === "weight_kg" ? [20, 300] : [10, 80];
    if (numeric < minimum || numeric > maximum) return null;
    context[key] = entry;
  }
  if (formKey !== "mna_sf") return context;
  const anthropometry = answers.anthropometry;
  if (anthropometry?.state !== "answered") return context;
  const valueId = anthropometry.value;
  if (valueId.startsWith("bmi_")) {
    if (!context.height_cm || !context.weight_kg || context.calf_circumference_cm) return null;
    const bmi = Number(context.weight_kg) / ((Number(context.height_cm) / 100) ** 2);
    if (valueId === "bmi_lt_19" && bmi >= 19) return null;
    if (valueId === "bmi_19_lt_21" && (bmi < 19 || bmi >= 21)) return null;
    if (valueId === "bmi_21_lt_23" && (bmi < 21 || bmi >= 23)) return null;
    if (valueId === "bmi_gte_23" && bmi < 23) return null;
  } else {
    if (!context.calf_circumference_cm || context.height_cm || context.weight_kg) return null;
    const calf = Number(context.calf_circumference_cm);
    if (valueId === "calf_lt_31" && calf >= 31) return null;
    if (valueId === "calf_gte_31" && calf < 31) return null;
  }
  return context;
}

function readMutation(value: Record<string, unknown>, idempotencyKey: string) {
  const base = z.object({
    action: z.enum(["create", "revise"]),
    clientId: uuid,
    formKey: z.enum(["spmsq", "gds_15", "barthel_adl", "lawton_iadl", "eat10_swallowing", "bsrs5", "fall_risk_taipei_115", "nsi_determine", "mna_sf"]),
    formVersion: z.string().min(1).max(80),
    assessedOn: date,
    answers: z.unknown(),
    context: z.record(z.string(), z.string()).default({}),
  });
  const createSchema = base.extend({ action: z.literal("create") }).strict();
  const reviseSchema = base.extend({
    action: z.literal("revise"),
    assessmentKey: uuid,
    previousVersionId: uuid,
    expectedVersion: z.number().int().min(1).max(1_000_000),
  }).strict();
  const parsed = value.action === "create"
    ? createSchema.safeParse(value)
    : reviseSchema.safeParse(value);
  if (!parsed.success) return null;
  const form = getQuestionnaireForm(parsed.data.formKey);
  const answers = parseAnswers(parsed.data.formKey, parsed.data.answers);
  const context = answers ? parseContext(parsed.data.formKey, parsed.data.context, answers) : null;
  if (!form || !answers || !context || parsed.data.formVersion !== form.version) return null;
  return {
    action: parsed.data.action,
    client_id: parsed.data.clientId,
    form_key: parsed.data.formKey,
    form_version: parsed.data.formVersion,
    assessed_on: parsed.data.assessedOn,
    answers,
    context,
    ...(parsed.data.action === "revise" ? {
      assessment_key: parsed.data.assessmentKey,
      previous_version_id: parsed.data.previousVersionId,
      expected_version: parsed.data.expectedVersion,
    } : {}),
    idempotencyKey,
  };
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
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY", "展示模式不會保存真實個案評估。", 403,
  );
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
    const clientId = parameters.get("client_id");
    if (!formKey || !getQuestionnaireForm(formKey) ||
      (clientId !== null && !uuid.safeParse(clientId).success) ||
      [...parameters.keys()].some((key) => !["form_key", "client_id"].includes(key))) {
      throw new IntegrationError("QUESTIONNAIRE_INVALID", "表單或個案篩選條件無效。", 400);
    }
    const actor = await authorize(formKey, "read");
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式資料服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("questionnaire_assessment_snapshot", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_form_key: formKey,
      p_client_id: clientId,
    });
    if (error || !data) throw databaseError(error?.code);
    return ok(data, 200, requestId);
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
    const input = readMutation(raw, operationId.data);
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
    return ok(data, 201, requestId);
  });
}
