import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getAssessmentDefinition } from "@/lib/assessments/definitions";
import { scoreAssessment } from "@/lib/assessments/engine";
import type { AssessmentAnswers, AssessmentAlert } from "@/lib/assessments/types";
import { QUESTIONNAIRE_FORMS } from "./forms";
import { mnaMeasurementIssue } from "./preview";
import { buildQuestionnaireRuleCatalogEntry } from "./rule-catalog";
import type { QuestionnaireFormKey } from "./types";

type Rules = ReturnType<typeof buildQuestionnaireRuleCatalogEntry>["manifest"]["rules"];
const keys = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];
const withoutGovernance = (alerts: readonly AssessmentAlert[]) => alerts.filter(({ code }) => !code.startsWith("RULE_"));

function representativeAnswers(rules: Rules): Map<number, AssessmentAnswers> {
  let totals = new Map<number, AssessmentAnswers>([[0, {}]]);
  for (const item of rules.items) {
    const next = new Map<number, AssessmentAnswers>();
    for (const [total, answers] of totals) {
      for (const choice of item.choices) {
        const score = total + choice.points;
        if (!next.has(score)) next.set(score, { ...answers, [item.id]: { state: "answered", value: choice.value } });
      }
    }
    totals = next;
  }
  return totals;
}

function contexts(rules: Rules): Record<string, string>[] {
  return rules.context.reduce<Record<string, string>[]>((combinations, field) =>
    combinations.flatMap((context) => field.choices.map((value) => ({ ...context, [field.id]: value }))), [{}]);
}

function answerAlerts(rules: Rules, answers: AssessmentAnswers): readonly AssessmentAlert[] {
  return rules.answerAlertTable.flatMap(({ questionId, value, alerts }) => {
    const answer = answers[questionId];
    return answer?.state === "answered" && answer.value === value ? alerts : [];
  });
}

describe("nine candidate catalogs support complete-score declarative reproduction", () => {
  it.each(keys)("reproduces every reachable raw score and context combination for %s", (key) => {
    const { manifest, ruleVersion } = buildQuestionnaireRuleCatalogEntry(key);
    const { rules } = manifest;
    const combinations = contexts(rules);
    expect(rules.scoreTable).toHaveLength(combinations.length * (rules.scoreMax - rules.scoreMin + 1));
    const answersByTotal = representativeAnswers(rules);
    expect(Math.min(...answersByTotal.keys())).toBe(rules.scoreMin);
    expect(Math.max(...answersByTotal.keys())).toBe(rules.scoreMax);
    for (const context of combinations) {
      for (const [rawScore, answers] of answersByTotal) {
        const rows = rules.scoreTable.filter((row) => row.rawScore === rawScore && JSON.stringify(row.context) === JSON.stringify(context));
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        const actual = scoreAssessment({ versionId: ruleVersion, answers, context });
        expect(actual.status).toBe("complete");
        expect(actual.issues).toEqual([]);
        expect(actual.score).toEqual({ raw: rawScore, adjusted: row.adjustedScore,
          min: rules.scoreMin, max: rules.scoreMax, unit: rules.scoreUnit });
        expect(actual.classification).toEqual(row.classification);
        expect(withoutGovernance(actual.alerts)).toEqual([...answerAlerts(rules, answers), ...row.alerts]);
      }
    }
  });

  it.each(keys)("never converts missing or not-applicable answers into zero scores for %s", (key) => {
    const { ruleVersion, manifest: { rules } } = buildQuestionnaireRuleCatalogEntry(key);
    const base = representativeAnswers(rules).get(rules.scoreMin)!;
    const context = contexts(rules)[0]!;
    for (const item of rules.items) {
      expect(item.required).toBe(true);
      expect(item.allowNotApplicable).toBe(false);
      for (const variant of ["omitted", "missing", "not_applicable"] as const) {
        const answers = { ...base };
        if (variant === "omitted") delete answers[item.id];
        else answers[item.id] = variant === "missing" ? { state: "missing" }
          : { state: "not_applicable", reason: "Synthetic not-applicable reason" };
        const actual = scoreAssessment({ versionId: ruleVersion, answers, context });
        expect(actual.status).toBe("incomplete");
        expect(actual.score?.raw).toBeNull();
        expect(actual.score?.adjusted).toBeNull();
        expect(actual.classification).toBeNull();
        expect(actual.issues).toEqual([expect.objectContaining({ field: item.id, category: "incomplete",
          code: variant === "not_applicable" ? "NOT_APPLICABLE_ANSWER" : "MISSING_REQUIRED_ANSWER" })]);
        expect(withoutGovernance(actual.alerts)).toEqual(answerAlerts(rules, answers));
      }
    }
  });

  it.each(keys)("rejects unregistered answer/context values without suppressing independent alerts for %s", (key) => {
    const { ruleVersion, manifest: { rules } } = buildQuestionnaireRuleCatalogEntry(key);
    const base = representativeAnswers(rules).get(rules.scoreMin)!;
    const context = contexts(rules)[0]!;
    const variants = [
      { answers: { ...base, synthetic_unknown: { state: "answered" as const, value: "unknown" } }, context },
      { answers: { ...base, [rules.items[0]!.id]: { state: "answered" as const, value: "synthetic_unregistered" } }, context },
      { answers: base, context: { ...context, synthetic_unknown: "unknown" } },
    ];
    for (const variant of variants) {
      const actual = scoreAssessment({ versionId: ruleVersion, ...variant });
      expect(actual.status).toBe("invalid");
      expect(actual.score?.raw).toBeNull();
      expect(actual.classification).toBeNull();
      expect(withoutGovernance(actual.alerts)).toEqual(answerAlerts(rules, variant.answers));
    }
    for (const field of rules.context) {
      const missing = { ...context }; delete missing[field.id];
      const absent = scoreAssessment({ versionId: ruleVersion, answers: base, context: missing });
      expect(absent.status).toBe(field.required ? "incomplete" : "complete");
      const invalid = scoreAssessment({ versionId: ruleVersion, answers: base,
        context: { ...context, [field.id]: "synthetic_unregistered" } });
      expect(invalid.status).toBe("invalid");
    }
  });
});

