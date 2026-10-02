import { z } from "zod";

import { getQuestionnaireForm } from "./forms";
import { questionnaireAssessedDateSchema } from "./assessed-date";
import { mnaMeasurementIssue } from "./preview";
import type { QuestionnaireAnswer, QuestionnaireFormKey } from "./types";

// Mechanical extraction of the existing unsigned POST preprocessing. This is
// not the database-wire validation candidate and does not authorize a write.
const uuid = z.string().uuid().transform((value) => value.toLowerCase());

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
  if (formKey === "mna_sf" && mnaMeasurementIssue(answers, context)) return null;
  return context;
}

/** Normalize one original camel-case wire request without mutating it. The
 * caller still validates/authenticates the header key, size and tenant scope. */
export function parseQuestionnaireMutation(value: unknown, idempotencyKey: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const base = z.object({
    action: z.enum(["create", "revise"]),
    clientId: uuid,
    formKey: z.enum(["spmsq", "gds_15", "barthel_adl", "lawton_iadl", "eat10_swallowing", "bsrs5", "fall_risk_taipei_115", "nsi_determine", "mna_sf"]),
    formVersion: z.string().min(1).max(80),
    assessedOn: questionnaireAssessedDateSchema,
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
  const parsed = source.action === "create"
    ? createSchema.safeParse(source)
    : reviseSchema.safeParse(source);
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

export type QuestionnaireMutationInput = NonNullable<ReturnType<typeof parseQuestionnaireMutation>>;
