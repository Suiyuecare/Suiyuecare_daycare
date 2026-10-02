import { z } from "zod";

import { CLIENT_WRITE_TIMEOUT_MS } from "@/lib/api/client-fetch";
import { questionnaireDraftSchema, questionnaireFormKeySchema } from "./contract";
import { getQuestionnaireReadinessBrowserBinding, reproduceQuestionnaireReadinessCandidate } from "./browser-catalog";
import type { QuestionnaireDraft, QuestionnaireFormKey } from "./types";

const uuid = z.string().uuid().refine((value) => value === value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const instant = z.string().datetime({ offset: true });
const draftSchema = questionnaireDraftSchema.omit({ recordState: true }).extend({ recordState: z.literal("draft").optional() }).strict();
const expectedSchema = z.object({
  organizationId: uuid, branchId: uuid, actorUserId: uuid,
  formKey: questionnaireFormKeySchema, clientId: uuid, readNonce: uuid, draft: draftSchema,
}).strict();
const scoreSchema = z.object({ raw: z.number().int().min(0).max(1000).nullable(), adjusted: z.number().int().min(0).max(1000).nullable(),
  min: z.number().int().min(0).max(1000), max: z.number().int().min(0).max(1000), unit: z.enum(["points", "errors"]) }).strict();
const classificationSchema = z.object({ key: z.string().min(1).max(100), label: z.string().min(1).max(300),
  minInclusive: z.number().int().min(0).max(1000), maxInclusive: z.number().int().min(0).max(1000),
  interpretation: z.enum(["screening_only", "functional_description"]) }).strict();
const alertSchema = z.object({ code: z.string().min(1).max(100), level: z.enum(["info", "warning"]),
  message: z.string().min(1).max(1000), requiresAcknowledgement: z.literal(true).optional() }).strict();
const issueSchema = z.object({
  code: z.enum(["INVALID_INPUT", "UNKNOWN_ANSWER", "MISSING_REQUIRED_ANSWER", "INVALID_ANSWER", "NOT_APPLICABLE_ANSWER",
    "UNKNOWN_CONTEXT", "MISSING_REQUIRED_CONTEXT", "INVALID_CONTEXT", "MEASUREMENT_REQUIRED", "MEASUREMENT_CONFLICT", "MEASUREMENT_MISMATCH"]),
  path: z.string().min(1).max(200), category: z.enum(["invalid", "incomplete"]),
  blocksStorage: z.boolean(), blocksCompletion: z.literal(true),
}).strict();
const candidateSchema = z.object({
  schemaVersion: z.literal("questionnaire-validation-result.v1"),
  validationCatalogHash: hash, scoringCatalogHash: hash, candidateOnly: z.literal(true), storageValid: z.boolean(),
  status: z.enum(["invalid", "incomplete", "complete"]), issues: z.array(issueSchema).max(128),
  score: scoreSchema.nullable(), classification: classificationSchema.nullable(), alerts: z.array(alertSchema).max(128),
}).strict();
const blockerSchema = z.enum(["answers_invalid", "answers_incomplete", "version_superseded", "source_evidence_missing",
  "bundle_not_adopted", "signing_policy_missing", "formal_signing_unavailable"]);
const reportSchema = z.object({
  schemaVersion: z.literal("questionnaire-readiness-report.v1"), candidateOnly: z.literal(true),
  organizationId: uuid, branchId: uuid, actorUserId: uuid, formKey: questionnaireFormKeySchema,
  clientId: uuid, readNonce: uuid, generatedAt: instant, assessmentKey: uuid, versionId: uuid,
  version: z.number().int().positive().max(1_000_000), assessedOn: z.iso.date(), contentHash: hash,
  currentVersionId: uuid, bundleHash: hash, formVersion: z.string().min(1).max(100), ruleVersion: z.string().min(1).max(100),
  candidate: candidateSchema, blockers: z.array(blockerSchema).min(4).max(6), formalScore: z.null(), signable: z.literal(false),
}).strict();
const envelopeSchema = z.object({ requestId: uuid, status: z.literal("ok"), data: reportSchema, errors: z.tuple([]) }).strict();

/** Reject non-JSON objects before any schema accesses properties. The limits
 * cover these bounded draft/report structures, not arbitrary document input. */
function assertPlainJson(value: unknown): void {
  let nodes = 0, characters = 0;
  const ancestors = new WeakSet<object>();
  function visit(item: unknown, depth: number): void {
    if (++nodes > 10_000 || depth > 16) throw new Error("Unsupported JSON structure.");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") {
      characters += item.length;
      if (item.length > 65_536 || characters > 2_097_152) throw new Error("Unsupported JSON structure.");
      return;
    }
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object") throw new Error("Unsupported JSON structure.");
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw new Error("Unsupported JSON structure.");
    }
    if (ancestors.has(item)) throw new Error("Unsupported JSON structure.");
    const keys = Reflect.ownKeys(item);
    if (keys.length > 10_001 || keys.some((key) => typeof key !== "string")) throw new Error("Unsupported JSON structure.");
    ancestors.add(item);
    try {
      if (array) {
        const length = Object.getOwnPropertyDescriptor(item, "length");
        if (!length || !("value" in length) || !Number.isInteger(length.value) ||
          length.value < 0 || length.value > 10_000 || keys.length !== length.value + 1) {
          throw new Error("Unsupported JSON structure.");
        }
        for (let index = 0; index < length.value; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("Unsupported JSON structure.");
          visit(descriptor.value, depth + 1);
        }
      } else {
        for (const key of keys) {
          const descriptor = Object.getOwnPropertyDescriptor(item, key);
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("Unsupported JSON structure.");
          visit(descriptor.value, depth + 1);
        }
      }
    } finally { ancestors.delete(item); }
  }
  visit(value, 0);
}

