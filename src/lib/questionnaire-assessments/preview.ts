import { scoreAssessment } from "@/lib/assessments/engine";
import type { AssessmentAnswers } from "@/lib/assessments/types";
import type { QuestionnaireAnswers, QuestionnaireFormDefinition } from "./types";

export function mnaMeasurementIssue(answers: QuestionnaireAnswers, context: Readonly<Record<string, string>>): string | null {
  const measurement = answers.anthropometry;
  if (measurement?.state !== "answered") return null;
  const value = measurement.value;
  const fields = ["height_cm", "weight_kg", "calf_circumference_cm"];
  const present = fields.filter((key) => context[key]);
  for (const key of present) {
    const text = context[key]!;
    const range = key === "height_cm" ? [50, 240] : key === "weight_kg" ? [20, 300] : [10, 80];
    if (!/^\d{1,3}(?:\.\d)?$/u.test(text) || Number(text) < range[0]! || Number(text) > range[1]!) return "請確認身高、體重或小腿圍的實測值與單位。";
  }
  if (value.startsWith("bmi_")) {
    if (!context.height_cm || !context.weight_kg) return "選擇 BMI 區間前，請填寫實測身高與體重。";
    if (context.calf_circumference_cm) return "BMI 與小腿圍只能擇一；使用 BMI 時請清空小腿圍。";
    const bmi = Number(context.weight_kg) / ((Number(context.height_cm) / 100) ** 2);
    const valid = value === "bmi_lt_19" ? bmi < 19 : value === "bmi_19_lt_21" ? bmi >= 19 && bmi < 21
      : value === "bmi_21_lt_23" ? bmi >= 21 && bmi < 23 : value === "bmi_gte_23" && bmi >= 23;
    return valid ? null : "F 題的 BMI 區間與實測值不符，請核對後重新選擇。";
  }
  if (!context.calf_circumference_cm) return "改用小腿圍時，請填寫實測小腿圍。";
  if (context.height_cm || context.weight_kg) return "改用小腿圍時，請清空身高與體重；BMI 與小腿圍只能擇一。";
  const calf = Number(context.calf_circumference_cm);
  return (value === "calf_lt_31" && calf < 31) || (value === "calf_gte_31" && calf >= 31) ? null : "F 題的小腿圍區間與實測值不符，請核對後重新選擇。";
}

export function questionnairePreview(form: QuestionnaireFormDefinition, answers: QuestionnaireAnswers, context: Readonly<Record<string, string>>) {
  if (!form.scoreVersionId) return { result: null, measurementIssue: null };
  const scoringContext: Record<string, string> = form.key === "spmsq" && context.education_adjustment ? { education_adjustment: context.education_adjustment } : {};
  const result = scoreAssessment({ versionId: form.scoreVersionId, answers: answers as AssessmentAnswers, context: scoringContext });
  const measurementIssue = form.key === "mna_sf" ? mnaMeasurementIssue(answers, context) : null;
  // A measurement failure suppresses totals but must not downgrade invalid answers.
  return { result: measurementIssue ? { ...result,
    status: result.status === "invalid" ? "invalid" as const : "incomplete" as const,
    score: null, classification: null } : result, measurementIssue };
}
