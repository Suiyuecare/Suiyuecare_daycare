import "server-only";

import { createHash } from "node:crypto";
import { buildQuestionnaireRuleCatalogEntry, canonicalRuleJson } from "./rule-catalog";
import type { QuestionnaireFormKey } from "./types";
import { buildQuestionnaireValidationCatalogEntry } from "./validation-catalog";

/** A new candidate identity, not an extension of any existing rule adoption. */
export function buildQuestionnaireReadinessCatalogEntry(formKey: QuestionnaireFormKey) {
  const scoring = buildQuestionnaireRuleCatalogEntry(formKey);
  const validation = buildQuestionnaireValidationCatalogEntry(formKey);
  const manifest = {
    schemaVersion: "questionnaire-readiness-bundle.v1" as const,
    candidateOnly: true as const,
    formKey,
    formVersion: scoring.formVersion,
    ruleVersion: scoring.ruleVersion,
    scoringCatalogHash: scoring.catalogHash,
    validationCatalogHash: validation.validationCatalogHash,
    validationVersion: validation.manifest.validationVersion,
    validationBoundary: "database-draft-wire" as const,
    scope: "validation-and-candidate-scoring" as const,
  };
  const canonicalJson = canonicalRuleJson(manifest);
  return {
    bundleHash: createHash("sha256").update(canonicalJson, "utf8").digest("hex"),
    canonicalJson,
    manifest,
  };
}
