import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ getTenantContext: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: stubs.getTenantContext, hasRecentAal2: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));

import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import { buildQuestionnaireReadinessCatalogEntry } from "@/lib/questionnaire-assessments/readiness-catalog";
import { buildQuestionnaireRuleCatalogEntry } from "@/lib/questionnaire-assessments/rule-catalog";
import type { QuestionnaireFormKey } from "@/lib/questionnaire-assessments/types";
import { buildQuestionnaireValidationCatalogEntry } from "@/lib/questionnaire-assessments/validation-catalog";
import * as route from "./route";

const organizationId = "1000000a-0000-4000-8000-000000000001";
const branchId = "2000000b-0000-4000-8000-000000000001";
const actorUserId = "3000000c-0000-4000-8000-000000000001";
const clientId = "4000000d-0000-4000-8000-000000000001";
const versionId = "5000000e-0000-4000-8000-000000000001";
const assessmentKey = "6000000f-0000-4000-8000-000000000001";
const readNonce = "7000000a-0000-4000-8000-000000000001";
const otherId = "8000000b-0000-4000-8000-000000000001";
const contentHash = "a".repeat(64);
const now = new Date("2026-09-27T01:00:00.000Z");
const formKeys = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];
const actor = { organizationId, branchId, userId: actorUserId, demo: false, assuranceLevel: "aal1", recentAal2At: null,
  roles: ["case_manager_social_worker"], scopes: ["clients.read", "questionnaire_cognition.read"] };

function scopeFor(form: QuestionnaireFormKey) {
  return form === "spmsq" ? "questionnaire_cognition.read"
    : form === "barthel_adl" || form === "lawton_iadl" ? "questionnaire_adl.read"
      : form === "eat10_swallowing" ? "questionnaire_swallowing.read"
        : form === "bsrs5" || form === "gds_15" ? "questionnaire_emotion.read"
          : form === "fall_risk_taipei_115" ? "questionnaire_fall.read" : "questionnaire_nutrition.read";
}

function source(formKey: QuestionnaireFormKey = "spmsq") {
  const form = QUESTIONNAIRE_FORMS[formKey];
  const bundle = buildQuestionnaireReadinessCatalogEntry(formKey);
  const scoring = buildQuestionnaireRuleCatalogEntry(formKey);
  const validation = buildQuestionnaireValidationCatalogEntry(formKey);
  const answers = Object.fromEntries(form.questions.map((question) => [question.id, { state: "answered", value: question.choices[0]!.value }]));
  const context: Record<string, string> = { qualitative_note: "私密合成備註：不得出現在完成條件回覆" };
  if (formKey === "spmsq") context.education_adjustment = "middle_or_high_school";
  if (formKey === "mna_sf") {
    answers.anthropometry = { state: "answered", value: "bmi_19_lt_21" };
    context.height_cm = "170"; context.weight_kg = "60";
  }
  return { schemaVersion: "questionnaire-readiness-source.v1", organizationId, branchId, actorUserId,
    formKey, clientId, readNonce, generatedAt: now.toISOString(), currentVersionId: versionId,
    draft: { assessmentKey, versionId, version: 1, formVersion: form.version, assessedOn: "2026-09-26", answers,
      context, recordState: "draft", authorDisplayName: "私密合成評估人", createdAt: "2026-09-26T01:00:00Z", contentHash },
    bundle: { bundleHash: bundle.bundleHash, canonicalJson: bundle.canonicalJson,
      scoringCanonicalJson: scoring.canonicalJson, scoringCatalogHash: scoring.catalogHash,
      validationCanonicalJson: validation.canonicalJson, validationCatalogHash: validation.validationCatalogHash },
    formalScore: null, signable: false };
}

function query(formKey: QuestionnaireFormKey = "spmsq") {
  return new URLSearchParams({ form_key: formKey, client_id: clientId, version_id: versionId, content_hash: contentHash, read_nonce: readNonce });
}
function request(parameters = query(), headers?: HeadersInit) {
  return new Request(`https://example.invalid/api/questionnaire-assessments/readiness?${parameters}`, { headers });
}
async function get(parameters = query(), headers?: HeadersInit) { return route.GET(request(parameters, headers)); }
async function assertUnavailable(response: Response, status = 503) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  const json = await response.json();
  expect(json.data).toBeNull();
  expect(json.status).toBe("error");
  expect(json.requestId).toMatch(/^[a-f\d-]{36}$/u);
  expect(JSON.stringify(json)).not.toMatch(/私密|SupabaseError|stack|SELECT|password|secret-token/u);
  return json;
}

