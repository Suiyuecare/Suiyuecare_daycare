import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildQuestionnaireRuleCatalogEntry, canonicalRuleJson } from "./rule-catalog";
import type { QuestionnaireFormKey } from "./types";
import { buildQuestionnaireValidationCatalogEntry } from "./validation-catalog";
import { evaluateQuestionnaireValidationCandidate } from "./validation-evaluator";

function fixture(key: QuestionnaireFormKey) {
  const scoring = buildQuestionnaireRuleCatalogEntry(key);
  const validation = buildQuestionnaireValidationCatalogEntry(key);
  const answers: Record<string, unknown> = Object.fromEntries(scoring.manifest.rules.items.map((item) =>
    [item.id, { state: "answered", value: item.choices[0]!.value }]));
  return { scoring, validation, answers };
}

describe("independent validation candidate adversarial proofs", () => {
  it.each(["answers", "answer", "context"] as const)("never invokes a getter at the %s input boundary", (boundary) => {
    const { validation, scoring, answers } = fixture("bsrs5");
    const getter = vi.fn(() => { throw new Error("Untrusted getter must never run"); });
    let input: unknown = answers;
    let context: unknown = {};
    if (boundary === "answers") {
      input = Object.defineProperty({ ...answers }, "bsrs_01", { enumerable: true, get: getter });
    } else if (boundary === "answer") {
      input = { ...answers, bsrs_01: Object.defineProperty({}, "state", { enumerable: true, get: getter }) };
    } else {
      context = Object.defineProperty({}, "qualitative_note", { enumerable: true, get: getter });
    }
    const result = evaluateQuestionnaireValidationCandidate(validation, scoring, input, context);
    expect(getter).not.toHaveBeenCalled();
    expect(result).toMatchObject({ candidateOnly: true, storageValid: false, status: "invalid", score: null,
      classification: null });
  });

  it("accepts actual own JSON data on null-prototype records, not inherited answers", () => {
    const { validation, scoring, answers } = fixture("gds_15");
    const own = Object.assign(Object.create(null), answers);
    expect(evaluateQuestionnaireValidationCandidate(validation, scoring, own, Object.create(null)))
      .toMatchObject({ storageValid: true, status: "complete" });
    expect(evaluateQuestionnaireValidationCandidate(validation, scoring, Object.create(answers), {}))
      .toMatchObject({ storageValid: false, status: "invalid", score: null });
  });

  it.each(["__proto__", "constructor", "toString"])("rejects special own unknown key %s without copying or echoing it", (key) => {
    const { validation, scoring, answers } = fixture("bsrs5");
    const extra = Object.assign(Object.create(null), answers);
    Object.defineProperty(extra, key, { enumerable: true, value: { state: "answered", value: "secret synthetic value" } });
    const result = evaluateQuestionnaireValidationCandidate(validation, scoring, extra, {});
    expect(result).toMatchObject({ storageValid: false, status: "invalid", score: null });
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "UNKNOWN_ANSWER", path: "answers" })]));
    expect(JSON.stringify(result)).not.toContain("secret synthetic value");
    expect(result.issues.some(({ path }) => path.includes(key))).toBe(false);
    expect(Object.getPrototypeOf(extra)).toBeNull();
  });

  it("rejects symbol/non-enumerable input data and preserves BSRS safety with an invalid ordinary context", () => {
    const { validation, scoring, answers } = fixture("bsrs5");
    for (const input of [{ ...answers, [Symbol("unknown")]: "synthetic" },
      Object.defineProperty({ ...answers }, "extra", { value: "synthetic" })]) {
      expect(evaluateQuestionnaireValidationCandidate(validation, scoring, input, {}))
        .toMatchObject({ storageValid: false, status: "invalid", score: null });
    }
    const result = evaluateQuestionnaireValidationCandidate(validation, scoring,
      { ...answers, bsrs_suicide: { state: "answered", value: "4" } }, { qualitative_note: 7 });
    expect(result).toMatchObject({ storageValid: false, status: "invalid", score: null, classification: null });
    expect(result.alerts).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "BSRS_SUICIDE_PROFESSIONAL_REVIEW", requiresAcknowledgement: true })]));
  });

  it("rejects both unbound and deliberately rehashed policy tampering without changing the registered candidates", () => {
    const { validation, scoring, answers } = fixture("mna_sf");
    const pristine = structuredClone(validation);
    const altered = structuredClone(validation);
    if (!altered.manifest.measurement) throw new Error("Synthetic MNA fixture requires measurements");
    Object.assign(altered.manifest.measurement.bmiBands[0]!, { maxExclusive: 20 });
    expect(() => evaluateQuestionnaireValidationCandidate(altered, scoring, answers, { height_cm: "200", weight_kg: "70" }))
      .toThrow("Invalid questionnaire validation candidate binding");
    const canonicalJson = canonicalRuleJson(altered.manifest);
    const rehashed = { ...altered, canonicalJson,
      validationCatalogHash: createHash("sha256").update(canonicalJson, "utf8").digest("hex") };
    expect(() => evaluateQuestionnaireValidationCandidate(rehashed, scoring, answers, { height_cm: "200", weight_kg: "70" }))
      .toThrow("Unsupported questionnaire validation candidate");
    expect(buildQuestionnaireValidationCatalogEntry("mna_sf")).toEqual(pristine);
  });

  it.each([
    ["76", "bmi_19_lt_21", "bmi_lt_19"],
    ["84", "bmi_21_lt_23", "bmi_19_lt_21"],
    ["92", "bmi_gte_23", "bmi_21_lt_23"],
  ])("classifies exact BMI threshold at height 200 / weight %s without display rounding", (weight, validBand, wrongBand) => {
    const { validation, scoring, answers } = fixture("mna_sf");
    const context = { height_cm: "200.0", weight_kg: `${weight}.0` };
    expect(evaluateQuestionnaireValidationCandidate(validation, scoring,
      { ...answers, anthropometry: { state: "answered", value: validBand } }, context))
      .toMatchObject({ storageValid: true, status: "complete" });
    expect(evaluateQuestionnaireValidationCandidate(validation, scoring,
      { ...answers, anthropometry: { state: "answered", value: wrongBand } }, context))
      .toMatchObject({ storageValid: false, status: "incomplete", score: null, classification: null });
  });

  it("keeps calf 31 exact and rejects numeric strings with trailing controls or non-wire precision", () => {
    const { validation, scoring, answers } = fixture("mna_sf");
    const calfAnswers = { ...answers, anthropometry: { state: "answered", value: "calf_gte_31" } };
    expect(evaluateQuestionnaireValidationCandidate(validation, scoring, calfAnswers, { calf_circumference_cm: "31.0" }))
      .toMatchObject({ storageValid: true, status: "complete" });
    expect(evaluateQuestionnaireValidationCandidate(validation, scoring, calfAnswers, { calf_circumference_cm: "30.9" }))
      .toMatchObject({ storageValid: false, status: "incomplete", score: null });
    for (const value of ["31\n", "31\r", "31\r\n", "31\t", "31.00", "3.1e1", "31 ", " 31"]) {
      expect(evaluateQuestionnaireValidationCandidate(validation, scoring, calfAnswers, { calf_circumference_cm: value }))
        .toMatchObject({ storageValid: false, status: "invalid", score: null });
    }
  });

  it("allows inactive anthropometry's partial DB draft measurements without pretending completion", () => {
    const { validation, scoring, answers } = fixture("mna_sf");
    for (const state of [{ state: "missing" }, { state: "not_applicable", reason: "合成原因" }]) {
      expect(evaluateQuestionnaireValidationCandidate(validation, scoring,
        { ...answers, anthropometry: state }, { height_cm: "170", calf_circumference_cm: "31" }))
        .toMatchObject({ storageValid: true, status: "incomplete", score: null, classification: null });
    }
  });

  it("returns detached result data; a caller cannot mutate future score or independent alerts", () => {
    const { validation, scoring, answers } = fixture("bsrs5");
    const input = { ...answers, bsrs_suicide: { state: "answered", value: "2" } };
    const pristine = evaluateQuestionnaireValidationCandidate(validation, scoring, input, {});
    const returned = evaluateQuestionnaireValidationCandidate(validation, scoring, input, {});
    Object.assign(returned.alerts[0]!, { code: "mutated" });
    if (returned.score) Object.assign(returned.score, { raw: 900 });
    expect(evaluateQuestionnaireValidationCandidate(validation, scoring, input, {})).toEqual(pristine);
  });

  it("rejects NUL and unpaired surrogate text that PostgreSQL JSON cannot represent", () => {
    const { validation, scoring, answers } = fixture("barthel_adl");
    for (const value of ["synthetic\u0000note", "\ud800", "\udfff"]) {
      expect(evaluateQuestionnaireValidationCandidate(validation, scoring, answers, { qualitative_note: value }))
        .toMatchObject({ status: "invalid", storageValid: false, score: null });
      expect(evaluateQuestionnaireValidationCandidate(validation, scoring,
        { ...answers, feeding: { state: "not_applicable", reason: value } }, {}))
        .toMatchObject({ status: "invalid", storageValid: false, score: null });
    }
  });
});
