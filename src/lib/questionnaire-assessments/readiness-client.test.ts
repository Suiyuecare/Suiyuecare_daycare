import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { QUESTIONNAIRE_FORMS } from "./forms";
import { getAssessmentDefinition } from "@/lib/assessments/definitions";
import { buildQuestionnaireReadinessCatalogEntry } from "./readiness-catalog";
import { parseQuestionnaireReadinessEnvelope, parseQuestionnaireReadinessReport, readQuestionnaireReadiness,
  QuestionnaireReadinessReadError, type QuestionnaireReadinessClientExpected } from "./readiness-client";
import { buildQuestionnaireReadinessReport } from "./readiness-source";
import { buildQuestionnaireRuleCatalogEntry } from "./rule-catalog";
import type { QuestionnaireAnswer, QuestionnaireDraft, QuestionnaireFormKey } from "./types";
import { buildQuestionnaireValidationCatalogEntry } from "./validation-catalog";

const organizationId = "1000000a-0000-4000-8000-000000000001";
const branchId = "2000000b-0000-4000-8000-000000000001";
const actorUserId = "3000000c-0000-4000-8000-000000000001";
const clientId = "4000000d-0000-4000-8000-000000000001";
const versionId = "5000000e-0000-4000-8000-000000000001";
const assessmentKey = "6000000f-0000-4000-8000-000000000001";
const readNonce = "7000000a-0000-4000-8000-000000000001";
const otherId = "8000000b-0000-4000-8000-000000000001";
const requestId = "9000000c-0000-4000-8000-000000000001";
const now = Date.parse("2026-09-27T01:00:00.000Z");
const keys = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];
const persistent = ["source_evidence_missing", "bundle_not_adopted", "signing_policy_missing", "formal_signing_unavailable"];

function fixture(formKey: QuestionnaireFormKey = "spmsq", patch: Partial<QuestionnaireDraft> = {}) {
  const form = QUESTIONNAIRE_FORMS[formKey], scoring = buildQuestionnaireRuleCatalogEntry(formKey);
  const validation = buildQuestionnaireValidationCatalogEntry(formKey), bundle = buildQuestionnaireReadinessCatalogEntry(formKey);
  const answers: Record<string, QuestionnaireAnswer> = Object.fromEntries(form.questions.map(({ id, choices }) => [id, { state: "answered", value: choices[0]!.value }]));
  const context: Record<string, string> = { qualitative_note: "SYNTHETIC_PRIVATE_NOTE_DO_NOT_RETURN" };
  if (formKey === "spmsq") context.education_adjustment = "middle_or_high_school";
  if (formKey === "mna_sf") { answers.anthropometry = { state: "answered", value: "bmi_19_lt_21" }; context.height_cm = "170"; context.weight_kg = "60"; }
  const draft = { assessmentKey, versionId, version: 1, formVersion: form.version, assessedOn: "2026-09-26",
    answers, context, recordState: "draft" as const, authorDisplayName: "SYNTHETIC_PRIVATE_AUTHOR_DO_NOT_RETURN",
    createdAt: "2026-09-26T01:00:00.000Z", contentHash: "a".repeat(64), ...patch };
  const expected: QuestionnaireReadinessClientExpected = { organizationId, branchId, actorUserId, formKey, clientId, readNonce, draft };
  const report = buildQuestionnaireReadinessReport({ schemaVersion: "questionnaire-readiness-source.v1", organizationId, branchId, actorUserId,
    formKey, clientId, readNonce, generatedAt: new Date(now).toISOString(), draft, currentVersionId: draft.versionId,
    bundle: { bundleHash: bundle.bundleHash, canonicalJson: bundle.canonicalJson, scoringCanonicalJson: scoring.canonicalJson,
      scoringCatalogHash: scoring.catalogHash, validationCanonicalJson: validation.canonicalJson, validationCatalogHash: validation.validationCatalogHash },
    formalScore: null, signable: false }, { organizationId, branchId, actorUserId, formKey, clientId, readNonce,
      versionId: draft.versionId, contentHash: draft.contentHash }, now);
  return { expected, report, form };
}
function envelope(data = fixture().report) { return { requestId, status: "ok", data, errors: [] }; }
function invalid(raw: unknown, expected = fixture().expected, clock = now) {
  expect(() => parseQuestionnaireReadinessReport(raw, expected, clock)).toThrow(QuestionnaireReadinessReadError);
  try { parseQuestionnaireReadinessReport(raw, expected, clock); }
  catch (error) {
    expect(error).toMatchObject({ code: "INVALID_RESPONSE", status: null });
    expect((error as Error).message).not.toMatch(/SYNTHETIC_PRIVATE|stack|secret|provider|authorDisplayName/u);
  }
}

