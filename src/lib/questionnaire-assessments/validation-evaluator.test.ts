import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { scoreAssessment } from "@/lib/assessments/engine";
import type { AssessmentAnswers } from "@/lib/assessments/types";
import { QUESTIONNAIRE_FORMS } from "./forms";
import { buildQuestionnaireRuleCatalogEntry, canonicalRuleJson } from "./rule-catalog";
import type { QuestionnaireFormKey } from "./types";
import { buildQuestionnaireValidationCatalogEntry } from "./validation-catalog";
import { evaluateQuestionnaireValidationCandidate } from "./validation-evaluator";

const keys = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];
const naForms = new Set<QuestionnaireFormKey>(["barthel_adl", "lawton_iadl", "fall_risk_taipei_115", "nsi_determine", "mna_sf"]);

function fixture(key: QuestionnaireFormKey) {
  const scoring = buildQuestionnaireRuleCatalogEntry(key);
  const validation = buildQuestionnaireValidationCatalogEntry(key);
  const answers: Record<string, unknown> = Object.fromEntries(scoring.manifest.rules.items.map((item) =>
    [item.id, { state: "answered", value: item.choices[0]!.value }]));
  const context: Record<string, unknown> = key === "spmsq" ? { education_adjustment: "middle_or_high_school" }
    : key === "mna_sf" ? { height_cm: "200", weight_kg: "70" } : {};
  return { scoring, validation, answers, context };
}

function evaluate(key: QuestionnaireFormKey, answers: unknown, context: unknown) {
  const { scoring, validation } = fixture(key);
  return evaluateQuestionnaireValidationCandidate(validation, scoring, answers, context);
}

function measurementContext(answers: AssessmentAnswers): Record<string, string> {
  const answer = answers.anthropometry;
  if (answer?.state !== "answered") throw new Error("Synthetic MNA fixture requires answered anthropometry.");
  if (answer.value === "calf_lt_31") return { calf_circumference_cm: "30.9" };
  if (answer.value === "calf_gte_31") return { calf_circumference_cm: "31" };
  return { height_cm: "200", weight_kg: answer.value === "bmi_lt_19" ? "70"
    : answer.value === "bmi_19_lt_21" ? "76" : answer.value === "bmi_21_lt_23" ? "84" : "92" };
}

