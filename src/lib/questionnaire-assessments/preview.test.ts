import { describe, expect, it } from "vitest";

import { QUESTIONNAIRE_FORMS } from "./forms";
import { mnaMeasurementIssue, questionnairePreview } from "./preview";
import type { QuestionnaireAnswers } from "./types";

const anthropometry = (value: string): QuestionnaireAnswers => ({ anthropometry: { state: "answered", value } });

describe("MNA measurement-backed draft preview", () => {
  it.each([
    ["bmi_lt_19", { height_cm: "160", weight_kg: "48" }],
    ["bmi_19_lt_21", { height_cm: "160", weight_kg: "50" }],
    ["bmi_21_lt_23", { height_cm: "160", weight_kg: "56" }],
    ["bmi_gte_23", { height_cm: "160", weight_kg: "60" }],
    ["calf_lt_31", { calf_circumference_cm: "30.9" }],
    ["calf_gte_31", { calf_circumference_cm: "31" }],
  ])("accepts %s only with the corresponding real measurement", (value, context) => {
    expect(mnaMeasurementIssue(anthropometry(value), context)).toBeNull();
  });

  it.each([
    ["bmi_gte_23", {}],
    ["bmi_gte_23", { height_cm: "160", weight_kg: "48" }],
    ["bmi_gte_23", { height_cm: "160", weight_kg: "60", calf_circumference_cm: "31" }],
    ["calf_gte_31", { calf_circumference_cm: "30.9" }],
    ["calf_gte_31", { calf_circumference_cm: "31", height_cm: "160" }],
    ["calf_gte_31", { calf_circumference_cm: "31.00" }],
    ["bmi_gte_23", { height_cm: "241", weight_kg: "60" }],
  ])("rejects missing, contradictory, or invalid %s context", (value, context) => {
    expect(mnaMeasurementIssue(anthropometry(value), context)).toBeTruthy();
  });

  it("removes the calculated total when the answered BMI band contradicts measurements", () => {
    const form = QUESTIONNAIRE_FORMS.mna_sf;
    const answers = Object.fromEntries(form.questions.map((question) => [question.id, {
      state: "answered", value: question.id === "anthropometry" ? "bmi_gte_23" : question.choices.at(-1)!.value,
    }])) as QuestionnaireAnswers;
    const correct = questionnairePreview(form, answers, { height_cm: "160", weight_kg: "60" });
    expect(correct.result?.status).toBe("complete");
    expect(correct.result?.score).not.toBeNull();
    const mismatch = questionnairePreview(form, answers, { height_cm: "160", weight_kg: "48" });
    expect(mismatch.result).toMatchObject({ status: "incomplete", score: null, classification: null });
    expect(mismatch.measurementIssue).toContain("實測值不符");
    expect(correct.result?.rule?.activatedAt).toBeNull();
    expect(correct.result?.rule?.reviewRequired).toBe(true);
  });
});
