import "server-only";

import { createHash } from "node:crypto";
import { getAssessmentDefinition } from "@/lib/assessments/definitions";
import { scoreAssessment } from "@/lib/assessments/engine";
import { ASSESSMENT_TEST_VECTORS } from "@/lib/assessments/test-vectors";
import type { AssessmentAnswers, AssessmentAlert, AssessmentClassification } from "@/lib/assessments/types";
import { getQuestionnaireForm } from "./forms";
import type { QuestionnaireFormKey } from "./types";

export interface QuestionnaireRuleCatalogEntry {
  readonly formKey: QuestionnaireFormKey;
  readonly formVersion: string;
  readonly ruleVersion: string;
  readonly catalogHash: string;
  readonly canonicalJson: string;
  readonly manifest: ReturnType<typeof buildManifest>;
}

/** JSON-only canonicalization; never serialize functions or runtime timestamps. */
export function canonicalRuleJson(value: unknown): string {
  function normalize(item: unknown): unknown {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.entries(item).filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, normalize(entry)]));
    }
    throw new Error("Rule catalog contains a non-JSON value.");
  }
  return JSON.stringify(normalize(value));
}

function buildManifest(formKey: QuestionnaireFormKey) {
  const form = getQuestionnaireForm(formKey);
  const definition = form?.scoreVersionId ? getAssessmentDefinition(form.scoreVersionId) : undefined;
  if (!form || !definition || definition.instrument !== (formKey === "eat10_swallowing" ? "eat10" : formKey)) {
    throw new Error("Questionnaire rule catalog identity is inconsistent.");
  }
  // Catalog registration freezes both prompts and executable scoring behavior.
  // It never clears reviewRequired, supplies an approval, or activates a rule.
  if (definition.activatedAt !== null || !definition.reviewRequired) throw new Error("Only unactivated candidates awaiting human review may enter the proposal catalog.");
  const questionIds = new Set(form.questions.map((question) => question.id));
  if (questionIds.size !== form.questions.length || questionIds.size !== definition.items.length) {
    throw new Error("Questionnaire and scoring item counts differ.");
  }
  for (const item of definition.items) {
    const question = form.questions.find(({ id }) => id === item.id);
    if (!question || new Set(question.choices.map(({ value }) => value)).size !== question.choices.length ||
      item.choices.length !== question.choices.length || item.choices.some((choice) => !question.choices.some(({ value }) => value === choice.value))) {
      throw new Error("Questionnaire and scoring choices differ.");
    }
  }
  let contexts: Record<string, string>[] = [{}];
  for (const field of definition.context) {
    contexts = contexts.flatMap((context) => field.choices.map((value) => ({ ...context, [field.id]: value })));
  }
  const scoreTable: { rawScore: number; context: Record<string, string>; adjustedScore: number; classification: AssessmentClassification; alerts: readonly AssessmentAlert[] }[] = [];
  for (const context of contexts) {
    for (let rawScore = definition.scoreMin; rawScore <= definition.scoreMax; rawScore += 1) {
      const adjustedScore = definition.adjustScore(rawScore, context);
      if (!Number.isInteger(adjustedScore) || adjustedScore < definition.scoreMin || adjustedScore > definition.scoreMax) {
        throw new Error("Rule adjustment is outside its declared scoring range.");
      }
      const classification = definition.classify(adjustedScore);
      scoreTable.push({ rawScore, context, adjustedScore, classification, alerts: definition.buildAlerts(adjustedScore, classification) });
    }
  }
  // Independent answer alerts must survive incomplete questionnaires. Capture
  // all registered choices, rather than infer safety from a summed score.
  const missing = Object.fromEntries(definition.items.map(({ id }) => [id, { state: "missing" as const }]));
  const answerAlertTable = definition.items.flatMap((item) => item.choices.map((choice) => {
    const answers: AssessmentAnswers = { ...missing, [item.id]: { state: "answered", value: choice.value } };
    const result = scoreAssessment({ versionId: definition.versionId, answers });
    return { questionId: item.id, value: choice.value, alerts: result.alerts.filter(({ code }) => !code.startsWith("RULE_")) };
  })).filter(({ alerts }) => alerts.length > 0);
  const testVectors = ASSESSMENT_TEST_VECTORS.filter(({ submission }) => submission.versionId === definition.versionId);
  for (const vector of testVectors) {
    const actual = scoreAssessment(vector.submission);
    if (actual.status !== vector.expected.status || (actual.score?.raw ?? null) !== vector.expected.rawScore ||
      (actual.score?.adjusted ?? null) !== vector.expected.adjustedScore || (actual.classification?.key ?? null) !== vector.expected.classificationKey) {
      throw new Error("Rule catalog golden vector does not reproduce its expected result.");
    }
  }
  return {
    schemaVersion: "questionnaire-rule-catalog.v1" as const,
    formKey: form.key, formVersion: form.version, ruleVersion: definition.versionId, ruleRevision: definition.ruleRevision,
    form,
    sourceSnapshot: [
      { kind: "questionnaire" as const, label: form.sourceLabel, url: form.sourceUrl ?? null },
      ...definition.sources.map(({ label, url }) => ({ kind: "scoring" as const, label, url })),
    ],
    rules: {
      items: definition.items, context: definition.context, scoreMin: definition.scoreMin, scoreMax: definition.scoreMax,
      scoreUnit: definition.scoreUnit, scoringPolicy: definition.scoringPolicy, disclaimer: definition.disclaimer,
      scoreTable, answerAlertTable,
    },
    testVectors,
  };
}

export function buildQuestionnaireRuleCatalogEntry(formKey: QuestionnaireFormKey): QuestionnaireRuleCatalogEntry {
  const manifest = buildManifest(formKey);
  const canonicalJson = canonicalRuleJson(manifest);
  // Parse into fresh plain data; caller changes cannot mutate the live registry.
  return { formKey, formVersion: manifest.formVersion, ruleVersion: manifest.ruleVersion,
    catalogHash: createHash("sha256").update(canonicalJson, "utf8").digest("hex"), canonicalJson,
    manifest: JSON.parse(canonicalJson) as typeof manifest };
}
