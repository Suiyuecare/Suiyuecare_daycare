import type { QuestionnaireFormKey } from "./types";

/** Candidate data only: neither an adoption nor an authority to sign. */
export interface QuestionnaireValidationTextContract {
  readonly minCodePoints: 1;
  readonly maxCodePoints: 500 | 3000;
  readonly trim: "ascii-space";
  readonly charClass: "postgres-posix-cntrl";
  readonly allowControls: readonly ["LF", "CR", "TAB"];
  readonly rejectControlRanges: readonly (readonly [number, number])[];
}

interface ContextFieldBase {
  readonly key: string;
  readonly requiredForStorage: boolean;
  readonly requiredForCompletion: boolean;
}

export interface QuestionnaireValidationEnumContext extends ContextFieldBase {
  readonly kind: "enum";
  readonly allowedValues: readonly string[];
}

export interface QuestionnaireValidationTextContext extends ContextFieldBase {
  readonly kind: "text";
  readonly validation: QuestionnaireValidationTextContract;
}

export interface QuestionnaireValidationDecimalContext extends ContextFieldBase {
  readonly kind: "decimalString";
  readonly pattern: string;
  readonly maxIntegerDigits: 3;
  readonly maxFractionDigits: 1;
  readonly unit: "cm" | "kg";
  readonly minTenths: number;
  readonly maxTenths: number;
}

export type QuestionnaireValidationContext =
  | QuestionnaireValidationEnumContext
  | QuestionnaireValidationTextContext
  | QuestionnaireValidationDecimalContext;

export interface QuestionnaireValidationBand {
  readonly value: string;
  readonly minInclusive: number | null;
  readonly maxExclusive: number | null;
}

export interface QuestionnaireValidationMeasurementContract {
  readonly answerId: "anthropometry";
  readonly comparison: "integer-tenths-cross-product";
  readonly bmiNumeratorMultiplier: 100000;
  /** BMI thresholds; compare before any division or display rounding. */
  readonly bmiBands: readonly QuestionnaireValidationBand[];
  /** Calf thresholds are in tenths of a centimetre. */
  readonly calfBands: readonly QuestionnaireValidationBand[];
  readonly paths: {
    readonly bmi: { readonly requiredKeys: readonly string[]; readonly forbiddenKeys: readonly string[] };
    readonly calf: { readonly requiredKeys: readonly string[]; readonly forbiddenKeys: readonly string[] };
  };
  readonly rounding: "none";
}

export type QuestionnaireValidationIssueCode =
  | "INVALID_INPUT"
  | "UNKNOWN_ANSWER"
  | "MISSING_REQUIRED_ANSWER"
  | "INVALID_ANSWER"
  | "NOT_APPLICABLE_ANSWER"
  | "UNKNOWN_CONTEXT"
  | "MISSING_REQUIRED_CONTEXT"
  | "INVALID_CONTEXT"
  | "MEASUREMENT_REQUIRED"
  | "MEASUREMENT_CONFLICT"
  | "MEASUREMENT_MISMATCH";

export interface QuestionnaireValidationIssueRule {
  readonly trigger: string;
  readonly code: QuestionnaireValidationIssueCode;
  readonly category: "invalid" | "incomplete";
  readonly blocksStorage: boolean;
  readonly blocksCompletion: true;
}

export interface QuestionnaireValidationCatalogManifest {
  readonly schemaVersion: "questionnaire-validation-catalog.v1";
  readonly candidateOnly: true;
  /** Describes the immutable database draft JSON, not HTTP preprocessing. */
  readonly validationBoundary: "database-draft-wire";
  readonly validationVersion: string;
  readonly formKey: QuestionnaireFormKey;
  readonly formVersion: string;
  readonly ruleVersion: string;
  readonly scoringCatalogHash: string;
  readonly wire: {
    readonly unknownKeys: "reject";
    readonly coercion: "none";
    readonly answerStateProperties: {
      readonly answered: readonly ["state", "value"];
      readonly missing: readonly ["state"];
      readonly not_applicable: readonly ["state", "reason"];
    };
  };
  readonly exactQuestionIds: readonly string[];
  readonly items: readonly {
    readonly id: string;
    readonly allowedValues: readonly string[];
    readonly missing: { readonly draftAllowed: true; readonly completeAllowed: false };
    readonly notApplicable: {
      readonly draftAllowed: boolean;
      readonly completeAllowed: false;
      readonly reason: QuestionnaireValidationTextContract;
    };
  }[];
  readonly context: readonly QuestionnaireValidationContext[];
  readonly measurement: QuestionnaireValidationMeasurementContract | null;
  /** Fixed ordered error semantics, independent of localized display copy. */
  readonly issueRules: readonly QuestionnaireValidationIssueRule[];
  readonly resultPolicy: {
    /** Structural DB-wire validity only; never implies write authorization. */
    readonly storageValidity: "independent-of-completeness";
    readonly statusPrecedence: readonly ["invalid", "incomplete", "complete"];
    readonly invalidScore: null;
    readonly incompleteScore: null;
    readonly preserveIndependentAnswerAlerts: true;
  };
}

export interface QuestionnaireValidationCatalogEntry {
  readonly manifest: QuestionnaireValidationCatalogManifest;
  readonly validationCatalogHash: string;
  readonly canonicalJson: string;
}
