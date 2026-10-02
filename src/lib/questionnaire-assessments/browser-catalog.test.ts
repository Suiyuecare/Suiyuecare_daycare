import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ASSESSMENT_TEST_VECTORS } from "@/lib/assessments/test-vectors";
import { buildQuestionnaireBrowserCatalog, evaluateQuestionnaireValidationPreview,
  getQuestionnaireReadinessBrowserBinding, reproduceQuestionnaireReadinessCandidate } from "./browser-catalog";
import { canonicalRuleJson } from "./canonical-json";
import { QUESTIONNAIRE_FORMS } from "./forms";
import { buildQuestionnaireReadinessCatalogEntry } from "./readiness-catalog";
import { buildQuestionnaireRuleCatalogEntry } from "./rule-catalog";
import type { QuestionnaireFormKey } from "./types";
import { buildQuestionnaireValidationCatalogEntry } from "./validation-catalog";
import { evaluateQuestionnaireValidationCandidate } from "./validation-evaluator";

const keys = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const scoringSql = readFileSync("supabase/migrations/20260926045916_register_questionnaire_rule_candidates.sql", "utf8");
const readinessSql = readFileSync("supabase/migrations/20260926174621_questionnaire_readiness_candidate_catalog.sql", "utf8");
const literalRows = (table: string) => readinessSql.split("\n").filter((line) => line.startsWith(`insert into private.${table}(`))
  .map((line) => [...line.matchAll(/'((?:''|[^'])*)'/gu)].map((match) => match[1]!.replaceAll("''", "'")));
const validationRows = literalRows("questionnaire_validation_catalog");
const bundleRows = literalRows("questionnaire_readiness_catalog");

function completeInput(key: QuestionnaireFormKey) {
  const { scoring } = buildQuestionnaireBrowserCatalog(key);
  return {
    answers: Object.fromEntries(scoring.manifest.rules.items.map((item) => [item.id, { state: "answered", value: item.choices[0]!.value }])),
    context: key === "spmsq" ? { education_adjustment: "middle_or_high_school" }
      : key === "mna_sf" ? { height_cm: "170.0", weight_kg: "50.0" } : {},
  };
}

