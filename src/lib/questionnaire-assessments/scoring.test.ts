import { describe, expect, it } from "vitest";

import { scoreAssessment } from "@/lib/assessments/engine";
import type { AssessmentAnswers } from "@/lib/assessments/types";

import { QUESTIONNAIRE_FORMS } from "./forms";

describe("fillable assessment scoring contracts", () => {
  it.each(Object.values(QUESTIONNAIRE_FORMS))("maps every answer in $title to its fixed scoring version", (form) => {
    if (!form.scoreVersionId) throw new Error(`${form.key} is missing a scoring version`);
    const answers: AssessmentAnswers = Object.fromEntries(form.questions.map((question) => [
      question.id,
      { state: "answered", value: question.choices[0]!.value },
    ]));
    const context: Record<string, string> = form.key === "spmsq"
      ? { education_adjustment: "middle_or_high_school" }
      : {};
    const result = scoreAssessment({
      versionId: form.scoreVersionId,
      answers,
      context,
    });

    expect(result.status, form.key).toBe("complete");
    expect(result.score, form.key).not.toBeNull();
    expect(result.rule?.versionId, form.key).toBe(form.scoreVersionId);
  });

  it("keeps BSRS-5 safety item outside the summed five-item score", () => {
    const form = QUESTIONNAIRE_FORMS.bsrs5;
    const answers: AssessmentAnswers = Object.fromEntries(form.questions.map((question) => [
      question.id,
      { state: "answered", value: question.id === "bsrs_suicide" ? "4" : "0" },
    ]));
    const result = scoreAssessment({ versionId: form.scoreVersionId!, answers });
    expect(result.score?.raw).toBe(0);
  });

  it("flags the Taipei B12 threshold exactly at three factors", () => {
    const form = QUESTIONNAIRE_FORMS.fall_risk_taipei_115;
    const answers: AssessmentAnswers = Object.fromEntries(form.questions.map((question, index) => [
      question.id,
      { state: "answered", value: index < 3 ? "yes" : "no" },
    ]));
    const result = scoreAssessment({ versionId: form.scoreVersionId!, answers });
    expect(result.score?.raw).toBe(3);
    expect(result.classification?.key).toBe("high_risk_threshold_3_12");
  });
});
