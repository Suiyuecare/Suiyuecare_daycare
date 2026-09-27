import type { QuestionnaireRuleCatalogEntry } from "./rule-manifest";
import type { QuestionnaireFormKey } from "./types";
import type {
  QuestionnaireValidationCatalogManifest,
  QuestionnaireValidationContext,
  QuestionnaireValidationMeasurementContract,
  QuestionnaireValidationTextContract,
} from "./validation-types";

function textContract(maxCodePoints: 500 | 3000): QuestionnaireValidationTextContract {
  return {
    minCodePoints: 1, maxCodePoints, trim: "ascii-space", charClass: "postgres-posix-cntrl",
    allowControls: ["LF", "CR", "TAB"],
    // Matches the existing SQL after removing LF/CR/TAB. Confirmed against
    // isolated PGlite POSIX cntrl, including U+0085/U+009F, not JS Unicode trim.
    rejectControlRanges: [[0, 8], [11, 12], [14, 31], [127, 159]],
  };
}

function mnaMeasurement(): QuestionnaireValidationMeasurementContract {
  return {
    answerId: "anthropometry", comparison: "integer-tenths-cross-product", bmiNumeratorMultiplier: 100000,
    bmiBands: [
      { value: "bmi_lt_19", minInclusive: null, maxExclusive: 19 },
      { value: "bmi_19_lt_21", minInclusive: 19, maxExclusive: 21 },
      { value: "bmi_21_lt_23", minInclusive: 21, maxExclusive: 23 },
      { value: "bmi_gte_23", minInclusive: 23, maxExclusive: null },
    ],
    calfBands: [
      { value: "calf_lt_31", minInclusive: null, maxExclusive: 310 },
      { value: "calf_gte_31", minInclusive: 310, maxExclusive: null },
    ],
    paths: {
      bmi: { requiredKeys: ["height_cm", "weight_kg"], forbiddenKeys: ["calf_circumference_cm"] },
      calf: { requiredKeys: ["calf_circumference_cm"], forbiddenKeys: ["height_cm", "weight_kg"] },
    },
    rounding: "none",
  };
}

/**
 * Freezes only the existing database draft-wire structure as a new candidate.
 * Does not amend v1 scoring catalogs, adopt rules, supply source evidence,
 * authorize storage/signing, or make the existing HTTP preprocessing identical.
 */
