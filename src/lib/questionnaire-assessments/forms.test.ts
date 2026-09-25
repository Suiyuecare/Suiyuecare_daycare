import { describe, expect, it } from "vitest";

import { QUESTIONNAIRE_FORMS } from "./forms";

describe("questionnaire form registry", () => {
  it.each([
    ["spmsq", 10],
    ["gds_15", 15],
    ["barthel_adl", 10],
    ["lawton_iadl", 8],
    ["eat10_swallowing", 10],
    ["bsrs5", 6],
    ["fall_risk_taipei_115", 12],
    ["nsi_determine", 10],
    ["mna_sf", 6],
  ] as const)("contains the configured question count for %s", (formKey, expectedCount) => {
    expect(QUESTIONNAIRE_FORMS[formKey].questions).toHaveLength(expectedCount);
  });

  it.each(Object.values(QUESTIONNAIRE_FORMS))("has unique, answerable items and an attributed source: $title", (form) => {
    if (form.sourceUrl) expect(new URL(form.sourceUrl).protocol).toBe("https:");
    expect(form.sourceLabel.trim()).not.toBe("");
    expect(new Set(form.questions.map(({ id }) => id)).size).toBe(form.questions.length);

    for (const question of form.questions) {
      expect(question.prompt.trim(), question.id).not.toBe("");
      expect(question.choices.length, question.id).toBeGreaterThanOrEqual(2);
      expect(new Set(question.choices.map(({ value }) => value)).size, question.id)
        .toBe(question.choices.length);
    }
  });

  it("keeps the full graded answer choices for all eight IADL domains", () => {
    const choices = Object.fromEntries(QUESTIONNAIRE_FORMS.lawton_iadl.questions.map((question) => [
      question.id,
      question.choices.length,
    ]));
    expect(choices).toEqual({
      telephone: 4,
      shopping: 4,
      food_preparation: 4,
      housekeeping: 5,
      laundry: 3,
      transportation: 5,
      medications: 3,
      finances: 3,
    });
  });
});