describe("independent candidate validator state and storage boundaries", () => {
  it.each(keys)("binds %s complete scores to the original manifest without activation", (key) => {
    const { validation, scoring, answers, context } = fixture(key);
    const actual = evaluateQuestionnaireValidationCandidate(validation, scoring, answers, context);
    const scoringContext = key === "spmsq" ? context as Record<string, string> : {};
    const legacy = scoreAssessment({ versionId: scoring.ruleVersion, answers: answers as AssessmentAnswers, context: scoringContext });
    expect(actual).toMatchObject({ schemaVersion: "questionnaire-validation-result.v1", candidateOnly: true,
      validationCatalogHash: validation.validationCatalogHash, scoringCatalogHash: scoring.catalogHash,
      storageValid: true, status: "complete", issues: [], score: legacy.score, classification: legacy.classification });
    expect(actual.alerts.filter(({ code }) => !code.startsWith("RULE_")))
      .toEqual(legacy.alerts.filter(({ code }) => !code.startsWith("RULE_")));
  });

  it.each(keys)("reproduces every reachable %s score and all registered scoring contexts", (key) => {
    const { validation, scoring } = fixture(key); const rules = scoring.manifest.rules;
    let totals = new Map<number, AssessmentAnswers>([[0, {}]]);
    for (const item of rules.items) {
      const next = new Map<number, AssessmentAnswers>();
      for (const [total, answers] of totals) for (const choice of item.choices) {
        if (!next.has(total + choice.points)) next.set(total + choice.points, { ...answers, [item.id]: { state: "answered", value: choice.value } });
      }
      totals = next;
    }
    const contexts = rules.context.reduce<Record<string, string>[]>((values, field) =>
      values.flatMap((context) => field.choices.map((value) => ({ ...context, [field.id]: value }))), [{}]);
    expect(Math.min(...totals.keys())).toBe(rules.scoreMin); expect(Math.max(...totals.keys())).toBe(rules.scoreMax);
    for (const context of contexts) for (const answers of totals.values()) {
      const measured = key === "mna_sf" ? measurementContext(answers) : context;
      const variants = key === "bsrs5" ? ["0", "1", "2", "3", "4"].map((value) => ({ ...answers, bsrs_suicide: { state: "answered" as const, value } })) : [answers];
      for (const current of variants) {
        const actual = evaluateQuestionnaireValidationCandidate(validation, scoring, current, measured);
        const legacy = scoreAssessment({ versionId: scoring.ruleVersion, answers: current, context });
        expect(actual).toMatchObject({ storageValid: true, status: "complete", issues: [], score: legacy.score, classification: legacy.classification });
        expect(actual.alerts).toEqual(legacy.alerts.filter(({ code }) => !code.startsWith("RULE_")));
      }
    }
  });

  it.each(keys)("distinguishes absent, explicitly missing, N/A and malformed states for every %s item", (key) => {
    const { scoring, answers, context } = fixture(key);
    for (const item of scoring.manifest.rules.items) {
      const absent = { ...answers }; delete absent[item.id];
      const missing = evaluate(key, { ...answers, [item.id]: { state: "missing" } }, context);
      const omitted = evaluate(key, absent, context);
      expect(missing).toMatchObject({ status: "incomplete", storageValid: true, score: null, classification: null });
      expect(omitted).toMatchObject({ status: "incomplete", storageValid: false, score: null, classification: null });
      expect(missing.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_REQUIRED_ANSWER", blocksStorage: false, blocksCompletion: true })]));
      expect(omitted.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_REQUIRED_ANSWER", blocksStorage: true, blocksCompletion: true })]));
      const na = evaluate(key, { ...answers, [item.id]: { state: "not_applicable", reason: "合成不適用原因" } }, context);
      expect(na).toMatchObject({ status: naForms.has(key) ? "incomplete" : "invalid", storageValid: naForms.has(key), score: null, classification: null });
      expect(na.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "NOT_APPLICABLE_ANSWER", blocksStorage: !naForms.has(key), blocksCompletion: true })]));
      for (const malformed of [null, [], "answered", { state: "unknown" }, { state: "answered" }, { state: "answered", value: 0 },
        { state: "answered", value: "unregistered" }, { state: "missing", value: item.choices[0]!.value },
        { state: "answered", value: item.choices[0]!.value, reason: "extra" }]) {
        expect(evaluate(key, { ...answers, [item.id]: malformed }, context))
          .toMatchObject({ status: "invalid", storageValid: false, score: null, classification: null });
      }
    }
  });

  it.each(keys)("rejects unknown or malformed answers/context for %s without mutating input", (key) => {
    const { answers, context } = fixture(key);
    const original = structuredClone({ answers, context });
    for (const malformed of [null, [], true, 1, "answers"]) {
      expect(evaluate(key, malformed, context)).toMatchObject({ status: "invalid", storageValid: false, score: null });
      expect(evaluate(key, answers, malformed)).toMatchObject({ status: "invalid", storageValid: false, score: null });
    }
    expect(evaluate(key, { ...answers, synthetic_unknown: { state: "missing" } }, context))
      .toMatchObject({ status: "invalid", storageValid: false, score: null });
    expect(evaluate(key, answers, { ...context, synthetic_unknown: "value" }))
      .toMatchObject({ status: "invalid", storageValid: false, score: null });
    expect(evaluate(key, answers, { ...context, qualitative_note: 1 }))
      .toMatchObject({ status: "invalid", storageValid: false, score: null });
    expect({ answers, context }).toEqual(original);
    expect(evaluate(key, answers, { ...context, qualitative_note: "人工補充，不參與計分" }))
      .toMatchObject({ status: "complete", storageValid: true });
  });

  it("keeps absent SPMSQ education storage-valid but incomplete, rejecting empty and unknown enums", () => {
    const { answers } = fixture("spmsq");
    expect(evaluate("spmsq", answers, {})).toMatchObject({ status: "incomplete", storageValid: true, score: null });
    for (const value of ["", "unknown", null, false, 1]) {
      expect(evaluate("spmsq", answers, { education_adjustment: value }))
        .toMatchObject({ status: "invalid", storageValid: false, score: null });
    }
    for (const value of ["grade_school_or_less", "middle_or_high_school", "beyond_high_school"]) {
      expect(evaluate("spmsq", answers, { education_adjustment: value })).toMatchObject({ status: "complete", storageValid: true });
    }
  });

  it("preserves independent BSRS alerts on missing, invalid and unknown data without fabricating a total", () => {
    const { answers } = fixture("bsrs5");
    for (const value of ["1", "2", "3", "4"]) {
      for (const variant of [{ ...answers, bsrs_01: { state: "missing" } },
        { ...answers, bsrs_01: { state: "answered", value: "bad" } },
        { bsrs_suicide: { state: "answered", value } }]) {
        const actual = evaluate("bsrs5", { ...variant, bsrs_suicide: { state: "answered", value } }, {});
        expect(actual.status).not.toBe("complete"); expect(actual.score).toBeNull(); expect(actual.classification).toBeNull();
        expect(actual.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ requiresAcknowledgement: true,
          code: value === "1" ? "BSRS_SUICIDE_CONCERN_REVIEW" : "BSRS_SUICIDE_PROFESSIONAL_REVIEW" })]));
      }
    }
  });

  it("retains invalid precedence when another answer is missing or MNA measurements also fail", () => {
    const { answers } = fixture("mna_sf");
    for (const context of [{}, { height_cm: "241", weight_kg: "60" }, { height_cm: "200", weight_kg: "92" }]) {
      const actual = evaluate("mna_sf", { ...answers, food_intake: { state: "answered", value: "invalid" }, mobility: { state: "missing" } }, context);
      expect(actual).toMatchObject({ status: "invalid", storageValid: false, score: null, classification: null });
      expect(actual.issues.some(({ category }) => category === "invalid")).toBe(true);
    }
  });

  it("separates measurement incompleteness from structurally invalid physical input even when F is missing", () => {
    const { answers } = fixture("mna_sf");
    const bmi = { ...answers, anthropometry: { state: "answered", value: "bmi_gte_23" } };
    for (const [context, code] of [[{}, "MEASUREMENT_REQUIRED"],
      [{ height_cm: "200", weight_kg: "92", calf_circumference_cm: "31" }, "MEASUREMENT_CONFLICT"],
      [{ height_cm: "200", weight_kg: "76" }, "MEASUREMENT_MISMATCH"]] as const) {
      const actual = evaluate("mna_sf", bmi, context);
      expect(actual).toMatchObject({ status: "incomplete", storageValid: false, score: null, classification: null });
      expect(actual.issues).toContainEqual({ code, path: "answers.anthropometry", category: "incomplete", blocksStorage: true, blocksCompletion: true });
    }
    for (const state of [{ state: "missing" }, { state: "not_applicable", reason: "合成原因" }]) {
      expect(evaluate("mna_sf", { ...answers, anthropometry: state }, { height_cm: "241" }))
        .toMatchObject({ status: "invalid", storageValid: false, score: null });
      expect(evaluate("mna_sf", { ...answers, anthropometry: state }, { height_cm: "240" }))
        .toMatchObject({ status: "incomplete", storageValid: true, score: null });
    }
  });

  it("rejects unsupported or mismatched hash-bound candidates, including caller-rehashed policy changes", () => {
    const { validation, scoring, answers, context } = fixture("spmsq");
    const wrongScoring = buildQuestionnaireRuleCatalogEntry("gds_15");
    expect(() => evaluateQuestionnaireValidationCandidate(validation, wrongScoring, answers, context)).toThrow();
    expect(() => evaluateQuestionnaireValidationCandidate({ ...validation, validationCatalogHash: "0".repeat(64) }, scoring, answers, context)).toThrow();
    const mutated = structuredClone(validation);
    const changedManifest = JSON.parse(mutated.canonicalJson); changedManifest.issueRules[0].blocksStorage = false;
    const canonicalJson = canonicalRuleJson(changedManifest);
    const forged = { manifest: changedManifest, canonicalJson, validationCatalogHash: createHash("sha256").update(canonicalJson).digest("hex") };
    expect(() => evaluateQuestionnaireValidationCandidate(forged, scoring, answers, context)).toThrow();
    const changedScoring = JSON.parse(scoring.canonicalJson); changedScoring.rules.scoreTable[0].adjustedScore = 7;
    const scoringJson = canonicalRuleJson(changedScoring);
    expect(() => evaluateQuestionnaireValidationCandidate(validation, { ...scoring, manifest: changedScoring,
      canonicalJson: scoringJson, catalogHash: createHash("sha256").update(scoringJson).digest("hex") }, answers, context)).toThrow();
  });

  it("does not execute accessors, inherit answers, echo unregistered sensitive input, or return shared registry data", () => {
    const { validation, scoring, answers, context } = fixture("spmsq"); let calls = 0;
    const accessor = Object.defineProperty({}, "spmsq_01", { enumerable: true, get() { calls += 1; return answers.spmsq_01; } });
    expect(evaluateQuestionnaireValidationCandidate(validation, scoring, accessor, context))
      .toMatchObject({ status: "invalid", storageValid: false }); expect(calls).toBe(0);
    expect(evaluate("spmsq", Object.create(answers), context)).toMatchObject({ status: "invalid", storageValid: false });
    const sensitive = "SYNTHETIC_NEVER_ECHO";
    const result = evaluate("spmsq", { ...answers, [sensitive]: { state: "answered", value: sensitive } }, { ...context, [sensitive]: sensitive });
    expect(JSON.stringify(result)).not.toContain(sensitive);
    const first = evaluate("spmsq", answers, context);
    (first.score as { raw: number }).raw = 999;
    expect(evaluate("spmsq", answers, context).score?.raw).not.toBe(999);
    for (const text of ["\u0000", "\ud800", "\udfff"]) {
      expect(evaluate("spmsq", answers, { ...context, qualitative_note: text })).toMatchObject({ status: "invalid", storageValid: false });
    }
  });
});
