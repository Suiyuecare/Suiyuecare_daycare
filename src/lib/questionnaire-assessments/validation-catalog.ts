import "server-only";

import { createHash } from "node:crypto";
import { buildQuestionnaireRuleCatalogEntry, canonicalRuleJson } from "./rule-catalog";
import type { QuestionnaireFormKey } from "./types";
import { buildQuestionnaireValidationManifest } from "./validation-manifest";
import type { QuestionnaireValidationCatalogEntry, QuestionnaireValidationCatalogManifest } from "./validation-types";

/** Node hash-bound wrapper over the same candidate-only database wire manifest. */
export function buildQuestionnaireValidationCatalogEntry(formKey: QuestionnaireFormKey): QuestionnaireValidationCatalogEntry {
  const scoring = buildQuestionnaireRuleCatalogEntry(formKey);
  const manifest = buildQuestionnaireValidationManifest(formKey, scoring);
  const canonicalJson = canonicalRuleJson(manifest);
  return {
    manifest: JSON.parse(canonicalJson) as QuestionnaireValidationCatalogManifest,
    validationCatalogHash: createHash("sha256").update(canonicalJson, "utf8").digest("hex"),
    canonicalJson,
  };
}
