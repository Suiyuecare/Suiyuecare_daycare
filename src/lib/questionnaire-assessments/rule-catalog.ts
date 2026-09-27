import "server-only";

import { createHash } from "node:crypto";
import { canonicalRuleJson } from "./canonical-json";
import { buildQuestionnaireRuleManifest } from "./rule-manifest";
import type { QuestionnaireRuleCatalogEntry } from "./rule-manifest";
import type { QuestionnaireFormKey } from "./types";

export { canonicalRuleJson } from "./canonical-json";
export type { QuestionnaireRuleCatalogEntry } from "./rule-manifest";

export function buildQuestionnaireRuleCatalogEntry(formKey: QuestionnaireFormKey): QuestionnaireRuleCatalogEntry {
  const manifest = buildQuestionnaireRuleManifest(formKey);
  const canonicalJson = canonicalRuleJson(manifest);
  // Parse into fresh plain data; caller changes cannot mutate the live registry.
  return { formKey, formVersion: manifest.formVersion, ruleVersion: manifest.ruleVersion,
    catalogHash: createHash("sha256").update(canonicalJson, "utf8").digest("hex"), canonicalJson,
    manifest: JSON.parse(canonicalJson) as typeof manifest };
}
