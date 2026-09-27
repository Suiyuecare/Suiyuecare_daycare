import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { QUESTIONNAIRE_FORMS } from "./forms";
import { buildQuestionnaireReadinessCatalogEntry } from "./readiness-catalog";
import { buildQuestionnaireReadinessReport, type QuestionnaireReadinessExpected } from "./readiness-source";
import { buildQuestionnaireRuleCatalogEntry, canonicalRuleJson } from "./rule-catalog";
import type { QuestionnaireFormKey } from "./types";
import { buildQuestionnaireValidationCatalogEntry } from "./validation-catalog";
import { evaluateQuestionnaireValidationCandidate } from "./validation-evaluator";

const keys = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];
const now = Date.parse("2026-09-27T10:00:00Z");
const uuid = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, "0")}`;
const persistent = ["source_evidence_missing", "bundle_not_adopted", "signing_policy_missing", "formal_signing_unavailable"];
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

// Synthetic RPC-wire fixtures only. Integrity of the original jsonb::text
// content hash and current chain is the database source RPC's responsibility.
function fixture(formKey: QuestionnaireFormKey = "spmsq") {
  const scoring = buildQuestionnaireRuleCatalogEntry(formKey);
  const validation = buildQuestionnaireValidationCatalogEntry(formKey);
  const bundle = buildQuestionnaireReadinessCatalogEntry(formKey);
  const expected: QuestionnaireReadinessExpected = {
    organizationId: uuid(1), branchId: uuid(2), actorUserId: uuid(3), formKey,
    clientId: uuid(4), versionId: uuid(5), contentHash: "a".repeat(64), readNonce: uuid(6),
  };
  const source = {
    schemaVersion: "questionnaire-readiness-source.v1",
    organizationId: expected.organizationId, branchId: expected.branchId, actorUserId: expected.actorUserId,
    clientId: expected.clientId, formKey, readNonce: expected.readNonce,
    generatedAt: "2026-09-27T10:00:00Z",
    draft: {
      assessmentKey: uuid(7), versionId: expected.versionId, version: 1,
      formVersion: scoring.formVersion, assessedOn: "2026-09-27",
      answers: Object.fromEntries(scoring.manifest.rules.items.map((item) =>
        [item.id, { state: "answered", value: item.choices[0]!.value }])) as Record<string, unknown>,
      context: (formKey === "spmsq" ? { education_adjustment: "middle_or_high_school" }
        : formKey === "mna_sf" ? { height_cm: "200", weight_kg: "70" } : {}) as Record<string, string>,
      recordState: "draft", authorDisplayName: "PRIVATE_AUTHOR_DO_NOT_RETURN",
      createdAt: "2026-09-27T09:59:00Z", contentHash: expected.contentHash,
    },
    currentVersionId: expected.versionId,
    bundle: {
      bundleHash: bundle.bundleHash, canonicalJson: bundle.canonicalJson,
      scoringCanonicalJson: scoring.canonicalJson, scoringCatalogHash: scoring.catalogHash,
      validationCanonicalJson: validation.canonicalJson, validationCatalogHash: validation.validationCatalogHash,
    },
    formalScore: null, signable: false,
  };
  return { scoring, validation, bundle, source, expected };
}

describe("independent questionnaire readiness candidate audit", () => {
  it.each(keys)("binds %s to unchanged exact catalogs and preserves all formal blockers", (formKey) => {
    const { source, expected, scoring, validation, bundle } = fixture(formKey);
    source.draft.context.qualitative_note = "PRIVATE_CONTEXT_DO_NOT_RETURN";
    const original = structuredClone(source);
    const report = buildQuestionnaireReadinessReport(source, expected, now);
    expect(report.candidate).toEqual(evaluateQuestionnaireValidationCandidate(validation, scoring, source.draft.answers, source.draft.context));
    expect(report).toMatchObject({ candidateOnly: true, formalScore: null, signable: false,
      versionId: expected.versionId, contentHash: expected.contentHash, bundleHash: bundle.bundleHash });
    expect(report.blockers).toEqual(persistent);
    expect(report.candidate.status).toBe("complete");
    expect(report.candidate.score).not.toBeNull();
    const wire = JSON.stringify(report);
    expect(wire).not.toMatch(/PRIVATE_|authorDisplayName|qualitative_note|"answers"|"context"/u);
    expect(source).toEqual(original);
  });

  it.each(keys)("evaluates actual saved %s answer changes without converting incomplete or invalid results to formal output", (formKey) => {
    const { source, expected, scoring, validation } = fixture(formKey);
    const item = scoring.manifest.rules.items[0]!;
    for (const value of [{ state: "missing" }, { state: "answered", value: "UNREGISTERED_PRIVATE_VALUE" },
      { state: "not_applicable", reason: "PRIVATE_NA_REASON" }]) {
      source.draft.answers[item.id] = value;
      const report = buildQuestionnaireReadinessReport(source, expected, now);
      const actual = evaluateQuestionnaireValidationCandidate(validation, scoring, source.draft.answers, source.draft.context);
      expect(report.candidate).toEqual(actual);
      expect(report.candidate.score).toBeNull();
      expect(report.candidate.classification).toBeNull();
      expect(report.blockers).toEqual([actual.status === "invalid" ? "answers_invalid" : "answers_incomplete", ...persistent]);
      expect(report).toMatchObject({ formalScore: null, signable: false, candidateOnly: true });
      expect(JSON.stringify(report)).not.toMatch(/PRIVATE_NA_REASON|UNREGISTERED_PRIVATE_VALUE/u);
    }
  });

  it("preserves every frozen scoring catalog byte/hash and constructs nine distinct validation-linked bundles", () => {
    const sql = readFileSync("supabase/migrations/20260926045916_register_questionnaire_rule_candidates.sql", "utf8");
    const rows = [...sql.matchAll(/^ \('([^']+)','([^']+)','([^']+)',([0-9]+),'([a-f0-9]{64})',\$questionnaire_catalog\$(.*?)\$questionnaire_catalog\$\)/gmu)];
    expect(rows).toHaveLength(9);
    const bundles = new Set<string>();
    for (const row of rows) {
      const { scoring, validation, bundle } = fixture(row[1] as QuestionnaireFormKey);
      expect(scoring.catalogHash).toBe(row[5]); expect(scoring.canonicalJson).toBe(row[6]);
      expect(bundle.bundleHash).toBe(digest(bundle.canonicalJson));
      expect(bundle.manifest).toMatchObject({ candidateOnly: true, scoringCatalogHash: scoring.catalogHash,
        validationCatalogHash: validation.validationCatalogHash, validationBoundary: "database-draft-wire" });
      expect(bundle.canonicalJson).not.toMatch(/approvedBy|signedBy|activatedAt|sourceEvidence/u);
      bundles.add(bundle.bundleHash);
    }
    expect(bundles.size).toBe(9);
  });

  it("registers the exact same nine immutable validation and bundle candidates in the incremental migration", () => {
    const sql = readFileSync("supabase/migrations/20260926174621_questionnaire_readiness_candidate_catalog.sql", "utf8");
    const validationRows = sql.split("\n").filter((line) => line.startsWith("insert into private.questionnaire_validation_catalog("));
    const bundleRows = sql.split("\n").filter((line) => line.startsWith("insert into private.questionnaire_readiness_catalog("));
    expect(validationRows).toHaveLength(9); expect(bundleRows).toHaveLength(9);
    const constants = (line: string) => [...line.matchAll(/'((?:''|[^'])*)'/gu)].map((match) => match[1]!.replaceAll("''", "'"));
    for (const line of validationRows) {
      const values = constants(line); expect(values).toHaveLength(8);
      const validation = buildQuestionnaireValidationCatalogEntry(values[2] as QuestionnaireFormKey);
      const scoring = buildQuestionnaireRuleCatalogEntry(values[2] as QuestionnaireFormKey);
      expect(values).toEqual([validation.validationCatalogHash, scoring.catalogHash, scoring.formKey,
        scoring.formVersion, scoring.ruleVersion, validation.manifest.validationVersion, validation.canonicalJson, validation.canonicalJson]);
    }
    for (const line of bundleRows) {
      const values = constants(line); expect(values).toHaveLength(9);
      const { scoring, validation, bundle } = fixture(values[3] as QuestionnaireFormKey);
      expect(values).toEqual([bundle.bundleHash, scoring.catalogHash, validation.validationCatalogHash,
        scoring.formKey, scoring.formVersion, scoring.ruleVersion, validation.manifest.validationVersion, bundle.canonicalJson, bundle.canonicalJson]);
    }
    expect(sql).not.toMatch(/(?:update|delete from|insert into) private\.questionnaire_rule_(?:catalog|activations|review_events)/u);
  });

  it.each(["bundle", "scoring", "validation"] as const)("rejects locally rehashed but unsupported %s manifests", (kind) => {
    const { source, expected } = fixture();
    if (kind === "bundle") {
      const manifest = JSON.parse(source.bundle.canonicalJson); manifest.candidateOnly = false;
      source.bundle.canonicalJson = canonicalRuleJson(manifest); source.bundle.bundleHash = digest(source.bundle.canonicalJson);
    } else if (kind === "scoring") {
      const manifest = JSON.parse(source.bundle.scoringCanonicalJson); manifest.rules.scoreTable[0].adjustedScore = 999;
      source.bundle.scoringCanonicalJson = canonicalRuleJson(manifest); source.bundle.scoringCatalogHash = digest(source.bundle.scoringCanonicalJson);
    } else {
      const manifest = JSON.parse(source.bundle.validationCanonicalJson); manifest.issueRules[0].blocksStorage = false;
      source.bundle.validationCanonicalJson = canonicalRuleJson(manifest); source.bundle.validationCatalogHash = digest(source.bundle.validationCanonicalJson);
    }
    expect(() => buildQuestionnaireReadinessReport(source, expected, now)).toThrow();
  });

  it("rejects cross-form catalogs, mutated canonical bytes, or caller supplied approval/signable flags", () => {
    const base = fixture(); const other = fixture("gds_15");
    for (const change of [
      { ...base.source, bundle: other.source.bundle },
      { ...base.source, bundle: { ...base.source.bundle, canonicalJson: base.source.bundle.canonicalJson + " " } },
      { ...base.source, signable: true }, { ...base.source, formalScore: 0 },
      { ...base.source, adopted: true }, { ...base.source, sourceEvidence: "approved" },
      { ...base.source, draft: { ...base.source.draft, signedBy: uuid(8) } },
    ]) expect(() => buildQuestionnaireReadinessReport(change, base.expected, now)).toThrow();
  });

  it.each(["organizationId", "branchId", "actorUserId", "clientId", "readNonce"] as const)("rejects wrong exact %s", (field) => {
    const { source, expected } = fixture();
    expect(() => buildQuestionnaireReadinessReport({ ...source, [field]: uuid(90) }, expected, now)).toThrow();
    expect(() => buildQuestionnaireReadinessReport(source, { ...expected, [field]: uuid(90) }, now)).toThrow();
  });

  it("rejects wrong form, saved version, hash, form version, record state and malformed source containers", () => {
    const { source, expected } = fixture();
    for (const change of [null, [], { ...source, formKey: "gds_15" },
      { ...source, draft: { ...source.draft, versionId: uuid(90) } },
      { ...source, draft: { ...source.draft, contentHash: "b".repeat(64) } },
      { ...source, draft: { ...source.draft, formVersion: "unsupported-version" } },
      { ...source, draft: { ...source.draft, recordState: "signed" } },
      { ...source, draft: { ...source.draft, version: 1_000_001 } },
      { ...source, draft: { ...source.draft, answers: [] } },
      { ...source, draft: { ...source.draft, context: { qualitative_note: 1 } } },
    ]) expect(() => buildQuestionnaireReadinessReport(change, expected, now)).toThrow();
  });

  it("keeps superseded saved versions explicitly unusable while retaining their candidate identity", () => {
    const { source, expected } = fixture(); source.currentVersionId = uuid(8);
    const report = buildQuestionnaireReadinessReport(source, expected, now);
    expect(report.blockers).toEqual(["version_superseded", ...persistent]);
    expect(report).toMatchObject({ currentVersionId: uuid(8), versionId: expected.versionId, signable: false, formalScore: null });
  });

  it("validates server source age, source chronology, offset time and actual Taipei date", () => {
    const { source, expected } = fixture();
    for (const age of [-60_001, 60_001]) {
      expect(() => buildQuestionnaireReadinessReport({ ...source, generatedAt: new Date(now + age).toISOString() }, expected, now)).toThrow();
    }
    for (const generatedAt of ["2026-09-27T10:00:00", "not-a-time"]) {
      expect(() => buildQuestionnaireReadinessReport({ ...source, generatedAt }, expected, now)).toThrow();
    }
    expect(() => buildQuestionnaireReadinessReport(source, expected, Number.NaN)).toThrow();
    expect(() => buildQuestionnaireReadinessReport({ ...source, draft: { ...source.draft, createdAt: "2026-09-27T10:00:01Z" } }, expected, now)).toThrow();
    for (const assessedOn of ["1999-12-31", "2026-02-30", "2026-09-28"]) {
      expect(() => buildQuestionnaireReadinessReport({ ...source, draft: { ...source.draft, assessedOn } }, expected, now)).toThrow();
    }
    const midnight = Date.parse("2026-09-27T16:00:00Z");
    const nextDay = { ...source, generatedAt: "2026-09-28T00:00:00+08:00",
      draft: { ...source.draft, assessedOn: "2026-09-28", createdAt: "2026-09-27T23:59:00+08:00" } };
    expect(buildQuestionnaireReadinessReport(nextDay, expected, midnight)).toMatchObject({ assessedOn: "2026-09-28", signable: false });
  });

  it("preserves BSRS independent alerts with incomplete total and does not leak alert note text", () => {
    const { source, expected } = fixture("bsrs5");
    source.draft.answers.bsrs_01 = { state: "missing" };
    source.draft.answers.bsrs_suicide = { state: "answered", value: "4" };
    source.draft.context.qualitative_note = "PRIVATE_SUICIDE_NOTE";
    const report = buildQuestionnaireReadinessReport(source, expected, now);
    expect(report.candidate).toMatchObject({ status: "incomplete", score: null, classification: null });
    expect(report.candidate.alerts).toContainEqual(expect.objectContaining({ code: "BSRS_SUICIDE_PROFESSIONAL_REVIEW", requiresAcknowledgement: true }));
    expect(JSON.stringify(report)).not.toContain("PRIVATE_SUICIDE_NOTE");
    expect(report.signable).toBe(false);
  });

  it("retains MNA measured-path and missing-education completion boundaries, not a new signing policy", () => {
    const mna = fixture("mna_sf"); mna.source.draft.context = { height_cm: "200", weight_kg: "70", calf_circumference_cm: "31" };
    const conflict = buildQuestionnaireReadinessReport(mna.source, mna.expected, now);
    expect(conflict.candidate).toMatchObject({ status: "incomplete", score: null, storageValid: false });
    expect(conflict.candidate.issues).toContainEqual(expect.objectContaining({ code: "MEASUREMENT_CONFLICT" }));
    const cognition = fixture(); cognition.source.draft.context = {};
    expect(buildQuestionnaireReadinessReport(cognition.source, cognition.expected, now).candidate)
      .toMatchObject({ status: "incomplete", storageValid: true, score: null });
  });
});
