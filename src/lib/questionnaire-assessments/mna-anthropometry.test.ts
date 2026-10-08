import { describe, expect, it } from "vitest";

import { validateMnaAnthropometry } from "./mna-anthropometry";

const answered = (value: string) => ({ state: "answered" as const, value });

describe("MNA-SF anthropometry draft validation", () => {
  it("accepts the existing BMI interval boundaries used by the API", () => {
    expect(validateMnaAnthropometry({ height_cm: "200", weight_kg: "75.9" }, answered("bmi_lt_19"))).toBeNull();
    expect(validateMnaAnthropometry({ height_cm: "200", weight_kg: "76" }, answered("bmi_19_lt_21"))).toBeNull();
    expect(validateMnaAnthropometry({ height_cm: "200", weight_kg: "84" }, answered("bmi_21_lt_23"))).toBeNull();
    expect(validateMnaAnthropometry({ height_cm: "200", weight_kg: "92" }, answered("bmi_gte_23"))).toBeNull();
  });

  it("rejects inconsistent BMI choices without changing the entered values", () => {
    const context = { height_cm: "160", weight_kg: "60" };
    expect(validateMnaAnthropometry(context, answered("bmi_lt_19")))
      .toEqual({ kind: "interval_mismatch", field: "anthropometry" });
    expect(context).toEqual({ height_cm: "160", weight_kg: "60" });
  });

  it("requires both measurements for BMI and excludes calf circumference", () => {
    expect(validateMnaAnthropometry({ weight_kg: "60" }, answered("bmi_gte_23")))
      .toEqual({ kind: "missing_measurement", field: "height_cm" });
    expect(validateMnaAnthropometry({ height_cm: "160" }, answered("bmi_gte_23")))
      .toEqual({ kind: "missing_measurement", field: "weight_kg" });
    expect(validateMnaAnthropometry({ height_cm: "160", weight_kg: "60", calf_circumference_cm: "31" }, answered("bmi_gte_23")))
      .toEqual({ kind: "conflicting_measurement", field: "calf_circumference_cm" });
  });

  it("accepts calf measurement at its existing 31 cm boundary and rejects a wrong choice", () => {
    expect(validateMnaAnthropometry({ calf_circumference_cm: "30.9" }, answered("calf_lt_31"))).toBeNull();
    expect(validateMnaAnthropometry({ calf_circumference_cm: "31" }, answered("calf_gte_31"))).toBeNull();
    expect(validateMnaAnthropometry({ calf_circumference_cm: "31" }, answered("calf_lt_31")))
      .toEqual({ kind: "interval_mismatch", field: "anthropometry" });
    expect(validateMnaAnthropometry({}, answered("calf_gte_31")))
      .toEqual({ kind: "missing_measurement", field: "calf_circumference_cm" });
    expect(validateMnaAnthropometry({ height_cm: "160", calf_circumference_cm: "31" }, answered("calf_gte_31")))
      .toEqual({ kind: "conflicting_measurement", field: "height_cm" });
  });

  it("checks supplied measurement format and physical ranges even while the question is unanswered", () => {
    expect(validateMnaAnthropometry({ height_cm: "49.9" }, { state: "missing" }))
      .toEqual({ kind: "invalid_measurement", field: "height_cm" });
    expect(validateMnaAnthropometry({ weight_kg: "20.00" }, { state: "missing" }))
      .toEqual({ kind: "invalid_measurement", field: "weight_kg" });
    expect(validateMnaAnthropometry({ calf_circumference_cm: "81" }, { state: "missing" }))
      .toEqual({ kind: "invalid_measurement", field: "calf_circumference_cm" });
  });
});
