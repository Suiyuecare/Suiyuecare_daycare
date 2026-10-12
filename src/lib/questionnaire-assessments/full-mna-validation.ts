import { FULL_MNA_PROTEIN_FIELDS, fullMnaProteinChoice } from "@/lib/assessments/full-mna";
import type { QuestionnaireAnswers } from "./types";

export const FULL_MNA_MEASUREMENT_BOUNDS = {
  height_cm: { min: 50, max: 240 }, weight_kg: { min: 20, max: 300 },
  arm_circumference_cm: { min: 10, max: 80 }, calf_circumference_cm: { min: 10, max: 80 },
} as const;
export type FullMnaInputIssue = {
  kind: "invalid_measurement" | "missing_measurement" | "interval_mismatch" | "missing_protein" | "protein_mismatch";
  field: string; questionId: string;
};
export function fullMnaScoringContext(context: Readonly<Record<string, string>>) {
  return Object.fromEntries(FULL_MNA_PROTEIN_FIELDS.filter((field) => context[field.key]).map((field) => [field.key, context[field.key]]));
}

/** Drafts may be incomplete; an answered measured/compound item must match its actual inputs. */
export function validateFullMnaInput(context: Readonly<Record<string, string>>, answers: QuestionnaireAnswers): FullMnaInputIssue | null {
  const questionIds = { height_cm: "anthropometry", weight_kg: "anthropometry", arm_circumference_cm: "arm_circumference", calf_circumference_cm: "calf_circumference" } as const;
  for (const [field, bounds] of Object.entries(FULL_MNA_MEASUREMENT_BOUNDS)) {
    const value = context[field];
    if (!value) continue;
    if (!/^\d{1,3}(?:\.\d)?$/u.test(value) || Number(value) < bounds.min || Number(value) > bounds.max) {
      return { kind: "invalid_measurement", field, questionId: questionIds[field as keyof typeof questionIds] };
    }
  }
  for (const [questionId, fields] of [
    ["anthropometry", ["height_cm", "weight_kg"]],
    ["arm_circumference", ["arm_circumference_cm"]], ["calf_circumference", ["calf_circumference_cm"]],
  ] as const) {
    const answer = answers[questionId];
    if (answer?.state !== "answered") continue;
    for (const field of fields) if (!context[field]) return { kind: "missing_measurement", field, questionId };
    const value = questionId === "anthropometry"
      ? Number(context.weight_kg) / ((Number(context.height_cm) / 100) ** 2)
      : Number(context[fields[0]]);
    const expected = questionId === "anthropometry"
      ? value < 19 ? "bmi_lt_19" : value < 21 ? "bmi_19_lt_21" : value < 23 ? "bmi_21_lt_23" : "bmi_gte_23"
      : questionId === "arm_circumference"
        ? value < 21 ? "mac_lt_21" : value < 22 ? "mac_21_lt_22" : "mac_gte_22"
        : value < 31 ? "calf_lt_31" : "calf_gte_31";
    if (answer.value !== expected) return { kind: "interval_mismatch", field: fields[0], questionId };
  }
  if (answers.protein_intake?.state === "answered") {
    const expected = fullMnaProteinChoice(context);
    if (!expected) {
      const field = FULL_MNA_PROTEIN_FIELDS.find((field) => !["yes", "no"].includes(context[field.key]))!;
      return { kind: "missing_protein", field: field.key, questionId: "protein_intake" };
    }
    if (answers.protein_intake.value !== expected) return { kind: "protein_mismatch", field: "protein_intake", questionId: "protein_intake" };
  }
  return null;
}

export function fullMnaIssueText(issue: FullMnaInputIssue) {
  if (issue.kind === "invalid_measurement") return "請輸入範圍內的實測值，最多一位小數。";
  if (issue.kind === "missing_measurement") return "本題已作答，請補上對應的實測值，或將本題改為待答。";
  if (issue.kind === "interval_mismatch") return "本題選項與實測值不一致，請核對區間；完整版本 BMI 與小腿圍分別計分。";
  if (issue.kind === "missing_protein") return "請完成 K 題三個子回答，或將本題改為待答。";
  return "K 題選項與三個子回答的「是」數量不一致，請核對。";
}