export interface QuestionnaireReadinessClientExpected {
  readonly organizationId: string;
  readonly branchId: string;
  readonly actorUserId: string;
  readonly formKey: QuestionnaireFormKey;
  readonly clientId: string;
  readonly readNonce: string;
  readonly draft: QuestionnaireDraft;
}
export type QuestionnaireReadinessReport = z.infer<typeof reportSchema>;
export type QuestionnaireReadinessReadErrorCode = "INVALID_REQUEST" | "INVALID_RESPONSE" | "UNAVAILABLE" | "ABORTED";

export class QuestionnaireReadinessReadError extends Error {
  constructor(readonly status: number | null, readonly code: QuestionnaireReadinessReadErrorCode) {
    super(code === "ABORTED" ? "評估檢查已取消。" : "本次評估的完成條件尚未確認，請重新檢查。");
    this.name = "QuestionnaireReadinessReadError";
  }
}

function canonical(value: unknown): string {
  function normalize(item: unknown): unknown {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize((item as Record<string, unknown>)[key])]));
    }
    throw new Error("Invalid JSON value.");
  }
  return JSON.stringify(normalize(value));
}

function readExpected(input: QuestionnaireReadinessClientExpected) {
  try {
    // Zod copies the admitted saved draft; later caller edits cannot change an
    // in-flight request's identity or the candidate used to check its response.
    assertPlainJson(input);
    const expected = expectedSchema.parse(input);
    const binding = getQuestionnaireReadinessBrowserBinding(expected.formKey);
    if (expected.draft.formVersion !== binding.formVersion || expected.draft.version > 1_000_000 ||
      !z.iso.date().safeParse(expected.draft.assessedOn).success || expected.draft.assessedOn < "2000-01-01") throw new Error("Invalid saved draft.");
    return expected;
  } catch { throw new QuestionnaireReadinessReadError(null, "INVALID_REQUEST"); }
}

/** Reproduce candidate-only evidence for this exact saved draft, never the
 * editor's unsaved answers. Admission/authority/unmount/ABA fencing is owned by
 * the UI caller; a successful read never grants signing or refreshes its list. */