describe("saved questionnaire readiness read API (real parser and shared response handler)", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
    stubs.getTenantContext.mockResolvedValue(actor);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockImplementation(() => ({ abortSignal: stubs.abortSignal }));
    stubs.abortSignal.mockResolvedValue({ data: source(), error: null });
  });
  afterEach(() => {
    for (const [name] of stubs.rpc.mock.calls) expect(name).toBe("questionnaire_assessment_readiness_source");
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("exposes GET only and never exposes a write or activation handler", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "dynamic", "runtime"]);
    expect(route.dynamic).toBe("force-dynamic"); expect(route.runtime).toBe("nodejs");
  });
  it.each(formKeys)("evaluates the selected saved %s draft for read-only AAL1 staff without granting formal capabilities", async (formKey) => {
    stubs.getTenantContext.mockResolvedValue({ ...actor, scopes: ["clients.read", scopeFor(formKey)] });
    stubs.abortSignal.mockResolvedValue({ data: source(formKey), error: null });
    const response = await get(query(formKey));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const json = await response.json();
    expect(json.status).toBe("ok"); expect(json.errors).toEqual([]);
    expect(json.data).toMatchObject({ candidateOnly: true, organizationId, branchId, actorUserId, formKey, clientId,
      versionId, contentHash, readNonce, formalScore: null, signable: false, candidate: { status: "complete" } });
    expect(json.data.blockers).toEqual(["source_evidence_missing", "bundle_not_adopted", "signing_policy_missing", "formal_signing_unavailable"]);
    expect(json.data).not.toHaveProperty("draft"); expect(json.data).not.toHaveProperty("bundle");
    expect(JSON.stringify(json)).not.toMatch(/私密|canonicalJson|scoringCanonicalJson|validationCanonicalJson|qualitative_note/u);
    expect(stubs.getTenantContext).toHaveBeenCalledWith("staff");
    expect(stubs.rpc).toHaveBeenCalledExactlyOnceWith("questionnaire_assessment_readiness_source", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId, p_form_key: formKey,
      p_client_id: clientId, p_version_id: versionId, p_expected_content_hash: contentHash, p_read_nonce: readNonce,
    });
  });
  it("normalizes request UUIDs but uses server-authoritative tenant and actor scope", async () => {
    const parameters = query();
    for (const key of ["client_id", "version_id", "read_nonce"]) parameters.set(key, parameters.get(key)!.toUpperCase());
    const response = await get(parameters, { "x-organization-id": otherId, "x-branch-id": otherId, "x-actor-id": otherId });
    expect(response.status).toBe(200);
    expect(stubs.rpc.mock.calls[0]![1]).toMatchObject({ p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_client_id: clientId, p_version_id: versionId, p_read_nonce: readNonce });
  });
  it.each([null, { ...actor, demo: true }, { ...actor, branchId: null }, { ...actor, scopes: [] },
    { ...actor, scopes: ["clients.read"] }, { ...actor, scopes: ["questionnaire_cognition.read"] },
    { ...actor, scopes: ["clients.read", "questionnaire_cognition.manage"] }])("denies missing authority before reading saved contents", async (denied) => {
    stubs.getTenantContext.mockResolvedValue(denied);
    await assertUnavailable(await get(), denied === null ? 401 : denied.branchId === null ? 409 : 403);
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled(); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it.each(["form_key", "client_id", "version_id", "content_hash", "read_nonce"])("rejects absent required %s", async (key) => {
    const parameters = query(); parameters.delete(key);
    await assertUnavailable(await get(parameters), 400); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it.each(["form_key", "client_id", "version_id", "content_hash", "read_nonce"])("rejects duplicate %s even if values agree", async (key) => {
    const parameters = query(); parameters.append(key, parameters.get(key)!);
    await assertUnavailable(await get(parameters), 400); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it.each(["organization_id", "branch_id", "actor_user_id", "answers", "score", "signable", "mode", "limit", "action"])("rejects caller-supplied %s rather than widening or changing the read", async (key) => {
    const parameters = query(); parameters.set(key, "true");
    await assertUnavailable(await get(parameters), 400); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it.each([["form_key", "mna_full"], ["form_key", "SPMSQ"], ["client_id", "name-not-id"], ["version_id", "latest"],
    ["read_nonce", ""], ["read_nonce", "not-a-nonce"], ["content_hash", "A".repeat(64)], ["content_hash", "a".repeat(63)],
    ["client_id", `${clientId} `]])("rejects invalid %s=%s", async (key, value) => {
    const parameters = query(); parameters.set(key!, value!);
    await assertUnavailable(await get(parameters), 400); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it.each([["content-length", "1"], ["content-length", "invalid"], ["transfer-encoding", "chunked"]])("rejects body transport header %s before a database read", async (name, value) => {
    await assertUnavailable(await get(query(), { [name!]: value! }), 400); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("rejects an actual body and direct invocation with a non-GET method", async () => {
    const withBody = request(); Object.defineProperty(withBody, "body", { value: new ReadableStream() });
    await assertUnavailable(await route.GET(withBody), 400);
    await assertUnavailable(await route.GET(new Request(request().url, { method: "POST", body: "{}" })), 400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("allows an explicit zero length but does not treat it as submitted answers", async () => {
    expect((await get(query(), { "content-length": "0" })).status).toBe(200); expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([["42501", 403], ["40001", 409], ["22023", 400], ["23505", 503], ["XX000", 503]])("maps SQL %s without leaking database content or trying another source", async (code, status) => {
    stubs.abortSignal.mockResolvedValue({ data: source(), error: { code, message: "私密 SELECT password=secret-token", details: "SupabaseError stack" } });
    await assertUnavailable(await get(), status as number); expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([null, undefined])("fails closed when the exact read has no source", async (data) => {
    stubs.abortSignal.mockResolvedValue({ data, error: null }); await assertUnavailable(await get()); expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it("reports missing configuration without invoking a database or returning a demo", async () => {
    stubs.createServerSupabaseClient.mockResolvedValue(null);
    const json = await assertUnavailable(await get()); expect(json.errors[0].code).toBe("SERVICE_NOT_CONFIGURED");
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it.each(["client", "rpc"])("returns a safe unavailable result when %s throws", async (target) => {
    if (target === "client") stubs.createServerSupabaseClient.mockRejectedValue(new Error("私密 secret-token SupabaseError stack"));
    else stubs.rpc.mockImplementation(() => { throw new Error("私密 secret-token SupabaseError stack"); });
    await assertUnavailable(await get()); expect(stubs.rpc).toHaveBeenCalledTimes(target === "rpc" ? 1 : 0);
  });
  it.each(["organizationId", "branchId", "actorUserId", "clientId", "readNonce"])("rejects source with wrong %s", async (key) => {
    stubs.abortSignal.mockResolvedValue({ data: { ...source(), [key]: otherId }, error: null });
    await assertUnavailable(await get()); expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["schema", "form", "version", "hash", "signed", "unknown", "formalScore", "signable", "bundle", "scoring", "validation", "badDate", "futureCreated"])("rejects malformed or mismatched %s proof", async (kind) => {
    const value = source();
    if (kind === "schema") value.schemaVersion = "wrong";
    if (kind === "form") value.formKey = "gds_15";
    if (kind === "version") value.draft.versionId = otherId;
    if (kind === "hash") value.draft.contentHash = "b".repeat(64);
    if (kind === "signed") value.draft.recordState = "signed";
    if (kind === "unknown") Object.assign(value, { rawPatientName: "私密" });
    if (kind === "formalScore") Object.assign(value, { formalScore: 10 });
    if (kind === "signable") value.signable = true;
    if (kind === "bundle") value.bundle.canonicalJson = "{}";
    if (kind === "scoring") value.bundle.scoringCatalogHash = "b".repeat(64);
    if (kind === "validation") value.bundle.validationCanonicalJson = "{}";
    if (kind === "badDate") value.draft.assessedOn = "2026-02-30";
    if (kind === "futureCreated") value.draft.createdAt = new Date(now.getTime() + 1).toISOString();
    stubs.abortSignal.mockResolvedValue({ data: value, error: null });
    await assertUnavailable(await get()); expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([-60_001, 60_001])("rejects a stale or future source %s ms away", async (offset) => {
    stubs.abortSignal.mockResolvedValue({ data: { ...source(), generatedAt: new Date(now.getTime() + offset).toISOString() }, error: null });
    await assertUnavailable(await get());
  });
  it.each([-60_000, 60_000])("admits the exact inclusive freshness boundary %s without allowing signatures", async (offset) => {
    stubs.abortSignal.mockResolvedValue({ data: { ...source(), generatedAt: new Date(now.getTime() + offset).toISOString() }, error: null });
    const response = await get(); expect(response.status).toBe(200); expect((await response.json()).data.signable).toBe(false);
  });
  it("marks an explicitly selected old version superseded instead of reading another or rejecting exact history", async () => {
    stubs.abortSignal.mockResolvedValue({ data: { ...source(), currentVersionId: otherId }, error: null });
    const response = await get(); expect(response.status).toBe(200);
    const json = await response.json(); expect(json.data.versionId).toBe(versionId);
    expect(json.data.blockers).toContain("version_superseded"); expect(json.data.signable).toBe(false); expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it("reports incomplete saved answers without inventing a zero or a formal score", async () => {
    const value = source(); value.draft.answers.spmsq_01 = { state: "missing" } as typeof value.draft.answers.spmsq_01;
    stubs.abortSignal.mockResolvedValue({ data: value, error: null });
    const response = await get(); expect(response.status).toBe(200);
    const json = await response.json(); expect(json.data.candidate.status).toBe("incomplete");
    expect(json.data.blockers).toContain("answers_incomplete"); expect(json.data.formalScore).toBeNull(); expect(json.data.signable).toBe(false);
  });
  it("does not confuse structurally invalid persisted answers with API/schema proof failure", async () => {
    const value = source(); value.draft.answers.spmsq_01 = { state: "answered", value: "unrecognized" };
    stubs.abortSignal.mockResolvedValue({ data: value, error: null });
    const response = await get(); expect(response.status).toBe(200);
    const json = await response.json(); expect(json.data.candidate.status).toBe("invalid");
    expect(json.data.blockers).toContain("answers_invalid"); expect(json.data.signable).toBe(false);
  });
  it("hard-bounds an SDK fetch/decode promise at exactly 20 seconds even when abort is ignored", async () => {
    let resolveProvider!: (value: { data: ReturnType<typeof source>; error: null }) => void;
    stubs.abortSignal.mockImplementation(() => new Promise((resolve) => { resolveProvider = resolve; }));
    const outputs: Response[] = [];
    const pending = get().then((response) => { outputs.push(response); return response; });
    await vi.advanceTimersByTimeAsync(0);
    const signal = stubs.abortSignal.mock.calls[0]![0] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal); expect(signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(outputs).toHaveLength(0); expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertUnavailable(await pending);
    expect(signal.aborted).toBe(true); expect(outputs).toHaveLength(1);
    expect(stubs.rpc).toHaveBeenCalledTimes(1); expect(stubs.abortSignal).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    resolveProvider({ data: { ...source(), generatedAt: new Date().toISOString() }, error: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outputs).toHaveLength(1); expect(outputs[0]!.status).toBe(503); expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it("clears a successful request's timer without aborting it after the original deadline", async () => {
    const response = await get(); expect(response.status).toBe(200);
    const signal = stubs.abortSignal.mock.calls[0]![0] as AbortSignal;
    expect(signal.aborted).toBe(false); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(signal.aborted).toBe(false); expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it("clears a rejected SDK decode timer and returns only the generic unavailable message", async () => {
    stubs.abortSignal.mockRejectedValue(new Error("私密 malformed decode stack password=secret-token"));
    await assertUnavailable(await get());
    const signal = stubs.abortSignal.mock.calls[0]![0] as AbortSignal;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(signal.aborted).toBe(false); expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it("fails closed if the provider does not support abortSignal rather than retrying an unbounded call", async () => {
    stubs.rpc.mockImplementation(() => ({}));
    await assertUnavailable(await get());
    expect(stubs.rpc).toHaveBeenCalledTimes(1); expect(stubs.abortSignal).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it("clears only its own timer while an independent readiness read remains bounded", async () => {
    stubs.abortSignal.mockResolvedValueOnce({ data: source(), error: null });
    stubs.abortSignal.mockImplementationOnce(() => new Promise(() => {}));
    const successful = get(), stalled = get();
    const first = await successful; expect(first.status).toBe(200);
    await vi.advanceTimersByTimeAsync(0);
    const firstSignal = stubs.abortSignal.mock.calls[0]![0] as AbortSignal;
    const secondSignal = stubs.abortSignal.mock.calls[1]![0] as AbortSignal;
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertUnavailable(await stalled);
    expect(firstSignal.aborted).toBe(false); expect(secondSignal.aborted).toBe(true);
    expect(stubs.rpc).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
});
