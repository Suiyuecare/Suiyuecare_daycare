import { describe, expect, it } from "vitest";

import {
  ASSESSMENT_DEFINITIONS,
  ASSESSMENT_TEST_VECTORS,
  answered,
  missingAnswer,
  notApplicableAnswer,
  scoreAssessment,
} from ".";
import type { AssessmentAnswers, AssessmentSubmission } from ".";

function withAnswer(
  submission: AssessmentSubmission,
  id: string,
  value: ReturnType<typeof answered> | ReturnType<typeof missingAnswer>,
): AssessmentSubmission {
  return {
    ...submission,
    answers: { ...submission.answers, [id]: value },
  };
}

const vector = (id: string) => {
  const found = ASSESSMENT_TEST_VECTORS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing test vector: ${id}`);
  return found;
};

describe("versioned assessment registry", () => {
  it("publishes the five requested instruments as unactivated review versions", () => {
    expect(ASSESSMENT_DEFINITIONS.map((item) => item.instrument)).toEqual([
      "spmsq",
      "gds_15",
      "barthel_adl",
      "lawton_iadl",
      "mna_sf",
    ]);
    for (const definition of ASSESSMENT_DEFINITIONS) {
      expect(definition.ruleRevision).toBe(1);
      expect(definition.reviewRequired).toBe(true);
      expect(definition.activatedAt).toBeNull();
      expect(definition.sources.length).toBeGreaterThan(0);
      expect(definition.disclaimer).toContain("不構成診斷");
    }
  });

  it.each(ASSESSMENT_TEST_VECTORS)(
    "reproduces golden vector $id",
    ({ submission, expected }) => {
      const result = scoreAssessment(submission);
      expect(result.status).toBe(expected.status);
      expect(result.score?.raw).toBe(expected.rawScore);
      expect(result.score?.adjusted).toBe(expected.adjustedScore);
      expect(result.classification?.key ?? null).toBe(
        expected.classificationKey,
      );
      expect(result.rule?.versionId).toBe(submission.versionId);
      expect(result.answers).toEqual(submission.answers);
    },
  );
});

describe("pure and reproducible scoring", () => {
  it("returns the same snapshot without mutating the submission", () => {
    const submission = vector("barthel-maximum").submission;
    const before = JSON.stringify(submission);
    const first = scoreAssessment(submission);
    const second = scoreAssessment(submission);

    expect(second).toEqual(first);
    expect(JSON.stringify(submission)).toBe(before);
    expect(first.answers).not.toBe(submission.answers);
    expect(first.rule?.sources).not.toBe(
      ASSESSMENT_DEFINITIONS.find(
        (definition) => definition.versionId === submission.versionId,
      )?.sources,
    );
  });

  it("rejects an unknown rule version without attempting a score", () => {
    const result = scoreAssessment({
      versionId: "future-unreviewed-version",
      answers: { q1: answered("yes") },
    });
    expect(result).toMatchObject({
      status: "invalid",
      instrument: null,
      score: null,
      classification: null,
      issues: [{ code: "VERSION_NOT_FOUND", field: "versionId" }],
    });
  });
});

describe("SPMSQ scoring", () => {
  it("applies the explicit education adjustment before classification", () => {
    const base = vector("spmsq-mild-boundary").submission;
    const lowerEducation = scoreAssessment({
      ...base,
      context: { education_adjustment: "grade_school_or_less" },
    });
    const higherEducation = scoreAssessment({
      ...base,
      context: { education_adjustment: "beyond_high_school" },
    });

    expect(lowerEducation.score).toMatchObject({ raw: 3, adjusted: 2 });
    expect(lowerEducation.classification?.key).toBe("reference_0_2_errors");
    expect(higherEducation.score).toMatchObject({ raw: 3, adjusted: 4 });
    expect(higherEducation.classification?.key).toBe("mild_3_4_errors");
  });

  it("does not classify without the required education context", () => {
    const base: AssessmentSubmission = vector("spmsq-no-errors").submission;
    const withoutContext: AssessmentSubmission = {
      versionId: base.versionId,
      answers: base.answers,
    };
    const result = scoreAssessment(withoutContext);
    expect(result.status).toBe("incomplete");
    expect(result.score).toMatchObject({ raw: null, adjusted: null });
    expect(result.classification).toBeNull();
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_REQUIRED_CONTEXT",
        field: "education_adjustment",
      }),
    );
  });
});

describe("GDS-15 scoring", () => {
  it("keeps the 4/5 boundary distinct", () => {
    const five = vector("gds-elevated-boundary").submission;
    const four = withAnswer(five, "gds_01", answered("yes"));
    expect(scoreAssessment(four).classification?.key).toBe("reference_0_4");
    expect(scoreAssessment(five).classification?.key).toBe("elevated_5_8");
    expect(scoreAssessment(five).alerts).toContainEqual(
      expect.objectContaining({ code: "GDS_PROFESSIONAL_REVIEW" }),
    );
  });
});

describe("Barthel ADL and Lawton IADL scoring", () => {
  it("preserves the Barthel 60/100 reference boundaries", () => {
    const sixty = scoreAssessment(vector("barthel-sixty-boundary").submission);
    const hundred = scoreAssessment(vector("barthel-maximum").submission);
    expect(sixty.classification?.key).toBe("severe_dependency_21_60");
    expect(hundred.classification?.key).toBe("independent_100");
  });

  it("scores all eight IADL domains for every person", () => {
    const seven = scoreAssessment(vector("iadl-seven-boundary").submission);
    const eight = scoreAssessment(vector("iadl-maximum").submission);
    expect(seven.score?.adjusted).toBe(7);
    expect(seven.classification?.key).toBe(
      "support_in_one_or_more_domains_1_7",
    );
    expect(eight.classification?.key).toBe("high_function_8");
  });
});

describe("MNA-SF scoring", () => {
  const minimumAnswers: AssessmentAnswers = {
    food_intake: answered("severe_decrease"),
    weight_loss: answered("greater_than_3kg"),
    mobility: answered("bed_or_chair_bound"),
    acute_stress_or_disease: answered("yes"),
    neuropsychological: answered("severe"),
    anthropometry: answered("bmi_lt_19"),
  };

  it("supports the BMI-or-calf replacement choices and 0/11/14 bands", () => {
    const minimum = scoreAssessment({
      versionId: "mna-sf-revised-2009-v1",
      answers: minimumAnswers,
    });
    const eleven = scoreAssessment(
      vector("mna-risk-boundary-with-calf").submission,
    );
    const maximum = scoreAssessment(vector("mna-maximum-bmi").submission);

    expect(minimum.score?.adjusted).toBe(0);
    expect(minimum.classification?.key).toBe("malnourished_screen_0_7");
    expect(eleven.score?.adjusted).toBe(11);
    expect(eleven.classification?.key).toBe("at_risk_screen_8_11");
    expect(maximum.score?.adjusted).toBe(14);
    expect(maximum.classification?.key).toBe("normal_screen_12_14");
  });
});

describe("missing, not-applicable and illegal answers", () => {
  it("treats an explicit missing answer as incomplete and never as zero", () => {
    const result = scoreAssessment(
      withAnswer(vector("gds-zero").submission, "gds_15", missingAnswer()),
    );
    expect(result.status).toBe("incomplete");
    expect(result.score).toMatchObject({ raw: null, adjusted: null });
    expect(result.classification).toBeNull();
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_REQUIRED_ANSWER",
        field: "gds_15",
      }),
    );
  });

  it("keeps N/A separate from missing", () => {
    const base = vector("iadl-maximum").submission;
    const result = scoreAssessment({
      ...base,
      answers: {
        ...base.answers,
        laundry: notApplicableAnswer("未觀察"),
      },
    });
    expect(result.status).toBe("incomplete");
    expect(result.answers.laundry).toEqual({
      state: "not_applicable",
      reason: "未觀察",
    });
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "NOT_APPLICABLE_ANSWER",
        field: "laundry",
      }),
    );
    expect(result.issues.some((issue) => issue.code === "MISSING_REQUIRED_ANSWER")).toBe(
      false,
    );
  });

  it("rejects invalid option values and unknown answer fields", () => {
    const base = vector("mna-maximum-bmi").submission;
    const result = scoreAssessment({
      ...base,
      answers: {
        ...base.answers,
        anthropometry: answered("bmi_23_typo"),
        unversioned_field: answered("anything"),
      },
    });
    expect(result.status).toBe("invalid");
    expect(result.score).toMatchObject({ raw: null, adjusted: null });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_ANSWER",
          field: "anthropometry",
        }),
        expect.objectContaining({
          code: "UNKNOWN_ANSWER",
          field: "unversioned_field",
        }),
      ]),
    );
  });
});
