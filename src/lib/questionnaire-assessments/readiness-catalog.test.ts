import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { QUESTIONNAIRE_FORMS } from "./forms";
import { buildQuestionnaireReadinessCatalogEntry } from "./readiness-catalog";
import { buildQuestionnaireRuleCatalogEntry, canonicalRuleJson } from "./rule-catalog";
import type { QuestionnaireFormKey } from "./types";
import { buildQuestionnaireValidationCatalogEntry } from "./validation-catalog";

const forms = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];

describe("independent saved-questionnaire readiness bundle identity", () => {
  it.each(forms)("freezes both candidate contracts for %s without inheriting a scoring-only adoption", (formKey) => {
    const original = buildQuestionnaireRuleCatalogEntry(formKey);
    const validation = buildQuestionnaireValidationCatalogEntry(formKey);
    const bundle = buildQuestionnaireReadinessCatalogEntry(formKey);
    expect(bundle.manifest).toEqual({
      schemaVersion: "questionnaire-readiness-bundle.v1", candidateOnly: true,
      formKey, formVersion: original.formVersion, ruleVersion: original.ruleVersion,
      scoringCatalogHash: original.catalogHash, validationCatalogHash: validation.validationCatalogHash,
      validationVersion: validation.manifest.validationVersion,
      validationBoundary: "database-draft-wire", scope: "validation-and-candidate-scoring",
    });
    expect(bundle.canonicalJson).toBe(canonicalRuleJson(bundle.manifest));
    expect(bundle.bundleHash).toBe(createHash("sha256").update(bundle.canonicalJson, "utf8").digest("hex"));
    expect(bundle.bundleHash).not.toBe(original.catalogHash);
    expect(bundle.bundleHash).not.toBe(validation.validationCatalogHash);
    expect(buildQuestionnaireRuleCatalogEntry(formKey)).toEqual(original);
    expect(buildQuestionnaireReadinessCatalogEntry(formKey)).toEqual(bundle);
    expect(bundle.canonicalJson).not.toMatch(/approvedBy|signedBy|activatedAt|sourceEvidence|qualification/u);
  });

  it("does not share mutable bundle manifests with the live definition or another build", () => {
    const pristine = buildQuestionnaireReadinessCatalogEntry("spmsq");
    const change = buildQuestionnaireReadinessCatalogEntry("spmsq");
    (change.manifest as { validationBoundary: string }).validationBoundary = "synthetic-policy";
    expect(buildQuestionnaireReadinessCatalogEntry("spmsq")).toEqual(pristine);
    expect(canonicalRuleJson(change.manifest)).not.toBe(pristine.canonicalJson);
  });

  it("gives all nine forms distinct immutable identities", () => {
    expect(forms).toHaveLength(9);
    expect(new Set(forms.map((formKey) => buildQuestionnaireReadinessCatalogEntry(formKey).bundleHash)).size).toBe(9);
  });
});
