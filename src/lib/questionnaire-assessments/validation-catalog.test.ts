import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { QUESTIONNAIRE_FORMS } from "./forms";
import { buildQuestionnaireRuleCatalogEntry, canonicalRuleJson } from "./rule-catalog";
import type { QuestionnaireFormKey } from "./types";
import { buildQuestionnaireValidationCatalogEntry } from "./validation-catalog";

const keys = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];
const naForms = ["barthel_adl", "lawton_iadl", "fall_risk_taipei_115", "nsi_determine", "mna_sf"];
// Frozen candidate specification only, not a clinical review or activation.
// Changing these semantics requires a new validationVersion, not editing v1.
const validationV1Hashes: Record<QuestionnaireFormKey, string> = {
  spmsq: "311e945499208ce8574415468a2df6b592502a310208acf617f71e7cb96c3151",
  gds_15: "e39a30acea3b11b4c561e8d66e14a0044c35c8c8ed1c866351d8867d5e1a3e3a",
  barthel_adl: "3978abe1e0a209896d261a09f392f0907556f7130e23f2c30b8584121841751a",
  lawton_iadl: "910434cd939bfb5c5d1b0ac18f9ea9b344b949445b69f80f12dde8de63ed918f",
  eat10_swallowing: "cdc01d3d83b2b21bcc4a4aaa31948a027016af5fa64f3bd6a5129252ed0e0bb2",
  bsrs5: "bb7206d4c88f04e3402464c148040890148925362a5f78c66bde9a6f0594152c",
  fall_risk_taipei_115: "7254766dba7af1849331a19086a41c98faf8cf224e97809ba8696ee715bc918e",
  nsi_determine: "baae842466cef755164ab41a4988bcaef831faa0bd476a50bf33e9c38dc35e84",
  mna_sf: "b07b2992d707d254375b9746f0d91b266de481fb4d6fc9d237336dfad823b512",
};