export function parseQuestionnaireReadinessReport(
  raw: unknown, expectedInput: QuestionnaireReadinessClientExpected, now = Date.now(),
): QuestionnaireReadinessReport {
  const expected = readExpected(expectedInput);
  try {
    assertPlainJson(raw);
    const report = reportSchema.parse(raw);
    const binding = getQuestionnaireReadinessBrowserBinding(expected.formKey);
    for (const field of ["organizationId", "branchId", "actorUserId", "formKey", "clientId", "readNonce"] as const) {
      if (report[field] !== expected[field]) throw new Error("Scope mismatch.");
    }
    for (const field of ["assessmentKey", "versionId", "version", "assessedOn", "contentHash", "formVersion"] as const) {
      if (report[field] !== expected.draft[field]) throw new Error("Saved version mismatch.");
    }
    const generatedAt = Date.parse(report.generatedAt), createdAt = Date.parse(expected.draft.createdAt);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(generatedAt));
    if (!Number.isFinite(now) || !Number.isFinite(generatedAt) || Math.abs(generatedAt - now) > 60_000 ||
      !Number.isFinite(createdAt) || createdAt > generatedAt || report.assessedOn > today ||
      report.bundleHash !== binding.bundleHash || report.formVersion !== binding.formVersion || report.ruleVersion !== binding.ruleVersion ||
      report.candidate.validationCatalogHash !== binding.validationCatalogHash || report.candidate.scoringCatalogHash !== binding.scoringCatalogHash) {
      throw new Error("Readiness evidence mismatch.");
    }
    const reproduced = reproduceQuestionnaireReadinessCandidate(expected.formKey, expected.draft.answers, expected.draft.context);
    if (canonical(report.candidate) !== canonical(reproduced)) throw new Error("Candidate mismatch.");
    const blockers: QuestionnaireReadinessReport["blockers"] = [];
    if (reproduced.status !== "complete") blockers.push(reproduced.status === "invalid" ? "answers_invalid" : "answers_incomplete");
    if (report.currentVersionId !== report.versionId) blockers.push("version_superseded");
    blockers.push("source_evidence_missing", "bundle_not_adopted", "signing_policy_missing", "formal_signing_unavailable");
    if (canonical(report.blockers) !== canonical(blockers)) throw new Error("Blockers mismatch.");
    return report;
  } catch { throw new QuestionnaireReadinessReadError(null, "INVALID_RESPONSE"); }
}

export function parseQuestionnaireReadinessEnvelope(
  raw: unknown, expected: QuestionnaireReadinessClientExpected, now = Date.now(),
): QuestionnaireReadinessReport {
  readExpected(expected);
  try {
    assertPlainJson(raw);
    return parseQuestionnaireReadinessReport(envelopeSchema.parse(raw).data, expected, now);
  }
  catch { throw new QuestionnaireReadinessReadError(null, "INVALID_RESPONSE"); }
}

/** One explicit, private, bounded GET only. No answers in the wire, retries,
 * writes, navigation, logging, storage, or provider error-text passthrough. */
export async function readQuestionnaireReadiness(
  expectedInput: QuestionnaireReadinessClientExpected, signal?: AbortSignal,
): Promise<QuestionnaireReadinessReport> {
  const expected = readExpected(expectedInput);
  if (signal?.aborted) throw new QuestionnaireReadinessReadError(null, "ABORTED");
  const controller = new AbortController();
  const bounded = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), CLIENT_WRITE_TIMEOUT_MS);
  let removeAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(new QuestionnaireReadinessReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE"));
    bounded.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => bounded.removeEventListener("abort", onAbort);
    if (bounded.aborted) onAbort();
  });
  try {
    const operation = (async () => {
      const query = new URLSearchParams({ form_key: expected.formKey, client_id: expected.clientId,
        version_id: expected.draft.versionId, content_hash: expected.draft.contentHash, read_nonce: expected.readNonce });
      let response: Response;
      try {
        response = await fetch(`/api/questionnaire-assessments/readiness?${query}`, {
          method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal: bounded,
          headers: { accept: "application/json" },
        });
      } catch { throw new QuestionnaireReadinessReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE"); }
      if (bounded.aborted) throw new QuestionnaireReadinessReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE");
      if (response.status !== 200 || response.redirected) throw new QuestionnaireReadinessReadError(response.status, "UNAVAILABLE");
      try {
        const raw: unknown = await response.json();
        if (bounded.aborted) throw new QuestionnaireReadinessReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE");
        return parseQuestionnaireReadinessEnvelope(raw, expected, Date.now());
      } catch (error) {
        if (error instanceof QuestionnaireReadinessReadError && error.code === "ABORTED") throw error;
        if (bounded.aborted) throw new QuestionnaireReadinessReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE");
        throw new QuestionnaireReadinessReadError(200, "INVALID_RESPONSE");
      }
    })();
    return await Promise.race([operation, aborted]);
  } finally { clearTimeout(timer); removeAbort(); }
}