export function buildQuestionnaireValidationManifest(formKey: QuestionnaireFormKey, scoring: QuestionnaireRuleCatalogEntry): QuestionnaireValidationCatalogManifest {
  if (scoring.manifest.rules.items.some(({ required, allowNotApplicable }) => !required || allowNotApplicable)) {
    throw new Error("Validation candidate completeness differs from the frozen scoring catalog.");
  }
  const context: QuestionnaireValidationContext[] = [];
  if (formKey === "spmsq") {
    const education = scoring.manifest.rules.context.find(({ id }) => id === "education_adjustment");
    if (!education || !education.required || scoring.manifest.rules.context.length !== 1) {
      throw new Error("Validation candidate education context differs from the frozen scoring catalog.");
    }
    context.push({ key: education.id, kind: "enum", requiredForStorage: false,
      requiredForCompletion: true, allowedValues: [...education.choices] });
  } else if (scoring.manifest.rules.context.length !== 0) {
    throw new Error("Validation candidate has an unregistered scoring context.");
  }
  if (!scoring.manifest.form.allowQualitativeNotes) {
    throw new Error("Validation candidate qualitative context differs from the registered database drafts.");
  }
  context.push({ key: "qualitative_note", kind: "text", requiredForStorage: false,
    requiredForCompletion: false, validation: textContract(3000) });
  if (formKey === "mna_sf") {
    const measurementKeys = scoring.manifest.form.measurementFields?.map(({ key }) => key).sort();
    if (JSON.stringify(measurementKeys) !== JSON.stringify(["calf_circumference_cm", "height_cm", "weight_kg"])) {
      throw new Error("Validation candidate measurements differ from the frozen questionnaire.");
    }
    context.push(
      { key: "height_cm", kind: "decimalString", requiredForStorage: false, requiredForCompletion: false,
        pattern: "^([0-9]{1,3})(\\.[0-9])?$", maxIntegerDigits: 3, maxFractionDigits: 1,
        unit: "cm", minTenths: 500, maxTenths: 2400 },
      { key: "weight_kg", kind: "decimalString", requiredForStorage: false, requiredForCompletion: false,
        pattern: "^([0-9]{1,3})(\\.[0-9])?$", maxIntegerDigits: 3, maxFractionDigits: 1,
        unit: "kg", minTenths: 200, maxTenths: 3000 },
      { key: "calf_circumference_cm", kind: "decimalString", requiredForStorage: false, requiredForCompletion: false,
        pattern: "^([0-9]{1,3})(\\.[0-9])?$", maxIntegerDigits: 3, maxFractionDigits: 1,
        unit: "cm", minTenths: 100, maxTenths: 800 },
    );
  }
  // Preserve the existing DB storage policy; none of the nine score catalogs
  // treats missing or N/A as a complete answer or silently assigns zero points.
  const draftAllowsNotApplicable = !["spmsq", "gds_15", "eat10_swallowing", "bsrs5"].includes(formKey);
  const manifest: QuestionnaireValidationCatalogManifest = {
    schemaVersion: "questionnaire-validation-catalog.v1", candidateOnly: true,
    validationBoundary: "database-draft-wire", validationVersion: `${formKey}-structure-v1`,
    formKey, formVersion: scoring.formVersion, ruleVersion: scoring.ruleVersion, scoringCatalogHash: scoring.catalogHash,
    wire: { unknownKeys: "reject", coercion: "none", answerStateProperties: {
      answered: ["state", "value"], missing: ["state"], not_applicable: ["state", "reason"],
    } },
    exactQuestionIds: scoring.manifest.rules.items.map(({ id }) => id),
    items: scoring.manifest.rules.items.map(({ id, choices }) => ({
      id, allowedValues: choices.map(({ value }) => value),
      missing: { draftAllowed: true, completeAllowed: false },
      notApplicable: { draftAllowed: draftAllowsNotApplicable, completeAllowed: false, reason: textContract(500) },
    })),
    context, measurement: formKey === "mna_sf" ? mnaMeasurement() : null,
    issueRules: [
      { trigger: "invalid_answers_container", code: "INVALID_INPUT", category: "invalid", blocksStorage: true, blocksCompletion: true },
      { trigger: "invalid_context_container", code: "INVALID_INPUT", category: "invalid", blocksStorage: true, blocksCompletion: true },
      { trigger: "unknown_answer", code: "UNKNOWN_ANSWER", category: "invalid", blocksStorage: true, blocksCompletion: true },
      { trigger: "missing_answer_key", code: "MISSING_REQUIRED_ANSWER", category: "incomplete", blocksStorage: true, blocksCompletion: true },
      { trigger: "missing_answer_state", code: "MISSING_REQUIRED_ANSWER", category: "incomplete", blocksStorage: false, blocksCompletion: true },
      { trigger: "malformed_answer", code: "INVALID_ANSWER", category: "invalid", blocksStorage: true, blocksCompletion: true },
      { trigger: "invalid_na_reason", code: "INVALID_ANSWER", category: "invalid", blocksStorage: true, blocksCompletion: true },
      { trigger: "unsupported_na", code: "NOT_APPLICABLE_ANSWER", category: "invalid", blocksStorage: true, blocksCompletion: true },
      { trigger: "allowed_na", code: "NOT_APPLICABLE_ANSWER", category: "incomplete", blocksStorage: false, blocksCompletion: true },
      { trigger: "unknown_context", code: "UNKNOWN_CONTEXT", category: "invalid", blocksStorage: true, blocksCompletion: true },
      { trigger: "missing_storage_context", code: "MISSING_REQUIRED_CONTEXT", category: "incomplete", blocksStorage: true, blocksCompletion: true },
      { trigger: "missing_completion_context", code: "MISSING_REQUIRED_CONTEXT", category: "incomplete", blocksStorage: false, blocksCompletion: true },
      { trigger: "invalid_context", code: "INVALID_CONTEXT", category: "invalid", blocksStorage: true, blocksCompletion: true },
      { trigger: "measurement_required", code: "MEASUREMENT_REQUIRED", category: "incomplete", blocksStorage: true, blocksCompletion: true },
      { trigger: "measurement_conflict", code: "MEASUREMENT_CONFLICT", category: "incomplete", blocksStorage: true, blocksCompletion: true },
      { trigger: "measurement_mismatch", code: "MEASUREMENT_MISMATCH", category: "incomplete", blocksStorage: true, blocksCompletion: true },
    ],
    resultPolicy: { storageValidity: "independent-of-completeness", statusPrecedence: ["invalid", "incomplete", "complete"],
      invalidScore: null, incompleteScore: null, preserveIndependentAnswerAlerts: true },
  };
  return manifest;
}
