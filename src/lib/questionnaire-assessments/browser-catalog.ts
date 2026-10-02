import { canonicalRuleJson } from "./canonical-json";
import { buildQuestionnaireRuleManifest } from "./rule-manifest";
import type { QuestionnaireRuleCatalogEntry } from "./rule-manifest";
import type { QuestionnaireFormKey } from "./types";
import { evaluateQuestionnaireValidationCore } from "./validation-core";
import type { QuestionnaireValidationCandidateResult } from "./validation-core";
import { buildQuestionnaireValidationManifest } from "./validation-manifest";
import type { QuestionnaireValidationCatalogEntry } from "./validation-types";

// SHA-256 identities mechanically copied from the unchanged registered canonical
// artifacts. Node parity tests protect every byte; these are never user policy.
const compiledIdentities = {
  "spmsq": {
    "scoringCatalogHash": "107d36e3c376230e4c681a257372f25787e76e8ace465cf2e9c57c4c3f2e9fdd",
    "validationCatalogHash": "311e945499208ce8574415468a2df6b592502a310208acf617f71e7cb96c3151",
    "bundleHash": "31be03f49a1959cb5281936f96cace74ba5843a82b4f6cf235ed86cd5a6b1629"
  },
  "gds_15": {
    "scoringCatalogHash": "2d4c146820607a4be0d14ac0d1dff1b0cd04dcc76b8f60bec41e0c9ca5a327dc",
    "validationCatalogHash": "e39a30acea3b11b4c561e8d66e14a0044c35c8c8ed1c866351d8867d5e1a3e3a",
    "bundleHash": "bb7aad552c91f8b61c22376c533569a1f64481ddf6b3067a383cd368e2db6b78"
  },
  "barthel_adl": {
    "scoringCatalogHash": "b7a12993fcb05da0ffdec3938f0472f46522db7b81cbe54e3e47ab43f1237951",
    "validationCatalogHash": "3978abe1e0a209896d261a09f392f0907556f7130e23f2c30b8584121841751a",
    "bundleHash": "5c19c3a1795d486d37d0643e124395b8a7edbb0ac1c2daa928fc33ca89d1413f"
  },
  "lawton_iadl": {
    "scoringCatalogHash": "a558f9069b6ad4156e95ded03858fcf0c72ab9605cdcf9ba114cd91c15dd5f9c",
    "validationCatalogHash": "910434cd939bfb5c5d1b0ac18f9ea9b344b949445b69f80f12dde8de63ed918f",
    "bundleHash": "c9127557b9446210d9cdf4e75392799304fff22a7e82e9ee31403f056029af66"
  },
  "eat10_swallowing": {
    "scoringCatalogHash": "9bac4739bc8d9b6a223d9b635bbe23a9b54ee56dda65d973daab42b6f6d36607",
    "validationCatalogHash": "cdc01d3d83b2b21bcc4a4aaa31948a027016af5fa64f3bd6a5129252ed0e0bb2",
    "bundleHash": "aa49c982449aeae89de0cde1d719b051ee8b44a9b11c95fc79d69f9fa699cd47"
  },
  "bsrs5": {
    "scoringCatalogHash": "2896681066318a3ceda2c509cfe6236d350bfaa3cf58a83451d3910fc1f805b5",
    "validationCatalogHash": "bb7206d4c88f04e3402464c148040890148925362a5f78c66bde9a6f0594152c",
    "bundleHash": "103154b2a90d4bac39f798a35da0db72c0ed479cb2495716ec344822b654f38a"
  },
  "fall_risk_taipei_115": {
    "scoringCatalogHash": "c9b293dee73e5500a203625dcea957f7d3dc2d07a32ea44bd8fff4835fb3c10f",
    "validationCatalogHash": "7254766dba7af1849331a19086a41c98faf8cf224e97809ba8696ee715bc918e",
    "bundleHash": "d2b335f7f7314046473c096729353bef8013732cfcbeefa6c7e0336293cd0458"
  },
  "nsi_determine": {
    "scoringCatalogHash": "7cbd006b864eb6f987bdf2fdd886d762317af329e6e78858096b43cb895dcd45",
    "validationCatalogHash": "baae842466cef755164ab41a4988bcaef831faa0bd476a50bf33e9c38dc35e84",
    "bundleHash": "92d87d1d5797461a3402059bbd5f2631a41073629c1922618af18110f71ae5ff"
  },
  "mna_sf": {
    "scoringCatalogHash": "32ed42b84954d920c44016722a73f68fc77fa0e81f2dd5580ac34902befcbd7e",
    "validationCatalogHash": "b07b2992d707d254375b9746f0d91b266de481fb4d6fc9d237336dfad823b512",
    "bundleHash": "79a90074e6bae96a0504d9666d4cddee7dc02fa9a8c269dcfda018716c4d01ba"
  }
} as const satisfies Readonly<Record<QuestionnaireFormKey, {
  scoringCatalogHash: string; validationCatalogHash: string; bundleHash: string;
}>>;

