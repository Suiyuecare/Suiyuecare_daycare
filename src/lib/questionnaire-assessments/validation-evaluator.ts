import "server-only";

import { createHash } from "node:crypto";
import type { AssessmentAlert, AssessmentClassification, AssessmentScore } from "@/lib/assessments/types";
import { buildQuestionnaireRuleCatalogEntry, canonicalRuleJson } from "./rule-catalog";
import type { QuestionnaireRuleCatalogEntry } from "./rule-catalog";
import { buildQuestionnaireValidationCatalogEntry } from "./validation-catalog";
import type { QuestionnaireValidationCatalogEntry, QuestionnaireValidationIssueCode, QuestionnaireValidationTextContract } from "./validation-types";

export interface QuestionnaireValidationIssue {
  readonly code: QuestionnaireValidationIssueCode;
  readonly path: string;
  readonly category: "invalid" | "incomplete";
  readonly blocksStorage: boolean;
  readonly blocksCompletion: true;
}

export interface QuestionnaireValidationCandidateResult {
  readonly schemaVersion: "questionnaire-validation-result.v1";
  readonly validationCatalogHash: string;
  readonly scoringCatalogHash: string;
  readonly candidateOnly: true;
  /** Pure DB draft-wire validity, not HTTP acceptance, persistence or authority. */
  readonly storageValid: boolean;
  readonly status: "invalid" | "incomplete" | "complete";
  readonly issues: readonly QuestionnaireValidationIssue[];
  readonly score: AssessmentScore | null;
  readonly classification: AssessmentClassification | null;
  readonly alerts: readonly AssessmentAlert[];
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  // Real JSON has enumerable data properties only. Never execute accessors or
  // copy inherited state while checking a candidate's untrusted input.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string") ||
    Object.values(descriptors).some((descriptor) => !descriptor.enumerable || !("value" in descriptor))) return null;
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function textValid(value: unknown, contract: QuestionnaireValidationTextContract): value is string {
  if (typeof value !== "string" || value !== value.replace(/^ +| +$/gu, "")) return false;
  const characters = [...value];
  if (characters.length < contract.minCodePoints || characters.length > contract.maxCodePoints) return false;
  return characters.every((character) => {
    const codePoint = character.codePointAt(0)!;
    // PostgreSQL JSON/text cannot contain unpaired UTF-16 surrogate escapes.
    return !(codePoint >= 0xd800 && codePoint <= 0xdfff) &&
      !contract.rejectControlRanges.some(([minimum, maximum]) => codePoint >= minimum && codePoint <= maximum);
  });
}

function decimalTenths(value: string): number {
  const [whole, fraction = "0"] = value.split(".");
  return Number(whole) * 10 + Number(fraction);
}

function assertCandidateBinding(validation: QuestionnaireValidationCatalogEntry, scoring: QuestionnaireRuleCatalogEntry) {
  const manifest = validation.manifest;
  const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  if (canonicalRuleJson(manifest) !== validation.canonicalJson || hash(validation.canonicalJson) !== validation.validationCatalogHash ||
    canonicalRuleJson(scoring.manifest) !== scoring.canonicalJson || hash(scoring.canonicalJson) !== scoring.catalogHash ||
    manifest.scoringCatalogHash !== scoring.catalogHash || manifest.formKey !== scoring.formKey ||
    manifest.formVersion !== scoring.formVersion || manifest.ruleVersion !== scoring.ruleVersion) {
    throw new Error("Invalid questionnaire validation candidate binding.");
  }
  // This interpreter supports only the checked-in unadopted contracts. A
  // caller cannot rehash a new policy/formula and have it silently evaluated.
  if (buildQuestionnaireValidationCatalogEntry(manifest.formKey).canonicalJson !== validation.canonicalJson ||
    buildQuestionnaireRuleCatalogEntry(manifest.formKey).canonicalJson !== scoring.canonicalJson) {
    throw new Error("Unsupported questionnaire validation candidate.");
  }
}

/**
 * Candidate-only reproduction from two immutable, hash-bound JSON catalogs.
 * No writes, adoption, signatures, source attestation or clinical authority.
 */
