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
  readonly manifest: ReturnType<typeof buildQuestionnaireRuleManifest>;
}

export function buildQuestionnaireRuleManifest(formKey: QuestionnaireFormKey) {
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
