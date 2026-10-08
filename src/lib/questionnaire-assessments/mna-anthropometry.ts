import type { QuestionnaireAnswer } from "./types";

const measurementBounds = {
  height_cm: { min: 50, max: 240 },
  weight_kg: { min: 20, max: 300 },
  calf_circumference_cm: { min: 10, max: 80 },
} as const;

export type MnaMeasurementKey = keyof typeof measurementBounds;

export type MnaAnthropometryIssue =
  | { kind: "invalid_measurement"; field: MnaMeasurementKey }
  | { kind: "missing_measurement"; field: MnaMeasurementKey }
  | { kind: "conflicting_measurement"; field: MnaMeasurementKey }
  | { kind: "interval_mismatch"; field: "anthropometry" };

/** The same measurement and answer consistency rule applies to draft UI and API writes. */
export function validateMnaAnthropometry(
  context: Readonly<Record<string, string>>,
  answer: QuestionnaireAnswer | undefined,
): MnaAnthropometryIssue | null {
  for (const [field, bounds] of Object.entries(measurementBounds) as
    [MnaMeasurementKey, { min: number; max: number }][]) {
    if (!Object.hasOwn(context, field)) continue;
    const raw = context[field];
    if (!/^\d{1,3}(?:\.\d)?$/u.test(raw)) return { kind: "invalid_measurement", field };
    const value = Number(raw);
    if (value < bounds.min || value > bounds.max) return { kind: "invalid_measurement", field };
  }

  if (answer?.state !== "answered") return null;

  if (answer.value.startsWith("bmi_")) {
    if (!context.height_cm) return { kind: "missing_measurement", field: "height_cm" };
    if (!context.weight_kg) return { kind: "missing_measurement", field: "weight_kg" };
    if (context.calf_circumference_cm) return { kind: "conflicting_measurement", field: "calf_circumference_cm" };
    const bmi = Number(context.weight_kg) / ((Number(context.height_cm) / 100) ** 2);
    if (
      (answer.value === "bmi_lt_19" && bmi >= 19) ||
      (answer.value === "bmi_19_lt_21" && (bmi < 19 || bmi >= 21)) ||
      (answer.value === "bmi_21_lt_23" && (bmi < 21 || bmi >= 23)) ||
      (answer.value === "bmi_gte_23" && bmi < 23)
    ) return { kind: "interval_mismatch", field: "anthropometry" };
    return null;
  }

  if (!context.calf_circumference_cm) return { kind: "missing_measurement", field: "calf_circumference_cm" };
  if (context.height_cm) return { kind: "conflicting_measurement", field: "height_cm" };
  if (context.weight_kg) return { kind: "conflicting_measurement", field: "weight_kg" };
  const calf = Number(context.calf_circumference_cm);
  if (
    (answer.value === "calf_lt_31" && calf >= 31) ||
    (answer.value === "calf_gte_31" && calf < 31)
  ) return { kind: "interval_mismatch", field: "anthropometry" };
  return null;
}