describe("browser-safe shared candidate catalog with immutable independent identities", () => {
  it("has exactly nine SQL scoring, validation and new readiness identities", () => {
    expect(keys).toHaveLength(9); expect(validationRows).toHaveLength(9); expect(bundleRows).toHaveLength(9);
    expect([...scoringSql.matchAll(/^ \('([^']+)','([^']+)','([^']+)',([0-9]+),'([a-f0-9]{64})',\$questionnaire_catalog\$(.*?)\$questionnaire_catalog\$\)/gmu)]).toHaveLength(9);
  });

  it.each(keys)("preserves every original %s scoring/validation/readiness byte and SHA-256 identity", (key) => {
    const browser = buildQuestionnaireBrowserCatalog(key);
    const scoring = buildQuestionnaireRuleCatalogEntry(key);
    const validation = buildQuestionnaireValidationCatalogEntry(key);
    const bundle = buildQuestionnaireReadinessCatalogEntry(key);
    const old = [...scoringSql.matchAll(/^ \('([^']+)','([^']+)','([^']+)',([0-9]+),'([a-f0-9]{64})',\$questionnaire_catalog\$(.*?)\$questionnaire_catalog\$\)/gmu)].find((row) => row[1] === key)!;
    const storedValidation = validationRows.find((row) => row[2] === key)!;
    const storedBundle = bundleRows.find((row) => row[3] === key)!;
    expect(browser.scoring).toEqual(scoring); expect(browser.validation).toEqual(validation);
    expect(browser.scoring.canonicalJson).toBe(old[6]); expect(browser.scoring.catalogHash).toBe(old[5]);
    expect(browser.validation.canonicalJson).toBe(storedValidation[6]); expect(browser.validation.validationCatalogHash).toBe(storedValidation[0]);
    expect(bundle.canonicalJson).toBe(storedBundle[7]); expect(browser.bundleHash).toBe(storedBundle[0]);
    expect(hash(browser.scoring.canonicalJson)).toBe(browser.scoring.catalogHash);
    expect(hash(browser.validation.canonicalJson)).toBe(browser.validation.validationCatalogHash);
    expect(hash(bundle.canonicalJson)).toBe(browser.bundleHash);
    expect(canonicalRuleJson(browser.scoring.manifest)).toBe(browser.scoring.canonicalJson);
    expect(canonicalRuleJson(browser.validation.manifest)).toBe(browser.validation.canonicalJson);
    expect(getQuestionnaireReadinessBrowserBinding(key)).toEqual({ formVersion: scoring.formVersion,
      ruleVersion: scoring.ruleVersion, bundleHash: bundle.bundleHash,
      validationCatalogHash: validation.validationCatalogHash, scoringCatalogHash: scoring.catalogHash });
  });

  it.each(keys)("uses the same %s pure algorithm for complete, missing, N/A, malformed and unknown input", (key) => {
    const { answers, context } = completeInput(key); const first = Object.keys(answers)[0]!;
    const serverScoring = buildQuestionnaireRuleCatalogEntry(key); const serverValidation = buildQuestionnaireValidationCatalogEntry(key);
    const inputs: [unknown, unknown][] = [
      [answers, context], [{ ...answers, [first]: { state: "missing" } }, context],
      [{ ...answers, [first]: { state: "not_applicable", reason: "Synthetic reason" } }, context],
      [{ ...answers, [first]: { state: "answered", value: "unknown-sensitive-input" } }, context],
      [{ ...answers, "private-unknown-key": { state: "answered", value: "do not echo" } }, context],
      [answers, { ...context, unknown: "do not echo" }], [null, context], [answers, null],
    ];
    for (const [input, details] of inputs) {
      const before = JSON.stringify([input, details]);
      const preview = evaluateQuestionnaireValidationPreview(key, input, details);
      expect(preview).toEqual(evaluateQuestionnaireValidationCandidate(serverValidation, serverScoring, input, details));
      expect(reproduceQuestionnaireReadinessCandidate(key, input, details)).toEqual(preview);
      expect(JSON.stringify([input, details])).toBe(before);
      expect(JSON.stringify(preview)).not.toMatch(/unknown-sensitive-input|private-unknown-key|do not echo/u);
      expect(preview.candidateOnly).toBe(true);
      expect(preview).not.toHaveProperty("signable"); expect(preview).not.toHaveProperty("formalScore");
    }
  });

  it("reproduces all existing golden submissions, using physical evidence required by the DB wire", () => {
    for (const vector of ASSESSMENT_TEST_VECTORS) {
      const key = keys.find((form) => QUESTIONNAIRE_FORMS[form].scoreVersionId === vector.submission.versionId);
      if (!key) continue;
      const context = { ...("context" in vector.submission ? vector.submission.context : {}) };
      if (key === "mna_sf") {
        const choice = vector.submission.answers.anthropometry;
        if (choice?.state === "answered") {
          if (choice.value.startsWith("bmi_")) Object.assign(context, { height_cm: "170.0", weight_kg: choice.value === "bmi_gte_23" ? "70.0" : "50.0" });
          else Object.assign(context, { calf_circumference_cm: choice.value === "calf_gte_31" ? "31.0" : "30.0" });
        }
      }
      expect(evaluateQuestionnaireValidationPreview(key, vector.submission.answers, context)).toEqual(
        evaluateQuestionnaireValidationCandidate(buildQuestionnaireValidationCatalogEntry(key), buildQuestionnaireRuleCatalogEntry(key), vector.submission.answers, context));
    }
  });

  it("preserves BSRS independent safety alerts on incomplete/invalid input and exact MNA measurement boundaries", () => {
    const bsrs = completeInput("bsrs5");
    const result = evaluateQuestionnaireValidationPreview("bsrs5", { ...bsrs.answers, bsrs_01: { state: "missing" }, bsrs_suicide: { state: "answered", value: "4" } }, bsrs.context);
    expect(result.status).toBe("incomplete"); expect(result.score).toBeNull();
    expect(result.alerts.some((alert) => alert.requiresAcknowledgement)).toBe(true);
    const mna = completeInput("mna_sf");
    const calf = { ...mna.answers, anthropometry: { state: "answered", value: "calf_gte_31" } };
    expect(evaluateQuestionnaireValidationPreview("mna_sf", calf, { calf_circumference_cm: "31.0" }).status).toBe("complete");
    expect(evaluateQuestionnaireValidationPreview("mna_sf", calf, { calf_circumference_cm: "30.9" }).score).toBeNull();
    expect(evaluateQuestionnaireValidationPreview("mna_sf", calf, { calf_circumference_cm: "31.0", height_cm: "170.0" }).score).toBeNull();
  });

  it("never shares mutable registry/canonical state or accepts a caller's external manifest as a form key", () => {
    const pristine = buildQuestionnaireBrowserCatalog("spmsq"); const changed = buildQuestionnaireBrowserCatalog("spmsq");
    (changed.scoring.manifest.rules.items[0]!.choices[0] as { points: number }).points = 999;
    (changed.validation.manifest.items[0]!.allowedValues as string[]).push("synthetic");
    expect(buildQuestionnaireBrowserCatalog("spmsq")).toEqual(pristine);
    const binding = getQuestionnaireReadinessBrowserBinding("spmsq"); (binding as { bundleHash: string }).bundleHash = "0".repeat(64);
    expect(getQuestionnaireReadinessBrowserBinding("spmsq").bundleHash).toBe(pristine.bundleHash);
    for (const external of ["__proto__", "constructor", "unknown", null, { ...pristine.scoring.manifest }]) {
      expect(() => buildQuestionnaireBrowserCatalog(external as QuestionnaireFormKey)).toThrow("Unsupported questionnaire candidate.");
      expect(() => evaluateQuestionnaireValidationPreview(external as QuestionnaireFormKey, {}, {})).toThrow("Unsupported questionnaire candidate.");
    }
  });

  it("does not execute getters, coerce values, leak unknown PHI or perform any preview I/O", () => {
    const getter = vi.fn(() => "private value"); const input = completeInput("spmsq");
    Object.defineProperty(input.answers, "spmsq_01", { enumerable: true, get: getter });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    try {
      const result = evaluateQuestionnaireValidationPreview("spmsq", input.answers, input.context);
      expect(result.status).toBe("invalid"); expect(result.score).toBeNull(); expect(getter).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("private value");
    } finally { vi.unstubAllGlobals(); }
  });

  it("has no server-only, Node builtin, auth/database, transport or storage dependency anywhere in its runtime import graph", () => {
    const visited = new Set<string>(); const sources: string[] = [];
    const inspect = (file: string) => {
      if (visited.has(file)) return; visited.add(file);
      const text = readFileSync(file, "utf8"); sources.push(text);
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        if (ts.isImportDeclaration(statement)) {
          if (statement.importClause?.isTypeOnly) continue;
          const binding = statement.importClause?.namedBindings;
          if (!statement.importClause?.name && binding && ts.isNamedImports(binding) && binding.elements.every((entry) => entry.isTypeOnly)) continue;
        } else if (statement.isTypeOnly) continue;
        const name = statement.moduleSpecifier.text;
        expect(name).not.toMatch(/^(?:node:|server-only$|@supabase\/)|(?:rule-catalog|validation-catalog|validation-evaluator|readiness-source|readiness-client|\/auth\/|\/supabase\/)/u);
        if (name.startsWith("@/")) inspect(resolve("src", `${name.slice(2)}.ts`));
        else if (name.startsWith(".")) inspect(resolve(dirname(file), `${name}.ts`));
      }
    };
    inspect(resolve("src/lib/questionnaire-assessments/browser-catalog.ts"));
    expect(visited.size).toBeGreaterThan(6);
    expect(sources.join("\n")).not.toMatch(/\b(?:fetch|localStorage|sessionStorage|indexedDB|XMLHttpRequest)\s*[.(]|\b(?:window|document|navigator|process)\s*\./u);
  });
});
