import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { questionnaireDraftSchema, questionnaireFormKeySchema } from "./contract";
import { buildQuestionnaireReadinessCatalogEntry } from "./readiness-catalog";
import { buildQuestionnaireRuleCatalogEntry } from "./rule-catalog";
import type { QuestionnaireFormKey } from "./types";
import { buildQuestionnaireValidationCatalogEntry } from "./validation-catalog";
import { evaluateQuestionnaireValidationCandidate } from "./validation-evaluator";

const uuid = z.string().uuid().refine((value) => value === value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const instant = z.string().datetime({ offset: true });
const expectedSchema = z.object({
  organizationId: uuid, branchId: uuid, actorUserId: uuid, formKey: questionnaireFormKeySchema,
  clientId: uuid, versionId: uuid, contentHash: hash, readNonce: uuid,
}).strict();
const sourceSchema = z.object({
  schemaVersion: z.literal("questionnaire-readiness-source.v1"),
  organizationId: uuid, branchId: uuid, actorUserId: uuid, formKey: questionnaireFormKeySchema,
  clientId: uuid, readNonce: uuid, generatedAt: instant,
  draft: questionnaireDraftSchema,
  currentVersionId: uuid,
  bundle: z.object({
    bundleHash: hash, canonicalJson: z.string().min(2).max(2_097_152),
    scoringCanonicalJson: z.string().min(2).max(2_097_152), scoringCatalogHash: hash,
    validationCanonicalJson: z.string().min(2).max(2_097_152), validationCatalogHash: hash,
  }).strict(),
  formalScore: z.null(), signable: z.literal(false),
}).strict();

export interface QuestionnaireReadinessExpected {
  readonly organizationId: string;
  readonly branchId: string;
  readonly actorUserId: string;
  readonly formKey: QuestionnaireFormKey;
  readonly clientId: string;
  readonly versionId: string;
  readonly contentHash: string;
  readonly readNonce: string;
}

export type QuestionnaireReadinessBlocker =
  | "answers_invalid" | "answers_incomplete" | "version_superseded"
  | "source_evidence_missing" | "bundle_not_adopted"
  | "signing_policy_missing" | "formal_signing_unavailable";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Reproduce a candidate from one authorized, immutable saved version. No input
 * answers from the request, rule activation, clinical write, or signing claim.
 * Database source contents are never returned to the browser by this function.
 */
export function buildQuestionnaireReadinessReport(
  input: unknown,
  expectedInput: QuestionnaireReadinessExpected,
  now = Date.now(),
) {
  const expected = expectedSchema.parse(expectedInput);
  const source = sourceSchema.parse(input);
  for (const key of ["organizationId", "branchId", "actorUserId", "formKey", "clientId", "readNonce"] as const) {
    if (source[key] !== expected[key]) throw new Error("Questionnaire readiness source scope mismatch.");
  }
  const generatedAt = Date.parse(source.generatedAt);
  const createdAt = Date.parse(source.draft.createdAt);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(generatedAt));
  if (!Number.isFinite(now) || !Number.isFinite(generatedAt) || Math.abs(generatedAt - now) > 60_000 ||
    !Number.isFinite(createdAt) || createdAt > generatedAt ||
    !z.iso.date().safeParse(source.draft.assessedOn).success || source.draft.assessedOn < "2000-01-01" ||
    source.draft.assessedOn > today || source.draft.version > 1_000_000 ||
    source.draft.versionId !== expected.versionId || source.draft.contentHash !== expected.contentHash) {
    throw new Error("Questionnaire readiness source version is not confirmed.");
  }
  const scoring = buildQuestionnaireRuleCatalogEntry(expected.formKey);
  const validation = buildQuestionnaireValidationCatalogEntry(expected.formKey);
  const bundle = buildQuestionnaireReadinessCatalogEntry(expected.formKey);
  if (source.draft.formVersion !== bundle.manifest.formVersion ||
    source.bundle.bundleHash !== bundle.bundleHash || source.bundle.canonicalJson !== bundle.canonicalJson ||
    source.bundle.scoringCatalogHash !== scoring.catalogHash || source.bundle.scoringCanonicalJson !== scoring.canonicalJson ||
    source.bundle.validationCatalogHash !== validation.validationCatalogHash || source.bundle.validationCanonicalJson !== validation.canonicalJson ||
    digest(source.bundle.canonicalJson) !== source.bundle.bundleHash ||
    digest(source.bundle.scoringCanonicalJson) !== source.bundle.scoringCatalogHash ||
    digest(source.bundle.validationCanonicalJson) !== source.bundle.validationCatalogHash) {
    throw new Error("Questionnaire readiness candidate identity is not confirmed.");
  }
  const candidate = evaluateQuestionnaireValidationCandidate(validation, scoring, source.draft.answers, source.draft.context);
  const blockers: QuestionnaireReadinessBlocker[] = [];
  if (candidate.status !== "complete") blockers.push(candidate.status === "invalid" ? "answers_invalid" : "answers_incomplete");
  if (source.currentVersionId !== source.draft.versionId) blockers.push("version_superseded");
  // These capabilities do not exist yet. A scoring-only adoption, supplied
  // source URL, role label or caller's success flag cannot waive these gates.
  blockers.push("source_evidence_missing", "bundle_not_adopted", "signing_policy_missing", "formal_signing_unavailable");
  return {
    schemaVersion: "questionnaire-readiness-report.v1" as const,
    candidateOnly: true as const,
    organizationId: source.organizationId, branchId: source.branchId, actorUserId: source.actorUserId,
    formKey: source.formKey, clientId: source.clientId, readNonce: source.readNonce,
    generatedAt: source.generatedAt,
    assessmentKey: source.draft.assessmentKey, versionId: source.draft.versionId,
    version: source.draft.version, assessedOn: source.draft.assessedOn, contentHash: source.draft.contentHash,
    currentVersionId: source.currentVersionId,
    bundleHash: bundle.bundleHash, formVersion: bundle.manifest.formVersion, ruleVersion: bundle.manifest.ruleVersion,
    candidate, blockers, formalScore: null, signable: false as const,
  };
}
