export const BLOOD_GLUCOSE_MEAL_CONTEXTS = [
  "fasting", "pre_meal", "post_meal", "random",
] as const;

export const BLOOD_GLUCOSE_UNITS = ["mg/dL", "mmol/L"] as const;

export type BloodGlucoseMealContext =
  (typeof BLOOD_GLUCOSE_MEAL_CONTEXTS)[number];
export type BloodGlucoseUnit = (typeof BLOOD_GLUCOSE_UNITS)[number];
