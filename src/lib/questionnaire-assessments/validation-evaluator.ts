import "server-only";

import { createHash } from "node:crypto";
import { buildQuestionnaireRuleCatalogEntry, canonicalRuleJson } from "./rule-catalog";
import type { QuestionnaireRuleCatalogEntry } from "./rule-manifest";
import { buildQuestionnaireValidationCatalogEntry } from "./validation-catalog";
import { evaluateQuestionnaireValidationCore } from "./validation-core";
import type { QuestionnaireValidationCandidateResult } from "./validation-core";
import type { QuestionnaireValidationCatalogEntry } from "./validation-types";

export type { QuestionnaireValidationCandidateResult, QuestionnaireValidationIssue } from "./validation-core";

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

/** Hash and compiled-policy checks remain server-only before the shared core. */
export function evaluateQuestionnaireValidationCandidate(
  validation: QuestionnaireValidationCatalogEntry,
  scoring: QuestionnaireRuleCatalogEntry,
  answersInput: unknown,
  contextInput: unknown,
): QuestionnaireValidationCandidateResult {
  assertCandidateBinding(validation, scoring);
  return evaluateQuestionnaireValidationCore(validation, scoring, answersInput, contextInput);
}
