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
  telephone: "telephone_dials_numbers",
  shopping: "shopping_independent_all",
  food_preparation: "meal_independent",
  housekeeping: "housework_independent",
  laundry: "laundry_all",
  transportation: "transport_public_or_drive",
  medications: "medication_independent",
  finances: "finances_independent",
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
    id: "iadl-v2-partial-function-options",
    submission: {
      versionId: "lawton-iadl-8-domain-expanded-v2",
      answers: codedAnswers({
        ...iadlMaximum,
        telephone: "telephone_answer_only",
        housekeeping: "housework_all_help",
        laundry: "laundry_small_items",
        transportation: "transport_with_companion",
        finances: "finances_daily_only",
      }),
    },
    expected: { status: "complete", rawScore: 8, adjustedScore: 8, classificationKey: "high_function_8" },
  },
  {
    id: "bsrs-v2-fourteen-boundary",
    submission: {
      versionId: "bsrs5-zh-tw-v2",
      answers: codedAnswers({ bsrs_01: "3", bsrs_02: "3", bsrs_03: "3", bsrs_04: "3", bsrs_05: "2", bsrs_suicide: "0" }),
    },
    expected: { status: "complete", rawScore: 14, adjustedScore: 14, classificationKey: "moderate_10_14" },
  },
  {
    id: "bsrs-v2-fifteen-boundary",
    submission: {
      versionId: "bsrs5-zh-tw-v2",
      answers: codedAnswers({ bsrs_01: "3", bsrs_02: "3", bsrs_03: "3", bsrs_04: "3", bsrs_05: "3", bsrs_suicide: "0" }),
    },
    expected: { status: "complete", rawScore: 15, adjustedScore: 15, classificationKey: "high_15_20" },
  },
  {
    id: "bsrs-v2-safety-item-not-summed",
    submission: {
      versionId: "bsrs5-zh-tw-v2",
      answers: codedAnswers({ bsrs_01: "0", bsrs_02: "0", bsrs_03: "0", bsrs_04: "0", bsrs_05: "0", bsrs_suicide: "4" }),
    },
    expected: { status: "complete", rawScore: 0, adjustedScore: 0, classificationKey: "adaptation_0_5" },
  },
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
      versionId: "lawton-iadl-8-domain-expanded-v1",
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
      versionId: "lawton-iadl-8-domain-expanded-v1",
      answers: codedAnswers({ ...iadlMaximum, finances: "finances_daily_only" }),
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
