import { describe, expect, it } from "vitest";
import { FULL_MNA_DEFINITION, FULL_MNA_PROTEIN_FIELDS, FULL_MNA_SOURCE_SHA256, FULL_MNA_SOURCE_URL, FULL_MNA_VERSION, fullMnaProteinChoice } from "@/lib/assessments/full-mna";
import { scoreAssessment } from "@/lib/assessments/engine";
import { QUESTIONNAIRE_FORMS } from "./forms";
import { fullMnaScoringContext, validateFullMnaInput } from "./full-mna-validation";
import type { QuestionnaireAnswers } from "./types";

const proteinContext = { protein_dairy: "yes", protein_legumes_eggs: "yes", protein_meat_fish_poultry: "yes" };
const context = { ...proteinContext, height_cm: "160", weight_kg: "64", arm_circumference_cm: "22", calf_circumference_cm: "31" };
const maximum: QuestionnaireAnswers = Object.fromEntries(FULL_MNA_DEFINITION.items.map((item) => [item.id,
  { state: "answered", value: [...item.choices].sort((a, b) => b.points - a.points)[0]!.value },
]));
const score = (answers: QuestionnaireAnswers, input = proteinContext) => scoreAssessment({ versionId: FULL_MNA_VERSION, answers, context: input });

describe("official full MNA Chinese amended 2023 candidate", () => {
  it("retains A–R order, source digest and BMI-only F independently of unchanged SF", () => {
    const form = QUESTIONNAIRE_FORMS.full_mna;
    expect(form.questions).toHaveLength(18);
    expect(form.questions.map((item) => item.prompt[0])).toEqual("ABCDEFGHIJKLMNOPQR".split(""));
    expect(form.sourceUrl).toBe(FULL_MNA_SOURCE_URL); expect(form.sourceHash).toBe(FULL_MNA_SOURCE_SHA256);
    expect(form.questions[5]!.choices.map((item) => item.value)).not.toContain("calf_gte_31");
    expect(QUESTIONNAIRE_FORMS.mna_sf.questions).toHaveLength(6);
    expect(QUESTIONNAIRE_FORMS.mna_sf.questions[5]!.choices.map((item) => item.value)).toContain("calf_gte_31");
    expect(FULL_MNA_DEFINITION.activatedAt).toBeNull(); expect(FULL_MNA_DEFINITION.reviewRequired).toBe(true);
  });
  it("reproduces maximum 30 without activating a clinical publication", () => {
    expect(validateFullMnaInput(context, maximum)).toBeNull();
    expect(score(maximum)).toMatchObject({ status: "complete", score: { raw: 30, adjusted: 30 }, classification: { key: "normal_full_24_30" }, rule: { activatedAt: null } });
  });
  it.each([
    [16.5, "malnourished_full_0_16_5"], [17, "at_risk_full_17_23_5"], [23.5, "at_risk_full_17_23_5"], [24, "normal_full_24_30"],
  ] as const)("preserves halfpoint threshold %s", (target, key) => {
    // Independent fixed vector: first six 14, then choose each explicit G–R value.
    const changes: Record<number, Record<string, string>> = {
      16.5: { independent_living: "no", prescription_drugs: "yes", pressure_sores: "yes", full_meals: "one", fruit_vegetables: "no", fluid_intake: "three_to_five", feeding_mode: "needs_help", self_nutrition: "malnourished", self_health: "worse", arm_circumference: "mac_lt_21", calf_circumference: "calf_gte_31" },
      17: { independent_living: "no", prescription_drugs: "yes", pressure_sores: "yes", full_meals: "one", fruit_vegetables: "no", fluid_intake: "gt_five", feeding_mode: "needs_help", self_nutrition: "malnourished", self_health: "worse", arm_circumference: "mac_lt_21", calf_circumference: "calf_gte_31" },
      23.5: { independent_living: "no", prescription_drugs: "yes", pressure_sores: "yes", full_meals: "one", fluid_intake: "three_to_five", self_health: "same" },
      24: { independent_living: "no", prescription_drugs: "yes", pressure_sores: "yes", full_meals: "one", self_health: "same" },
    };
    const answers = { ...maximum, ...Object.fromEntries(Object.entries(changes[target]).map(([id, value]) => [id, { state: "answered" as const, value }])) };
    expect(score(answers)).toMatchObject({ status: "complete", score: { raw: target }, classification: { key } });
  });
  it.each(FULL_MNA_DEFINITION.items)("keeps missing $id unknown rather than zero", (item) => {
    expect(score({ ...maximum, [item.id]: { state: "missing" } })).toMatchObject({ status: "incomplete", score: { raw: null }, classification: null });
  });
  it("retains all three K inputs and rejects a mismatched derived choice", () => {
    for (let count = 0; count <= 3; count++) {
      const input = Object.fromEntries(FULL_MNA_PROTEIN_FIELDS.map((field, index) => [field.key, index < count ? "yes" : "no"]));
      expect(fullMnaProteinChoice(input)).toBe(count < 2 ? "zero_or_one_yes" : count === 2 ? "two_yes" : "three_yes");
    }
    expect(validateFullMnaInput({ ...context, protein_dairy: "no" }, maximum)?.kind).toBe("protein_mismatch");
    expect(score({ ...maximum, protein_intake: { state: "answered", value: "two_yes" } }).status).toBe("invalid");
    expect(score(maximum, { ...proteinContext, protein_dairy: "" }).status).toBe("incomplete");
    expect(score({ ...maximum, protein_intake: { state: "answered", value: "two_yes" } },
      { ...proteinContext, protein_dairy: "no" })).toMatchObject({ status: "complete", score: { raw: 29.5 } });
  });
  it.each([
    ["21", "mac_21_lt_22"], ["21.9", "mac_21_lt_22"], ["22", "mac_gte_22"],
  ])("validates the Chinese Q boundary %s", (value, selected) => {
    expect(validateFullMnaInput({ ...context, arm_circumference_cm: value }, { ...maximum, arm_circumference: { state: "answered", value: selected } })).toBeNull();
  });
  it("validates all Full measurements without reusing SF mutual exclusion", () => {
    expect(validateFullMnaInput(context, maximum)).toBeNull();
    expect(validateFullMnaInput({ ...context, calf_circumference_cm: "30.9" }, maximum)?.questionId).toBe("calf_circumference");
    expect(validateFullMnaInput({ ...context, weight_kg: "40" }, maximum)?.questionId).toBe("anthropometry");
    expect(validateFullMnaInput({ ...context, arm_circumference_cm: "21.5" }, maximum)?.questionId).toBe("arm_circumference");
    expect(validateFullMnaInput({ ...context, height_cm: "" }, maximum)?.kind).toBe("missing_measurement");
    expect(validateFullMnaInput({ ...context, weight_kg: "NaN" }, maximum)?.kind).toBe("invalid_measurement");
    expect(fullMnaScoringContext(context)).toEqual(proteinContext);
  });
  it("permits an incomplete measured/K draft while rejecting invalid supplied values", () => {
    const answers = Object.fromEntries(FULL_MNA_DEFINITION.items.map((item) => [item.id, { state: "missing" as const }]));
    expect(validateFullMnaInput({}, answers)).toBeNull();
    expect(validateFullMnaInput({ weight_kg: "64" }, answers)).toBeNull();
    expect(validateFullMnaInput({ weight_kg: "64.01" }, answers)?.kind).toBe("invalid_measurement");
  });
});
