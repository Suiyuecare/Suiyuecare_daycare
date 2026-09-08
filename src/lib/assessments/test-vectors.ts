import { answered } from "./engine";
import type { AssessmentAnswers, AssessmentTestVector } from "./types";

function codedAnswers(values: Readonly<Record<string, string>>): AssessmentAnswers {
  return Object.fromEntries(
    Object.entries(values).map(([id, value]) => [id, answered(value)]),
  );
}

function numberedAnswers(
  prefix: "spmsq" | "gds",
  values: readonly string[],
): AssessmentAnswers {
  return codedAnswers(
    Object.fromEntries(
      values.map((value, index) => [
        `${prefix}_${String(index + 1).padStart(2, "0")}`,
        value,
      ]),
    ),
  );
}

const barthelMaximum = {
  feeding: "independent",
  bathing: "independent",
  grooming: "independent",
  dressing: "independent",
  bowels: "continent",
  bladder: "continent",
  toilet_use: "independent",
  transfers: "independent",
  mobility: "independent",
  stairs: "independent",
} as const;

const iadlMaximum = {
  telephone: "independent",
  shopping: "independent",
  food_preparation: "independent",
  housekeeping: "independent",
  laundry: "independent",
  transportation: "independent",
  medications: "independent",
  finances: "independent",
} as const;

const mnaMaximum = {
  food_intake: "no_decrease",
  weight_loss: "no_weight_loss",
  mobility: "goes_out",
  acute_stress_or_disease: "no",
  neuropsychological: "none",
  anthropometry: "bmi_gte_23",
} as const;

export const ASSESSMENT_TEST_VECTORS = [
  {
    id: "spmsq-no-errors",
    submission: {
      versionId: "spmsq-pfeiffer-10-education-adjusted-v1",
      answers: numberedAnswers("spmsq", Array(10).fill("correct")),
      context: { education_adjustment: "middle_or_high_school" },
    },
    expected: {
      status: "complete",
      rawScore: 0,
      adjustedScore: 0,
      classificationKey: "reference_0_2_errors",
    },
  },
  {
    id: "spmsq-mild-boundary",
    submission: {
      versionId: "spmsq-pfeiffer-10-education-adjusted-v1",
      answers: numberedAnswers("spmsq", [
        "incorrect",
        "incorrect",
        "incorrect",
        "correct",
        "correct",
        "correct",
        "correct",
        "correct",
        "correct",
        "correct",
      ]),
      context: { education_adjustment: "middle_or_high_school" },
    },
    expected: {
      status: "complete",
      rawScore: 3,
      adjustedScore: 3,
      classificationKey: "mild_3_4_errors",
    },
  },
  {
    id: "gds-zero",
    submission: {
      versionId: "gds-15-strict-complete-v1",
      answers: numberedAnswers("gds", [
        "yes",
        "no",
        "no",
        "no",
        "yes",
        "no",
        "yes",
        "no",
        "no",
        "no",
        "yes",
        "no",
        "yes",
        "no",
        "no",
      ]),
    },
    expected: {
      status: "complete",
      rawScore: 0,
      adjustedScore: 0,
      classificationKey: "reference_0_4",
    },
  },
  {
    id: "gds-elevated-boundary",
    submission: {
      versionId: "gds-15-strict-complete-v1",
      answers: numberedAnswers("gds", Array(15).fill("no")),
    },
    expected: {
      status: "complete",
      rawScore: 5,
      adjustedScore: 5,
      classificationKey: "elevated_5_8",
    },
  },
  {
    id: "barthel-maximum",
    submission: {
      versionId: "barthel-adl-0-100-v1",
      answers: codedAnswers(barthelMaximum),
    },
    expected: {
      status: "complete",
      rawScore: 100,
      adjustedScore: 100,
      classificationKey: "independent_100",
    },
  },
  {
    id: "barthel-sixty-boundary",
    submission: {
      versionId: "barthel-adl-0-100-v1",
      answers: codedAnswers({
        ...barthelMaximum,
        transfers: "unable",
        mobility: "immobile",
        stairs: "unable",
      }),
    },
    expected: {
      status: "complete",
      rawScore: 60,
      adjustedScore: 60,
      classificationKey: "severe_dependency_21_60",
    },
  },
  {
    id: "iadl-maximum",
    submission: {
      versionId: "lawton-iadl-binary-8-v1",
      answers: codedAnswers(iadlMaximum),
    },
    expected: {
      status: "complete",
      rawScore: 8,
      adjustedScore: 8,
      classificationKey: "high_function_8",
    },
  },
  {
    id: "iadl-seven-boundary",
    submission: {
      versionId: "lawton-iadl-binary-8-v1",
      answers: codedAnswers({ ...iadlMaximum, finances: "dependent" }),
    },
    expected: {
      status: "complete",
      rawScore: 7,
      adjustedScore: 7,
      classificationKey: "support_in_one_or_more_domains_1_7",
    },
  },
  {
    id: "mna-maximum-bmi",
    submission: {
      versionId: "mna-sf-revised-2009-v1",
      answers: codedAnswers(mnaMaximum),
    },
    expected: {
      status: "complete",
      rawScore: 14,
      adjustedScore: 14,
      classificationKey: "normal_screen_12_14",
    },
  },
  {
    id: "mna-risk-boundary-with-calf",
    submission: {
      versionId: "mna-sf-revised-2009-v1",
      answers: codedAnswers({
        ...mnaMaximum,
        weight_loss: "between_1_and_3kg",
        acute_stress_or_disease: "yes",
        anthropometry: "calf_gte_31",
      }),
    },
    expected: {
      status: "complete",
      rawScore: 11,
      adjustedScore: 11,
      classificationKey: "at_risk_screen_8_11",
    },
  },
] as const satisfies readonly AssessmentTestVector[];