export function evaluateQuestionnaireValidationCandidate(
  validation: QuestionnaireValidationCatalogEntry,
  scoring: QuestionnaireRuleCatalogEntry,
  answersInput: unknown,
  contextInput: unknown,
): QuestionnaireValidationCandidateResult {
  assertCandidateBinding(validation, scoring);
  const manifest = validation.manifest;
  const issues: QuestionnaireValidationIssue[] = [];
  const issue = (trigger: string, path: string) => {
    const rows = manifest.issueRules.filter((rule) => rule.trigger === trigger);
    if (rows.length !== 1) throw new Error("Unsupported questionnaire validation issue rule.");
    const { code, category, blocksStorage, blocksCompletion } = rows[0]!;
    issues.push({ code, path, category, blocksStorage, blocksCompletion });
  };
  const answers = jsonRecord(answersInput);
  const context = jsonRecord(contextInput);
  const validAnswers = new Map<string, string>();
  const decimals = new Map<string, number>();
  if (!answers) issue("invalid_answers_container", "answers");
  if (!context) issue("invalid_context_container", "context");

  if (answers) {
    if (Object.keys(answers).some((key) => !manifest.exactQuestionIds.includes(key))) {
      // Unknown keys may themselves be sensitive. Do not echo them or values.
      issue("unknown_answer", "answers");
    }
    for (const item of manifest.items) {
      const path = `answers.${item.id}`;
      if (!Object.hasOwn(answers, item.id)) {
        issue("missing_answer_key", path);
        continue;
      }
      const answer = jsonRecord(answers[item.id]);
      if (!answer || typeof answer.state !== "string") {
        issue("malformed_answer", path);
      } else if (answer.state === "missing" && exactKeys(answer, manifest.wire.answerStateProperties.missing)) {
        issue("missing_answer_state", path);
      } else if (answer.state === "not_applicable" && exactKeys(answer, manifest.wire.answerStateProperties.not_applicable)) {
        if (!textValid(answer.reason, item.notApplicable.reason)) {
          issue("invalid_na_reason", path);
        } else {
          issue(item.notApplicable.draftAllowed ? "allowed_na" : "unsupported_na", path);
        }
      } else if (answer.state === "answered" && exactKeys(answer, manifest.wire.answerStateProperties.answered) &&
        typeof answer.value === "string" && item.allowedValues.includes(answer.value)) {
        validAnswers.set(item.id, answer.value);
      } else {
        issue("malformed_answer", path);
      }
    }
  }

  if (context) {
    if (Object.keys(context).some((key) => !manifest.context.some((field) => field.key === key))) {
      issue("unknown_context", "context");
    }
    for (const field of manifest.context) {
      const path = `context.${field.key}`;
      if (!Object.hasOwn(context, field.key)) {
        if (field.requiredForCompletion || field.requiredForStorage) {
          issue(field.requiredForStorage ? "missing_storage_context" : "missing_completion_context", path);
        }
        continue;
      }
      const value = context[field.key];
      let valid = typeof value === "string";
      if (typeof value === "string") {
        if (field.kind === "enum") valid = field.allowedValues.includes(value);
        else if (field.kind === "text") valid = textValid(value, field.validation);
        else {
          const match = new RegExp(field.pattern, "u").exec(value);
          // JavaScript $ can match before a final newline; PostgreSQL's
          // numeric wire must match the entire string, including its ending.
          valid = match?.[0] === value;
          if (valid) {
            const tenths = decimalTenths(value);
            valid = Number.isSafeInteger(tenths) && tenths >= field.minTenths && tenths <= field.maxTenths;
            if (valid) decimals.set(field.key, tenths);
          }
        }
      }
      if (!valid) issue("invalid_context", path);
    }
  }

  const measurement = manifest.measurement;
  if (measurement && context && validAnswers.has(measurement.answerId)) {
    const value = validAnswers.get(measurement.answerId)!;
    const bmiBand = measurement.bmiBands.find((band) => band.value === value);
    const calfBand = measurement.calfBands.find((band) => band.value === value);
    const route = bmiBand ? measurement.paths.bmi : measurement.paths.calf;
    if (route.requiredKeys.some((key) => !Object.hasOwn(context, key))) {
      issue("measurement_required", `answers.${measurement.answerId}`);
    }
    if (route.forbiddenKeys.some((key) => Object.hasOwn(context, key))) {
      issue("measurement_conflict", `answers.${measurement.answerId}`);
    }
    if (route.requiredKeys.every((key) => decimals.has(key)) &&
      route.forbiddenKeys.every((key) => !Object.hasOwn(context, key))) {
      const band = bmiBand ?? calfBand;
      if (!band) throw new Error("Unsupported questionnaire measurement band.");
      // h and w are integer tenths. BMI = 100000*w/h²; comparisons
      // remain integer-exact and within the safe integer ranges of this v1.
      const numerator = bmiBand ? measurement.bmiNumeratorMultiplier * decimals.get("weight_kg")!
        : decimals.get("calf_circumference_cm")!;
      const denominator = bmiBand ? decimals.get("height_cm")! ** 2 : 1;
      if ((band.minInclusive !== null && numerator < band.minInclusive * denominator) ||
        (band.maxExclusive !== null && numerator >= band.maxExclusive * denominator)) {
        issue("measurement_mismatch", `answers.${measurement.answerId}`);
      }
    }
  }

  const status = issues.some((entry) => entry.category === "invalid") ? "invalid"
    : issues.length ? "incomplete" : "complete";
  const alerts: AssessmentAlert[] = scoring.manifest.rules.answerAlertTable.flatMap((entry) =>
    validAnswers.get(entry.questionId) === entry.value ? entry.alerts : []);
  let score: AssessmentScore | null = null;
  let classification: AssessmentClassification | null = null;
  if (status === "complete") {
    const rules = scoring.manifest.rules;
    const rawScore = rules.items.reduce((total, item) => {
      const choice = item.choices.find((entry) => entry.value === validAnswers.get(item.id));
      if (!choice) throw new Error("Invalid questionnaire scoring catalog binding.");
      return total + choice.points;
    }, 0);
    const scoringContext = Object.fromEntries(rules.context.map((field) => [field.id, context![field.id]]));
    const rows = rules.scoreTable.filter((row) => row.rawScore === rawScore &&
      canonicalRuleJson(row.context) === canonicalRuleJson(scoringContext));
    if (rows.length !== 1) throw new Error("Invalid questionnaire scoring table.");
    const row = rows[0]!;
    score = { raw: rawScore, adjusted: row.adjustedScore, min: rules.scoreMin, max: rules.scoreMax, unit: rules.scoreUnit };
    classification = row.classification;
    alerts.push(...row.alerts);
  }
  // Never expose registry-owned references or echo any submitted PHI here.
  return JSON.parse(JSON.stringify({ schemaVersion: "questionnaire-validation-result.v1",
    validationCatalogHash: validation.validationCatalogHash, scoringCatalogHash: scoring.catalogHash, candidateOnly: true,
    storageValid: !issues.some((entry) => entry.blocksStorage), status, issues, score, classification, alerts })) as QuestionnaireValidationCandidateResult;
}