describe("independent answer alert completeness and unresolved policy boundaries", () => {
  it("captures every BSRS safety choice independently of raw score, completeness and invalid other answers", () => {
    const { ruleVersion, manifest: { rules } } = buildQuestionnaireRuleCatalogEntry("bsrs5");
    const safety = rules.items.find(({ id }) => id === "bsrs_suicide")!;
    expect(safety.choices.every(({ points }) => points === 0)).toBe(true);
    const base = representativeAnswers(rules).get(rules.scoreMin)!;
    for (const choice of safety.choices) {
      const expected = choice.value === "0" ? [] : [expect.objectContaining({ requiresAcknowledgement: true,
        code: choice.value === "1" ? "BSRS_SUICIDE_CONCERN_REVIEW" : "BSRS_SUICIDE_PROFESSIONAL_REVIEW" })];
      for (const answers of [
        { ...base, bsrs_suicide: { state: "answered" as const, value: choice.value } },
        { bsrs_suicide: { state: "answered" as const, value: choice.value } },
        { ...base, [rules.items[0]!.id]: { state: "answered" as const, value: "invalid" },
          bsrs_suicide: { state: "answered" as const, value: choice.value } },
      ]) {
        const actual = scoreAssessment({ versionId: ruleVersion, answers });
        expect(withoutGovernance(actual.alerts)).toEqual(expected);
        expect(answerAlerts(rules, answers)).toEqual(expected);
      }
    }
    expect(rules.answerAlertTable).toHaveLength(4);
    expect(rules.answerAlertTable.every(({ questionId }) => questionId === "bsrs_suicide")).toBe(true);
  });

  it("does not present six-domain MNA-SF as eighteen-domain full MNA", () => {
    const { manifest } = buildQuestionnaireRuleCatalogEntry("mna_sf");
    expect(manifest.rules.items).toHaveLength(6);
    expect(manifest.rules.scoreMax).toBe(14);
    expect(manifest.ruleVersion).toBe("mna-sf-revised-2009-v1");
    expect(manifest.form.title).toContain("MNA");
  });

  it("keeps MNA raw-choice scoring distinct from required measurement validation", () => {
    const { manifest, ruleVersion } = buildQuestionnaireRuleCatalogEntry("mna_sf");
    const answers = Object.fromEntries(Object.entries(representativeAnswers(manifest.rules).get(manifest.rules.scoreMax)!)
      .map(([key, answer]) => {
        if (answer.state !== "answered") throw new Error("Synthetic complete score fixture must be answered.");
        return [key, { state: "answered" as const, value: answer.value }];
      }));
    // The frozen candidate table reproduces option scoring. A future formal
    // signer must also bind a versioned measurement validator: labels alone do
    // not freeze the BMI formula, ranges or mutually exclusive BMI/CC evidence.
    expect(manifest.rules.context).toEqual([]);
    expect(manifest.form.measurementFields?.map((field) => Object.keys(field).sort())).toEqual([
      ["key", "label"], ["key", "label"], ["key", "label"],
    ]);
    expect(scoreAssessment({ versionId: ruleVersion, answers }).status).toBe("complete");
    expect(mnaMeasurementIssue(answers, {})).not.toBeNull();
    expect(mnaMeasurementIssue(answers, { height_cm: "170", weight_kg: "50" })).not.toBeNull();
    expect(mnaMeasurementIssue(answers, { height_cm: "170", weight_kg: "70" })).toBeNull();
  });

  it("preserves current GDS/SPMSQ candidates without choosing a replacement policy", () => {
    const gds = buildQuestionnaireRuleCatalogEntry("gds_15");
    expect(gds.manifest.sourceSnapshot.some(({ url }) => url === "https://web.stanford.edu/~yesavage/GDS.html")).toBe(true);
    expect(gds.manifest.rules.scoreTable.find(({ rawScore }) => rawScore === 5)?.classification.key).toBe("elevated_5_8");
    const spmsq = buildQuestionnaireRuleCatalogEntry("spmsq");
    expect(contexts(spmsq.manifest.rules)).toHaveLength(3);
    for (const entry of [gds, spmsq]) {
      const definition = getAssessmentDefinition(entry.ruleVersion)!;
      expect(definition.reviewRequired).toBe(true);
      expect(definition.activatedAt).toBeNull();
    }
  });
});

describe("unknown scoring versions cannot resolve inherited object members", () => {
  it.each(["toString", "constructor", "__proto__", "hasOwnProperty", "synthetic-unknown-version"])(
    "returns an invalid result rather than executing inherited member %s", (versionId) => {
      expect(scoreAssessment({ versionId, answers: {} })).toMatchObject({ status: "invalid", rule: null,
        issues: [{ code: "VERSION_NOT_FOUND", field: "versionId", category: "invalid" }] });
      expect(getAssessmentDefinition(versionId)).toBeUndefined();
    },
  );
});
