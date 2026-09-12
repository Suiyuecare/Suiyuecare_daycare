import { describe, expect, it } from "vitest";
import { careDiaryDataSchema, diaryActionSchema, diaryObservationsSchema, observationsFromForm } from "./schema";
const unknown = { state: "unknown" };
const observations = { meal: unknown, water: unknown, toileting: unknown, activity: unknown };
describe("care diary structured observations", () => {
  it("preserves legacy create fields without inventing observations", () => {
    expect(careDiaryDataSchema.parse({ shift: "morning", care_item: "本次照顧", abnormal: false })).toEqual({ shift: "morning", care_item: "本次照顧", note: "", abnormal: false });
  });
  it("distinguishes zero, unknown, and not applicable", () => {
    const value = { ...observations, water: { state: "observed", value: 0 }, toileting: { state: "not_applicable" } };
    expect(diaryObservationsSchema.parse(value)).toEqual(value);
  });
  it.each([-1, 5001, 2.5, "100", null])("rejects invalid observed water %s", (value) => {
    expect(diaryObservationsSchema.safeParse({ ...observations, water: { state: "observed", value } }).success).toBe(false);
  });
  it("never allows unknown to retain previous observed values", () => {
    expect(diaryObservationsSchema.safeParse({ ...observations, meal: { state: "unknown", value: "all" } }).success).toBe(false);
    expect(diaryObservationsSchema.safeParse({ ...observations, activity: { state: "not_applicable", value: "participated" } }).success).toBe(false);
  });
  it("blank form records unknown rather than all normal", () => expect(observationsFromForm(new FormData())).toEqual(observations));
  it.each(["", " ", "\t\n"])("rejects observed water with blank input %j instead of inventing zero", (value) => {
    const form = new FormData(); form.set("water_state", "observed"); form.set("water", value);
    expect(() => observationsFromForm(form)).toThrow();
  });
  it("preserves explicitly entered observed zero", () => {
    const form = new FormData(); form.set("water_state", "observed"); form.set("water", "0");
    expect(observationsFromForm(form).water).toEqual({ state: "observed", value: 0 });
  });
  it("sign requires explicit confirmation and optimistic version", () => {
    expect(diaryActionSchema.safeParse({ action: "sign", base_version: 2 }).success).toBe(false);
    expect(diaryActionSchema.safeParse({ action: "sign", base_version: 2, confirmed: true }).success).toBe(true);
    expect(diaryActionSchema.safeParse({ action: "edit", base_version: 0, data: {} }).success).toBe(false);
  });
  it("correction requires a reason and cannot carry arbitrary cloned observations or signature", () => {
    expect(diaryActionSchema.safeParse({ action: "correct", base_version: 1, reason: " " }).success).toBe(false);
    expect(diaryActionSchema.safeParse({ action: "correct", base_version: 1, reason: "補充同一次觀察", signed_by: "forged" }).success).toBe(false);
  });
});
