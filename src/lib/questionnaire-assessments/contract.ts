import { z } from "zod";

import type { QuestionnaireAssessmentDatePage, QuestionnaireAssessmentPage, QuestionnaireFormKey, QuestionnaireHistoryPage, QuestionnaireSnapshot } from "./types";
import { questionnaireAssessedDateSchema } from "./assessed-date";

export const questionnaireFormKeySchema = z.enum(["spmsq", "gds_15", "barthel_adl", "lawton_iadl", "eat10_swallowing", "bsrs5", "fall_risk_taipei_115", "nsi_determine", "mna_sf"]);
const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const answerSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("answered"), value: z.string() }).strict(),
  z.object({ state: z.literal("missing") }).strict(),
  z.object({ state: z.literal("not_applicable"), reason: z.string() }).strict(),
]);
export const questionnaireDraftSchema = z.object({
  assessmentKey: uuid, versionId: uuid, version: z.number().int().positive(),
  formVersion: z.string(), assessedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  answers: z.record(z.string(), answerSchema), context: z.record(z.string(), z.string()),
  recordState: z.literal("draft"), authorDisplayName: z.string(), createdAt: instant,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
const assessmentSchema = questionnaireDraftSchema.extend({ assessmentCreatedAt: instant });
const cursorSchema = z.object({ createdAt: instant, assessmentKey: uuid }).strict();
export const questionnaireReceiptSchema = z.object({
  action: z.enum(["create", "revise"]), clientId: uuid, formKey: questionnaireFormKeySchema,
  assessmentKey: uuid, versionId: uuid, version: z.number().int().positive(),
  recordState: z.literal("draft"), assessedOn: z.string(), contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  committedAt: instant, replayed: z.boolean(),
}).strict();
const assessmentPageSchema = z.object({
  formKey: questionnaireFormKeySchema, clientId: uuid,
  assessments: z.array(assessmentSchema).max(20), total: z.number().int().nonnegative(),
  nextCursor: cursorSchema.nullable(),
}).strict();
const dateMatchSchema = z.object({
  assessmentKey: uuid, versionId: uuid, version: z.number().int().positive().max(1_000_001),
  assessedOn: questionnaireAssessedDateSchema, savedAt: instant, recordState: z.literal("draft"), assessmentCreatedAt: instant,
}).strict();
const assessmentDatePageSchema = z.object({
  formKey: questionnaireFormKeySchema, clientId: uuid, assessedOn: questionnaireAssessedDateSchema,
  assessments: z.array(dateMatchSchema).max(20), total: z.number().int().nonnegative(),
  nextCursor: cursorSchema.nullable(),
}).strict();
const historyPageSchema = z.object({
  formKey: questionnaireFormKeySchema, clientId: uuid, assessmentKey: uuid,
  versions: z.array(questionnaireDraftSchema).max(20), total: z.number().int().positive(),
  nextBeforeVersion: z.number().int().positive().nullable(),
}).strict();
const snapshotSchema = z.object({
  formKey: questionnaireFormKeySchema, generatedAt: instant,
  matchingTotal: z.number().int().nonnegative(),
  clients: z.array(z.object({
    clientId: uuid, displayName: z.string(), serviceStatus: z.enum(["active", "suspended"]),
    latest: questionnaireDraftSchema.nullable(),
    assessments: z.array(assessmentSchema).max(20), assessmentTotal: z.number().int().nonnegative(),
    nextAssessmentCursor: cursorSchema.nullable(),
  }).strict()),
}).strict();

export function parseQuestionnaireSnapshot(value: unknown, formKey: QuestionnaireFormKey, clientId: string | null = null): QuestionnaireSnapshot {
  const parsed = snapshotSchema.parse(value);
  if (parsed.formKey !== formKey || (clientId && parsed.clients.some((client) => client.clientId !== clientId)) ||
    new Set(parsed.clients.map((client) => client.clientId)).size !== parsed.clients.length ||
    parsed.clients.some((client) => client.assessmentTotal < client.assessments.length)) throw new Error("Invalid questionnaire snapshot scope");
  return parsed;
}

export function parseQuestionnaireAssessmentPage(value: unknown, formKey: QuestionnaireFormKey, clientId: string): QuestionnaireAssessmentPage {
  const parsed = assessmentPageSchema.parse(value);
  const last = parsed.assessments.at(-1);
  if (parsed.formKey !== formKey || parsed.clientId !== clientId || parsed.total < parsed.assessments.length ||
    new Set(parsed.assessments.map((item) => item.assessmentKey)).size !== parsed.assessments.length ||
    (parsed.nextCursor && (!last || parsed.nextCursor.assessmentKey !== last.assessmentKey || parsed.nextCursor.createdAt !== last.assessmentCreatedAt))) throw new Error("Invalid questionnaire assessment page scope");
  return parsed;
}

export function parseQuestionnaireAssessmentDatePage(value: unknown, formKey: QuestionnaireFormKey, clientId: string,
  assessedOn: string): QuestionnaireAssessmentDatePage {
  const parsed = assessmentDatePageSchema.parse(value);
  const last = parsed.assessments.at(-1);
  if (parsed.formKey !== formKey || parsed.clientId !== clientId || parsed.assessedOn !== assessedOn ||
    parsed.total < parsed.assessments.length || parsed.assessments.some((item) => item.assessedOn !== assessedOn ||
      Date.parse(item.savedAt) < Date.parse(item.assessmentCreatedAt)) ||
    new Set(parsed.assessments.map((item) => item.assessmentKey)).size !== parsed.assessments.length ||
    (parsed.nextCursor && (!last || parsed.nextCursor.assessmentKey !== last.assessmentKey ||
      parsed.nextCursor.createdAt !== last.assessmentCreatedAt || parsed.assessments.length !== 20))) {
    throw new Error("Invalid questionnaire date lookup scope or cursor");
  }
  return parsed;
}

export function parseQuestionnaireHistoryPage(value: unknown, formKey: QuestionnaireFormKey, clientId: string, assessmentKey: string): QuestionnaireHistoryPage {
  const parsed = historyPageSchema.parse(value);
  if (parsed.formKey !== formKey || parsed.clientId !== clientId || parsed.assessmentKey !== assessmentKey ||
    parsed.versions.some((item, index) => item.assessmentKey !== assessmentKey || (index > 0 && item.version >= parsed.versions[index - 1]!.version)) ||
    new Set(parsed.versions.map((item) => item.versionId)).size !== parsed.versions.length ||
    parsed.total < parsed.versions.length ||
    (parsed.nextBeforeVersion !== null && parsed.nextBeforeVersion !== parsed.versions.at(-1)?.version)) throw new Error("Invalid questionnaire version page scope");
  return parsed;
}
