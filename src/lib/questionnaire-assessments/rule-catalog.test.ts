import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { QUESTIONNAIRE_FORMS } from "./forms";
import { buildQuestionnaireRuleCatalogEntry, canonicalRuleJson } from "./rule-catalog";
import type { QuestionnaireFormKey } from "./types";

describe("immutable declarative questionnaire proposal catalog", () => {
  it.each(Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[])("freezes %s without activating or approving it", (formKey) => {
    const entry = buildQuestionnaireRuleCatalogEntry(formKey);
    expect(entry.catalogHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(entry.catalogHash).toBe(createHash("sha256").update(entry.canonicalJson, "utf8").digest("hex"));
    expect(entry.manifest.formKey).toBe(formKey);
    expect(entry.manifest.formVersion).toBe(QUESTIONNAIRE_FORMS[formKey].version);
    expect(entry.manifest.ruleVersion).toBe(QUESTIONNAIRE_FORMS[formKey].scoreVersionId);
    expect(entry.manifest.rules.scoreTable.length).toBeGreaterThan(0);
    expect(entry.manifest.sourceSnapshot.length).toBeGreaterThan(0);
    expect(entry.canonicalJson).not.toMatch(/approvedBy|approvedAt|signedBy|activatedAt/u);
    expect(buildQuestionnaireRuleCatalogEntry(formKey).catalogHash).toBe(entry.catalogHash);
  });
  it("is independent of object insertion order, but preserves actual question/choice order", () => {
    expect(canonicalRuleJson({ b: 2, a: { d: 4, c: 3 } })).toBe(canonicalRuleJson({ a: { c: 3, d: 4 }, b: 2 }));
    expect(canonicalRuleJson([1, 2])).not.toBe(canonicalRuleJson([2, 1]));
  });
  it.each([NaN, Infinity, new Date(), () => 1, Symbol("not-json"), [undefined]])("rejects runtime or non-JSON catalog contents", (value) => {
    expect(() => canonicalRuleJson(value)).toThrow(/non-JSON/u);
  });
  it("keeps qualitative notes and source instructions, and does not share registry objects", () => {
    const entry = buildQuestionnaireRuleCatalogEntry("spmsq");
    const original = QUESTIONNAIRE_FORMS.spmsq.questions[0]!.prompt;
    (entry.manifest.form.questions[0] as { prompt: string }).prompt = "synthetic mutation";
    expect(QUESTIONNAIRE_FORMS.spmsq.questions[0]!.prompt).toBe(original);
    expect(buildQuestionnaireRuleCatalogEntry("spmsq").catalogHash).toBe(entry.catalogHash);
  });
  it("changes the content hash when scoring semantics or source evidence change", () => {
    const entry = buildQuestionnaireRuleCatalogEntry("spmsq");
    const mutated = { ...entry.manifest, ruleRevision: entry.manifest.ruleRevision + 1 };
    expect(createHash("sha256").update(canonicalRuleJson(mutated)).digest("hex")).not.toBe(entry.catalogHash);
  });
  it("registers exactly the nine checked-in manifests without supplying tenant adoption or signatures", () => {
    const sql = readFileSync("supabase/migrations/20260926045916_register_questionnaire_rule_candidates.sql", "utf8");
    const rows = [...sql.matchAll(/^ \('([^']+)','([^']+)','([^']+)',([0-9]+),'([a-f0-9]{64})',\$questionnaire_catalog\$(.*?)\$questionnaire_catalog\$\)/gmu)];
    expect(rows).toHaveLength(Object.keys(QUESTIONNAIRE_FORMS).length);
    expect(new Set(rows.map((row) => row[1])).size).toBe(rows.length);
    for (const row of rows) {
      const entry = buildQuestionnaireRuleCatalogEntry(row[1] as QuestionnaireFormKey);
      expect(row.slice(2, 6)).toEqual([entry.formVersion, entry.ruleVersion, String(entry.manifest.ruleRevision), entry.catalogHash]);
      expect(row[6]).toBe(entry.canonicalJson);
      expect(JSON.parse(row[6]!)).toEqual(entry.manifest);
    }
    expect(sql).not.toMatch(/insert\s+into\s+(?:public\.|private\.)(?:questionnaire_rule_activations|questionnaire_rule_review_requests|questionnaire_signed_versions|questionnaire_assessment_versions)/iu);
  });
  it("captures the corrected BSRS boundary and independently acknowledged safety alerts", () => {
    const entry = buildQuestionnaireRuleCatalogEntry("bsrs5");
    expect(entry.ruleVersion).toBe("bsrs5-zh-tw-v2");
    expect(entry.manifest.rules.scoreTable.find(({ rawScore }) => rawScore === 15)?.classification.key).toBe("high_15_20");
    const alerts = entry.manifest.rules.answerAlertTable.flatMap((entry) => entry.alerts);
    expect(alerts.some((alert) => alert.requiresAcknowledgement === true)).toBe(true);
    expect(alerts.every((alert) => !alert.code.startsWith("RULE_"))).toBe(true);
  });
});