describe("candidate-only versioned database draft-wire validation catalog", () => {
  it.each(keys)("links %s to the exact unchanged scoring manifest with no adoption or activation", (key) => {
    const scoring = buildQuestionnaireRuleCatalogEntry(key);
    const entry = buildQuestionnaireValidationCatalogEntry(key);
    const manifest = entry.manifest;
    expect(manifest).toMatchObject({ schemaVersion: "questionnaire-validation-catalog.v1", candidateOnly: true,
      validationBoundary: "database-draft-wire", formKey: key, formVersion: scoring.formVersion,
      ruleVersion: scoring.ruleVersion, scoringCatalogHash: scoring.catalogHash });
    expect(entry.canonicalJson).toBe(canonicalRuleJson(manifest));
    expect(entry.validationCatalogHash).toBe(createHash("sha256").update(entry.canonicalJson, "utf8").digest("hex"));
    expect(entry.validationCatalogHash).toBe(validationV1Hashes[key]);
    expect(manifest.validationVersion).toBe(`${key}-structure-v1`);
    expect(entry.validationCatalogHash).not.toBe(scoring.catalogHash);
    expect(buildQuestionnaireValidationCatalogEntry(key)).toEqual(entry);
    expect(manifest.exactQuestionIds).toEqual(scoring.manifest.rules.items.map(({ id }) => id));
    expect(manifest.items.map(({ id, allowedValues }) => ({ id, allowedValues }))).toEqual(
      scoring.manifest.rules.items.map(({ id, choices }) => ({ id, allowedValues: choices.map(({ value }) => value) })));
    expect(manifest.items.every(({ missing, notApplicable }) => missing.draftAllowed && !missing.completeAllowed &&
      notApplicable.draftAllowed === naForms.includes(key) && !notApplicable.completeAllowed)).toBe(true);
    expect(manifest.wire).toEqual({ unknownKeys: "reject", coercion: "none", answerStateProperties: {
      answered: ["state", "value"], missing: ["state"], not_applicable: ["state", "reason"],
    } });
    expect(manifest.resultPolicy).toEqual({ storageValidity: "independent-of-completeness",
      statusPrecedence: ["invalid", "incomplete", "complete"], invalidScore: null, incompleteScore: null,
      preserveIndependentAnswerAlerts: true });
    expect(entry.canonicalJson).not.toMatch(/approvedBy|approvedAt|signedBy|activatedAt/u);
  });

  it("preserves every checked-in scoring v1 byte/hash and does not reinterpret draft policy as HTTP preprocessing", () => {
    const sql = readFileSync("supabase/migrations/20260926045916_register_questionnaire_rule_candidates.sql", "utf8");
    const rows = [...sql.matchAll(/^ \('([^']+)','([^']+)','([^']+)',([0-9]+),'([a-f0-9]{64})',\$questionnaire_catalog\$(.*?)\$questionnaire_catalog\$\)/gmu)];
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      const key = row[1] as QuestionnaireFormKey;
      buildQuestionnaireValidationCatalogEntry(key);
      const original = buildQuestionnaireRuleCatalogEntry(key);
      expect(original.catalogHash).toBe(row[5]); expect(original.canonicalJson).toBe(row[6]);
    }
    expect(buildQuestionnaireValidationCatalogEntry("mna_sf").manifest.items.every(({ notApplicable }) => notApplicable.draftAllowed)).toBe(true);
  });

  it("does not share nested validation state, scoring state, or the live form registry", () => {
    const first = buildQuestionnaireValidationCatalogEntry("mna_sf");
    const pristine = buildQuestionnaireValidationCatalogEntry("mna_sf");
    const mutated = JSON.parse(first.canonicalJson);
    mutated.items[0].allowedValues[0] = "synthetic mutation";
    mutated.context[1].minTenths = -1;
    mutated.measurement.bmiBands[0].maxExclusive = 20;
    expect(createHash("sha256").update(canonicalRuleJson(mutated)).digest("hex")).not.toBe(first.validationCatalogHash);
    expect(buildQuestionnaireValidationCatalogEntry("mna_sf")).toEqual(pristine);
    expect(QUESTIONNAIRE_FORMS.mna_sf.questions[0]!.choices[0]!.value).toBe("severe_decrease");
  });

  it("freezes code-point text limits, exact ASCII trim and PostgreSQL control classes without Unicode trim", () => {
    const manifest = buildQuestionnaireValidationCatalogEntry("barthel_adl").manifest;
    expect(manifest.items[0]!.notApplicable.reason).toEqual({ minCodePoints: 1, maxCodePoints: 500,
      trim: "ascii-space", charClass: "postgres-posix-cntrl", allowControls: ["LF", "CR", "TAB"],
      rejectControlRanges: [[0, 8], [11, 12], [14, 31], [127, 159]] });
    const note = manifest.context.find(({ key }) => key === "qualitative_note");
    expect(note).toMatchObject({ kind: "text", requiredForStorage: false, requiredForCompletion: false,
      validation: { maxCodePoints: 3000, trim: "ascii-space" } });
  });

  it("seals every issue category and storage/completion boundary into the new hash", () => {
    const entry = buildQuestionnaireValidationCatalogEntry("mna_sf");
    expect(entry.manifest.issueRules.map(({ trigger, code, category, blocksStorage, blocksCompletion }) =>
      [trigger, code, category, blocksStorage, blocksCompletion])).toEqual([
      ["invalid_answers_container", "INVALID_INPUT", "invalid", true, true],
      ["invalid_context_container", "INVALID_INPUT", "invalid", true, true],
      ["unknown_answer", "UNKNOWN_ANSWER", "invalid", true, true],
      ["missing_answer_key", "MISSING_REQUIRED_ANSWER", "incomplete", true, true],
      ["missing_answer_state", "MISSING_REQUIRED_ANSWER", "incomplete", false, true],
      ["malformed_answer", "INVALID_ANSWER", "invalid", true, true],
      ["invalid_na_reason", "INVALID_ANSWER", "invalid", true, true],
      ["unsupported_na", "NOT_APPLICABLE_ANSWER", "invalid", true, true],
      ["allowed_na", "NOT_APPLICABLE_ANSWER", "incomplete", false, true],
      ["unknown_context", "UNKNOWN_CONTEXT", "invalid", true, true],
      ["missing_storage_context", "MISSING_REQUIRED_CONTEXT", "incomplete", true, true],
      ["missing_completion_context", "MISSING_REQUIRED_CONTEXT", "incomplete", false, true],
      ["invalid_context", "INVALID_CONTEXT", "invalid", true, true],
      ["measurement_required", "MEASUREMENT_REQUIRED", "incomplete", true, true],
      ["measurement_conflict", "MEASUREMENT_CONFLICT", "incomplete", true, true],
      ["measurement_mismatch", "MEASUREMENT_MISMATCH", "incomplete", true, true],
    ]);
    const changed = JSON.parse(entry.canonicalJson);
    changed.issueRules[0].blocksStorage = false;
    expect(createHash("sha256").update(canonicalRuleJson(changed)).digest("hex")).not.toBe(entry.validationCatalogHash);
  });

  it("keeps SPMSQ education completion-only and all measurement evidence independently versioned", () => {
    const education = buildQuestionnaireValidationCatalogEntry("spmsq").manifest.context.find(({ key }) => key === "education_adjustment");
    expect(education).toEqual({ key: "education_adjustment", kind: "enum", requiredForStorage: false,
      requiredForCompletion: true, allowedValues: ["grade_school_or_less", "middle_or_high_school", "beyond_high_school"] });
    for (const key of keys.filter((key) => key !== "mna_sf")) {
      expect(buildQuestionnaireValidationCatalogEntry(key).manifest.measurement).toBeNull();
    }
    const mna = buildQuestionnaireValidationCatalogEntry("mna_sf").manifest;
    expect(mna.context.filter(({ kind }) => kind === "decimalString")).toEqual([
      { key: "height_cm", kind: "decimalString", requiredForStorage: false, requiredForCompletion: false,
        pattern: "^([0-9]{1,3})(\\.[0-9])?$", maxIntegerDigits: 3, maxFractionDigits: 1, unit: "cm", minTenths: 500, maxTenths: 2400 },
      { key: "weight_kg", kind: "decimalString", requiredForStorage: false, requiredForCompletion: false,
        pattern: "^([0-9]{1,3})(\\.[0-9])?$", maxIntegerDigits: 3, maxFractionDigits: 1, unit: "kg", minTenths: 200, maxTenths: 3000 },
      { key: "calf_circumference_cm", kind: "decimalString", requiredForStorage: false, requiredForCompletion: false,
        pattern: "^([0-9]{1,3})(\\.[0-9])?$", maxIntegerDigits: 3, maxFractionDigits: 1, unit: "cm", minTenths: 100, maxTenths: 800 },
    ]);
    expect(mna.measurement).toEqual({ answerId: "anthropometry", comparison: "integer-tenths-cross-product",
      bmiNumeratorMultiplier: 100000, rounding: "none",
      bmiBands: [{ value: "bmi_lt_19", minInclusive: null, maxExclusive: 19 },
        { value: "bmi_19_lt_21", minInclusive: 19, maxExclusive: 21 },
        { value: "bmi_21_lt_23", minInclusive: 21, maxExclusive: 23 },
        { value: "bmi_gte_23", minInclusive: 23, maxExclusive: null }],
      calfBands: [{ value: "calf_lt_31", minInclusive: null, maxExclusive: 310 },
        { value: "calf_gte_31", minInclusive: 310, maxExclusive: null }],
      paths: { bmi: { requiredKeys: ["height_cm", "weight_kg"], forbiddenKeys: ["calf_circumference_cm"] },
        calf: { requiredKeys: ["calf_circumference_cm"], forbiddenKeys: ["height_cm", "weight_kg"] } } });
  });
});