describe("strict browser questionnaire readiness evidence", () => {
  it.each(keys)("matches independently built server evidence for complete %s without formal activation", (key) => {
    const { expected, report } = fixture(key);
    expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
    expect(report.candidate.status).toBe("complete"); expect(report.signable).toBe(false); expect(report.formalScore).toBeNull();
    expect(report.blockers).toEqual(persistent);
    expect(JSON.stringify(parseQuestionnaireReadinessEnvelope(envelope(report), expected, now))).not.toMatch(/SYNTHETIC_PRIVATE|qualitative_note|canonicalJson/u);
  });
  it.each(keys)("reproduces a missing %s answer instead of accepting an invented zero", (key) => {
    const initial = fixture(key), first = initial.form.questions[0]!.id;
    const { expected, report } = fixture(key, { answers: { ...initial.expected.draft.answers, [first]: { state: "missing" } } });
    expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
    expect(report.candidate.status).toBe("incomplete"); expect(report.candidate.score).toBeNull(); expect(report.blockers[0]).toBe("answers_incomplete");
  });
  it.each(keys)("reproduces invalid choice in %s rather than trusting the claimed score", (key) => {
    const initial = fixture(key), first = initial.form.questions[0]!.id;
    const { expected, report } = fixture(key, { answers: { ...initial.expected.draft.answers, [first]: { state: "answered", value: "forged-choice" } } });
    expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
    expect(report.candidate.status).toBe("invalid"); expect(report.candidate.score).toBeNull(); expect(report.blockers[0]).toBe("answers_invalid");
  });
  it.each(keys)("reproduces the exact database N/A policy for %s without making it complete", (key) => {
    const initial = fixture(key), first = initial.form.questions[0]!.id;
    const { expected, report } = fixture(key, { answers: { ...initial.expected.draft.answers, [first]: { state: "not_applicable", reason: "合成不適用原因" } } });
    expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
    expect(report.candidate.status).toBe(["spmsq", "gds_15", "eat10_swallowing", "bsrs5"].includes(key) ? "invalid" : "incomplete");
    expect(report.candidate.score).toBeNull(); expect(report.signable).toBe(false);
  });
  it.each(keys)("matches every registered choice and weighted rule for %s", (key) => {
    const initial = fixture(key);
    for (const question of initial.form.questions) for (const choice of question.choices) {
      let context = initial.expected.draft.context;
      if (key === "mna_sf" && question.id === "anthropometry") {
        const measurements: Record<string, Record<string, string>> = {
          bmi_lt_19: { height_cm: "200", weight_kg: "70" }, bmi_19_lt_21: { height_cm: "200", weight_kg: "80" },
          bmi_21_lt_23: { height_cm: "200", weight_kg: "88" }, bmi_gte_23: { height_cm: "200", weight_kg: "96" },
          calf_lt_31: { calf_circumference_cm: "30.9" }, calf_gte_31: { calf_circumference_cm: "31" },
        };
        context = measurements[choice.value]!;
      }
      const { expected, report } = fixture(key, { answers: { ...initial.expected.draft.answers, [question.id]: { state: "answered", value: choice.value } }, context });
      expect(report.candidate.status).toBe("complete");
      expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
    }
  });
  it.each(keys)("matches minimum/maximum weighted scores and classification boundaries for %s", (key) => {
    const initial = fixture(key), definition = getAssessmentDefinition(initial.form.scoreVersionId!)!;
    for (const extreme of ["minimum", "maximum"] as const) {
      const answers = Object.fromEntries(definition.items.map((item) => {
        const ordered = [...item.choices].sort((left, right) => extreme === "minimum" ? left.points - right.points : right.points - left.points);
        return [item.id, { state: "answered" as const, value: ordered[0]!.value }];
      }));
      const context = key === "mna_sf" ? { height_cm: "200", weight_kg: extreme === "minimum" ? "70" : "96" } as Record<string, string> : initial.expected.draft.context;
      const { expected, report } = fixture(key, { answers, context });
      expect(report.candidate.status).toBe("complete"); expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
    }
  });
  it.each(["grade_school_or_less", "middle_or_high_school", "beyond_high_school"])("reproduces all SPMSQ education adjustments %s at every raw-score boundary", (education) => {
    const initial = fixture();
    for (let count = 0; count <= 10; count += 1) {
      const answers = Object.fromEntries(initial.form.questions.map(({ id }, index) => [id, { state: "answered" as const, value: index < count ? "incorrect" : "correct" }]));
      const { expected, report } = fixture("spmsq", { answers, context: { education_adjustment: education } });
      expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
    }
  });
  it.each(keys)("requires exact issue order for absent and unknown keys in %s without echoing private key text", (key) => {
    const initial = fixture(key), first = initial.form.questions[0]!.id, answers = { ...initial.expected.draft.answers };
    delete answers[first]; answers.SYNTHETIC_PRIVATE_UNKNOWN_KEY = { state: "answered", value: "private-value" };
    const { expected, report } = fixture(key, { answers, context: { ...initial.expected.draft.context, SYNTHETIC_PRIVATE_CONTEXT: "private-value" } });
    expect(report.candidate.storageValid).toBe(false); expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
    expect(JSON.stringify(report)).not.toMatch(/SYNTHETIC_PRIVATE|private-value/u);
    Object.assign(report.candidate, { issues: [...report.candidate.issues].reverse() }); invalid(report, expected);
  });
  it("preserves BSRS safety evidence independently of unanswered ordinary items", () => {
    const initial = fixture("bsrs5");
    const { expected, report } = fixture("bsrs5", { answers: { ...initial.expected.draft.answers,
      bsrs_01: { state: "missing" }, bsrs_suicide: { state: "answered", value: "2" } } });
    expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
    expect(report.candidate.alerts).toContainEqual(expect.objectContaining({ code: "BSRS_SUICIDE_PROFESSIONAL_REVIEW", requiresAcknowledgement: true }));
    Object.assign(report.candidate, { alerts: [] }); invalid(report, expected);
  });
  it.each(["19", "21", "23"])("reproduces MNA's exact BMI boundary %s", (bmi) => {
    const choice = bmi === "19" ? "bmi_19_lt_21" : bmi === "21" ? "bmi_21_lt_23" : "bmi_gte_23";
    const initial = fixture("mna_sf"), { expected, report } = fixture("mna_sf", {
      answers: { ...initial.expected.draft.answers, anthropometry: { state: "answered", value: choice } }, context: { height_cm: "200", weight_kg: String(Number(bmi) * 4) } });
    expect(report.candidate.status).toBe("complete"); expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
  });
  it.each([{ height_cm: "170", weight_kg: "60", calf_circumference_cm: "31" }, { height_cm: "170" },
    { height_cm: "170", weight_kg: "60\n" }, { height_cm: "170", weight_kg: "66.4" }] as Record<string, string>[])("reproduces MNA conflict/missing/invalid/mismatch rather than rounding it away", (context) => {
    const { expected, report } = fixture("mna_sf", { context });
    expect(report.candidate.status).not.toBe("complete"); expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
  });
  it.each(["漢".repeat(3000), "\t保留合法Tab\n", "\u0085", "\u009f", " note ", "\ud800"])("matches persisted text semantics without returning private text", (text) => {
    const { expected, report } = fixture("gds_15", { context: { qualitative_note: text } });
    expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
    expect(JSON.stringify(report)).not.toContain("qualitative_note\":");
  });
  it.each(["organizationId", "branchId", "actorUserId", "clientId", "assessmentKey", "versionId", "readNonce"])("rejects wrong %s binding", (field) => {
    const { expected, report } = fixture(); Object.assign(report, { [field]: otherId }); invalid(report, expected);
  });
  it.each(["version", "assessedOn", "contentHash", "formVersion", "ruleVersion", "bundleHash", "formKey"])("rejects mismatched %s identity", (field) => {
    const { expected, report } = fixture(); Object.assign(report, { [field]: field === "version" ? 2 : field === "assessedOn" ? "2026-09-25" : field === "contentHash" || field === "bundleHash" ? "b".repeat(64) : "wrong" }); invalid(report, expected);
  });
  it.each(["candidateOnly", "signable", "formalScore", "adopted", "rawDraft", "score"])("rejects forged authority or extra report field %s", (field) => {
    const { expected, report } = fixture(); Object.assign(report, { [field]: field === "candidateOnly" ? false : true }); invalid(report, expected);
  });
  it.each(["storageValid", "status", "score", "classification", "alerts", "issues", "validationCatalogHash", "scoringCatalogHash", "candidateOnly", "extra"])("rejects forged candidate %s even when the wire is well formed", (field) => {
    const { expected, report } = fixture();
    const values: Record<string, unknown> = { storageValid: false, status: "incomplete", score: { ...report.candidate.score, raw: 9 },
      classification: { ...report.candidate.classification, label: "forged" }, alerts: [{ code: "FORGED", level: "warning", message: "provider private text" }],
      issues: [{ code: "MISSING_REQUIRED_ANSWER", path: "answers.spmsq_01", category: "incomplete", blocksStorage: false, blocksCompletion: true }],
      validationCatalogHash: "b".repeat(64), scoringCatalogHash: "b".repeat(64), candidateOnly: false, extra: true };
    Object.assign(report.candidate, { [field]: values[field] }); invalid(report, expected);
  });
  it.each(persistent)("requires the persistent blocker %s and refuses duplicate replacements", (field) => {
    const { expected, report } = fixture(); Object.assign(report, { blockers: report.blockers.filter((entry) => entry !== field) }); invalid(report, expected);
    Object.assign(report, { blockers: [...persistent.filter((entry) => entry !== field), persistent[0]] }); invalid(report, expected);
  });
  it("does not drop incompleteness or superseded state, and allows only the exact selected historical version", () => {
    const initial = fixture(), { expected, report } = fixture("spmsq", { answers: { ...initial.expected.draft.answers, spmsq_01: { state: "missing" } } });
    Object.assign(report, { currentVersionId: otherId, blockers: ["answers_incomplete", "version_superseded", ...persistent] });
    expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
    Object.assign(report, { blockers: ["answers_incomplete", ...persistent] }); invalid(report, expected);
    Object.assign(report, { blockers: ["version_superseded", ...persistent] }); invalid(report, expected);
  });
  it.each([-60_001, 60_001])("rejects evidence %s ms from the observed clock", (offset) => {
    const { expected, report } = fixture(); Object.assign(report, { generatedAt: new Date(now + offset).toISOString() }); invalid(report, expected);
  });
  it.each([-60_000, 60_000])("accepts the exact inclusive freshness bound %s without activating", (offset) => {
    const { expected, report } = fixture(); Object.assign(report, { generatedAt: new Date(now + offset).toISOString() }); expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
  });
  it.each([NaN, Infinity, -Infinity])("rejects nonfinite observation clock", (clock) => { const { expected, report } = fixture(); invalid(report, expected, clock); });
  it("rejects an in-flight payload for a different saved answer set despite reusing its version/hash identity", () => {
    const original = fixture();
    const changed = fixture("spmsq", { answers: { ...original.expected.draft.answers, spmsq_01: { state: "answered", value: "incorrect" } } });
    invalid(changed.report, original.expected);
  });
  it("rejects saved version creation after evidence time and an assessment future date", () => {
    const { expected, report } = fixture(); Object.assign(expected.draft, { createdAt: new Date(now + 1).toISOString() }); invalid(report, expected);
    Object.assign(expected.draft, { createdAt: "2026-09-26T01:00:00.000Z", assessedOn: "2026-09-28" }); Object.assign(report, { assessedOn: "2026-09-28" }); invalid(report, expected);
  });
  it("rejects unsigned-draft masquerades and unbounded versions before requesting", async () => {
    const { expected } = fixture(); Object.assign(expected.draft, { recordState: "signed" });
    await expect(readQuestionnaireReadiness(expected)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    Object.assign(expected.draft, { recordState: "draft", version: 1_000_001 });
    await expect(readQuestionnaireReadiness(expected)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it.each(["data", "status", "errors", "requestId", "extra"])("rejects malformed envelope %s without reflecting payload errors", (field) => {
    const { expected, report } = fixture(); const value = envelope(report);
    Object.assign(value, { [field]: field === "data" ? null : field === "errors" ? [{ message: "SYNTHETIC_PRIVATE_NOTE_DO_NOT_RETURN" }] : "wrong" });
    expect(() => parseQuestionnaireReadinessEnvelope(value, expected, now)).toThrow(QuestionnaireReadinessReadError);
  });
  it("has no browser runtime server-only, crypto, storage, logging or write import", () => {
    const source = readFileSync(new URL("./readiness-client.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/server-only|node:|localStorage|sessionStorage|indexedDB|console\.|method:\s*["'](?:POST|PATCH|PUT|DELETE)/u);
  });
});

describe("descriptor-based JSON boundary before schema access", () => {
  type Entry = "expected" | "report" | "envelope";
  const entries: Entry[] = ["expected", "report", "envelope"];
  function input(entry: Entry) {
    const { expected, report } = fixture();
    const value: Record<string, unknown> = entry === "expected" ? expected as unknown as Record<string, unknown>
      : entry === "report" ? report : envelope(report);
    return { value, invoke: () => entry === "expected" ? parseQuestionnaireReadinessReport(report, value as unknown as QuestionnaireReadinessClientExpected, now)
      : entry === "report" ? parseQuestionnaireReadinessReport(value, expected, now)
        : parseQuestionnaireReadinessEnvelope(value, expected, now) };
  }
  it.each(entries)("never invokes an enumerable %s getter while validating", (entry) => {
    const { value, invoke } = input(entry), getter = vi.fn(() => "SYNTHETIC_PRIVATE_GETTER");
    Object.defineProperty(value, entry === "expected" ? "organizationId" : "schemaVersion", { enumerable: true, get: getter });
    expect(invoke).toThrow(QuestionnaireReadinessReadError); expect(getter).not.toHaveBeenCalled();
  });
  it.each(entries)("never invokes nested %s accessors before schema copying", (entry) => {
    const { value, invoke } = input(entry), getter = vi.fn(() => "SYNTHETIC_PRIVATE_GETTER");
    const target = entry === "expected" ? (value.draft as QuestionnaireDraft).answers.spmsq_01!
      : entry === "report" ? value.candidate as Record<string, unknown> : value.data as Record<string, unknown>;
    Object.defineProperty(target, entry === "expected" ? "value" : entry === "report" ? "issues" : "candidate", { enumerable: true, get: getter });
    expect(invoke).toThrow(QuestionnaireReadinessReadError); expect(getter).not.toHaveBeenCalled();
  });
  for (const defect of ["nonenumerable", "symbol", "hole", "cycle", "prototype", "array-property", "array-prototype", "undefined", "depth", "nodes", "string"] as const) {
    it.each(entries)(`rejects ${defect} at the %s boundary without exposing input`, (entry) => {
      const { value, invoke } = input(entry);
      if (defect === "nonenumerable") Object.defineProperty(value, "SYNTHETIC_PRIVATE", { value: "private", enumerable: false });
      else if (defect === "symbol") Object.defineProperty(value, Symbol("SYNTHETIC_PRIVATE"), { value: "private", enumerable: true });
      else if (defect === "prototype") Object.setPrototypeOf(value, { inherited: "SYNTHETIC_PRIVATE" });
      else if (defect === "cycle") value.untrusted = value;
      else if (defect === "undefined") value.untrusted = undefined;
      else if (defect === "string") value.untrusted = "x".repeat(65_537);
      else if (defect === "nodes") value.untrusted = Array.from({ length: 10_000 }, () => true);
      else if (defect === "depth") {
        let nested: Record<string, unknown> = {}; value.untrusted = nested;
        for (let count = 0; count < 17; count += 1) { const child = {}; nested.child = child; nested = child; }
      } else {
        const array = defect === "hole" ? Array(1) : [];
        if (defect === "array-property") Object.assign(array, { extra: true });
        if (defect === "array-prototype") Object.setPrototypeOf(array, Object.create(Array.prototype));
        value.untrusted = array;
      }
      try { invoke(); throw new Error("Unexpected acceptance."); }
      catch (error) { expect(error).toBeInstanceOf(QuestionnaireReadinessReadError); expect((error as Error).message).not.toMatch(/SYNTHETIC_PRIVATE|private/u); }
    });
  }
  it("rejects array-index getters without executing them", () => {
    const { expected, report } = fixture(), getter = vi.fn(() => ({ code: "INVALID_INPUT" }));
    const issues: unknown[] = []; Object.defineProperty(issues, "0", { enumerable: true, get: getter });
    Object.assign(report.candidate, { issues });
    expect(() => parseQuestionnaireReadinessReport(report, expected, now)).toThrow(QuestionnaireReadinessReadError); expect(getter).not.toHaveBeenCalled();
  });
  it("accepts frozen JSON data and plain null-prototype objects without treating them as authority", () => {
    const { expected, report } = fixture();
    Object.freeze(expected.draft.answers); Object.freeze(expected.draft); Object.freeze(expected); Object.freeze(report);
    expect(parseQuestionnaireReadinessReport(report, expected, now)).toEqual(report);
    const plain = Object.assign(Object.create(null) as Record<string, unknown>, report);
    expect(parseQuestionnaireReadinessReport(plain, expected, now)).toEqual(report);
  });
});

describe("bounded manual questionnaire readiness GET", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockResolvedValue(Response.json(envelope())); });
  afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.unstubAllGlobals(); vi.useRealTimers(); });
  it.each(keys)("requests only the exact five identifiers for %s and never sends draft answers", async (key) => {
    const { expected, report } = fixture(key); fetchMock.mockResolvedValue(Response.json(envelope(report)));
    expect(await readQuestionnaireReadiness(expected)).toEqual(report); expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!; const query = new URL(url, "https://example.invalid").searchParams;
    expect([...query.keys()].sort()).toEqual(["client_id", "content_hash", "form_key", "read_nonce", "version_id"]);
    expect(query.get("client_id")).toBe(clientId); expect(query.get("read_nonce")).toBe(readNonce);
    expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", headers: { accept: "application/json" } });
    expect(init.body).toBeUndefined(); expect(JSON.stringify({ url, init })).not.toMatch(/SYNTHETIC_PRIVATE|qualitative_note|answers|education_adjustment/u);
  });
  it.each([401, 403, 409, 503])("returns generic HTTP %s failure without reading provider error text or retrying", async (status) => {
    const json = vi.fn(async () => ({ errors: [{ message: "SYNTHETIC_PRIVATE_PROVIDER_STACK" }] }));
    fetchMock.mockResolvedValue({ status, redirected: false, json });
    await expect(readQuestionnaireReadiness(fixture().expected)).rejects.toMatchObject({ code: "UNAVAILABLE", status });
    expect(json).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects a redirected mock response instead of accepting a different scope's payload", async () => {
    fetchMock.mockResolvedValue({ status: 200, redirected: true, json: vi.fn() });
    await expect(readQuestionnaireReadiness(fixture().expected)).rejects.toMatchObject({ code: "UNAVAILABLE", status: 200 });
  });
  it("validates request identity before any HTTP or timer operation", async () => {
    const expected = fixture().expected; Object.assign(expected, { readNonce: "wrong" });
    await expect(readQuestionnaireReadiness(expected)).rejects.toMatchObject({ code: "INVALID_REQUEST", status: null }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not fetch when the owner's signal is already aborted", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readQuestionnaireReadiness(fixture().expected, controller.signal)).rejects.toMatchObject({ code: "ABORTED" }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["fetch", "body"])("bounds an uncooperative %s at exactly 20 seconds and ignores its late result", async (phase) => {
    let release!: (value: unknown) => void;
    const hanging = new Promise((resolve) => { release = resolve; });
    if (phase === "fetch") fetchMock.mockReturnValue(hanging);
    else fetchMock.mockResolvedValue({ status: 200, redirected: false, json: () => hanging });
    const outputs: unknown[] = [], pending = readQuestionnaireReadiness(fixture().expected).then((value) => outputs.push(value), (error) => { outputs.push(error); throw error; });
    const asserted = expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE", status: null });
    await vi.advanceTimersByTimeAsync(19_999); expect(outputs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); await asserted;
    const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal; expect(signal.aborted).toBe(true); expect(outputs).toHaveLength(1);
    release(phase === "fetch" ? Response.json(envelope()) : envelope()); await vi.advanceTimersByTimeAsync(100);
    expect(outputs).toHaveLength(1); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["fetch", "body"])("owner abort stops an uncooperative %s without waiting for deadline", async (phase) => {
    const hanging = new Promise(() => {}), controller = new AbortController();
    if (phase === "fetch") fetchMock.mockReturnValue(hanging); else fetchMock.mockResolvedValue({ status: 200, redirected: false, json: () => hanging });
    const pending = readQuestionnaireReadiness(fixture().expected, controller.signal);
    const asserted = expect(pending).rejects.toMatchObject({ code: "ABORTED", status: null });
    await vi.advanceTimersByTimeAsync(0); controller.abort(); await asserted;
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("copies original admitted saved answers before waiting, without claiming current UI admission", async () => {
    const { expected, report } = fixture(); let release!: (value: unknown) => void;
    fetchMock.mockResolvedValue({ status: 200, redirected: false, json: () => new Promise((resolve) => { release = resolve; }) });
    const pending = readQuestionnaireReadiness(expected); await vi.advanceTimersByTimeAsync(0);
    Object.assign(expected.draft.answers, { spmsq_01: { state: "answered", value: "incorrect" } });
    release(envelope(report)); expect(await pending).toEqual(report); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed JSON and forged report after a successful HTTP status", async () => {
    fetchMock.mockResolvedValue({ status: 200, redirected: false, json: () => Promise.reject(new Error("SYNTHETIC_PRIVATE_JSON_STACK")) });
    await expect(readQuestionnaireReadiness(fixture().expected)).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
    const { expected, report } = fixture(); Object.assign(report, { signable: true }); fetchMock.mockResolvedValue(Response.json(envelope(report)));
    await expect(readQuestionnaireReadiness(expected)).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
  });
  it("clears successful timer and never aborts a completed read later", async () => {
    await readQuestionnaireReadiness(fixture().expected);
    const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    expect(signal.aborted).toBe(false); await vi.advanceTimersByTimeAsync(20_001); expect(signal.aborted).toBe(false); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