// Freeze plain canonical bytes once. Consumers receive fresh parsed data and
// cannot change future previews by mutating a returned catalog or form registry.
const compiledCatalogs = Object.fromEntries((Object.keys(compiledIdentities) as QuestionnaireFormKey[]).map((formKey) => {
  const identity = compiledIdentities[formKey];
  const manifest = buildQuestionnaireRuleManifest(formKey);
  const scoringCanonicalJson = canonicalRuleJson(manifest);
  const scoring: QuestionnaireRuleCatalogEntry = {
    formKey, formVersion: manifest.formVersion, ruleVersion: manifest.ruleVersion,
    catalogHash: identity.scoringCatalogHash, canonicalJson: scoringCanonicalJson,
    manifest: JSON.parse(scoringCanonicalJson) as typeof manifest,
  };
  const validationCanonicalJson = canonicalRuleJson(buildQuestionnaireValidationManifest(formKey, scoring));
  return [formKey, { scoringCanonicalJson, validationCanonicalJson,
    formVersion: manifest.formVersion, ruleVersion: manifest.ruleVersion }];
})) as Record<QuestionnaireFormKey, {
  scoringCanonicalJson: string; validationCanonicalJson: string; formVersion: string; ruleVersion: string;
}>;

function compiledKey(formKey: QuestionnaireFormKey): QuestionnaireFormKey {
  if (typeof formKey !== "string" || !Object.hasOwn(compiledIdentities, formKey)) {
    throw new Error("Unsupported questionnaire candidate.");
  }
  return formKey;
}

/** Only checked-in candidates; no caller-supplied manifest, policy or formula. */
export function buildQuestionnaireBrowserCatalog(formKey: QuestionnaireFormKey) {
  const key = compiledKey(formKey); const identity = compiledIdentities[key]; const compiled = compiledCatalogs[key];
  const scoring: QuestionnaireRuleCatalogEntry = {
    formKey: key, formVersion: compiled.formVersion, ruleVersion: compiled.ruleVersion,
    catalogHash: identity.scoringCatalogHash, canonicalJson: compiled.scoringCanonicalJson,
    manifest: JSON.parse(compiled.scoringCanonicalJson) as QuestionnaireRuleCatalogEntry["manifest"],
  };
  const validation: QuestionnaireValidationCatalogEntry = {
    validationCatalogHash: identity.validationCatalogHash, canonicalJson: compiled.validationCanonicalJson,
    manifest: JSON.parse(compiled.validationCanonicalJson) as QuestionnaireValidationCatalogEntry["manifest"],
  };
  return { scoring, validation, bundleHash: identity.bundleHash,
    formVersion: compiled.formVersion, ruleVersion: compiled.ruleVersion };
}

export function getQuestionnaireReadinessBrowserBinding(formKey: QuestionnaireFormKey) {
  const key = compiledKey(formKey); const identity = compiledIdentities[key]; const compiled = compiledCatalogs[key];
  return { formVersion: compiled.formVersion, ruleVersion: compiled.ruleVersion,
    bundleHash: identity.bundleHash, validationCatalogHash: identity.validationCatalogHash,
    scoringCatalogHash: identity.scoringCatalogHash };
}

/** Local candidate preview only. No persistence, adoption, signature or I/O. */
export function evaluateQuestionnaireValidationPreview(
  formKey: QuestionnaireFormKey, answers: unknown, context: unknown,
): QuestionnaireValidationCandidateResult {
  const { validation, scoring } = buildQuestionnaireBrowserCatalog(formKey);
  return evaluateQuestionnaireValidationCore(validation, scoring, answers, context);
}

export const reproduceQuestionnaireReadinessCandidate = evaluateQuestionnaireValidationPreview;
