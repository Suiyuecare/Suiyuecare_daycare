import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUESTIONNAIRE_FORMS } from "./forms";
import { parseQuestionnaireMutation } from "./mutation-contract";
import { readQuestionnaireOperationReceipt, writeQuestionnaireDraft, QuestionnaireOperationClientError } from "./operation-client";
import type { QuestionnaireOperationReceiptExpected } from "./operation-receipt";
import type { QuestionnaireFormKey } from "./types";

const ids = {
  organizationId: "1000000a-0000-4000-8000-000000000001", branchId: "2000000b-0000-4000-8000-000000000001",
  actorUserId: "3000000c-0000-4000-8000-000000000001", clientId: "4000000d-0000-4000-8000-000000000001",
  assessmentKey: "5000000e-0000-4000-8000-000000000001", versionId: "6000000f-0000-4000-8000-000000000001",
  previousVersionId: "7000000a-0000-4000-8000-000000000001", idempotencyKey: "8000000b-0000-4000-8000-000000000001",
  nonce: "9000000c-0000-4000-8000-000000000001", requestId: "a000000d-0000-4000-8000-000000000001",
};
const otherId = "b000000e-0000-4000-8000-000000000001";
const now = Date.parse("2026-09-27T01:00:00Z");
const keys = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];
function fixture(formKey: QuestionnaireFormKey = "spmsq", action: "create" | "revise" = "create") {
  const form = QUESTIONNAIRE_FORMS[formKey];
  const wire = { action, clientId: ids.clientId, formKey, formVersion: form.version, assessedOn: "2026-09-25",
    answers: Object.fromEntries(form.questions.map(({ id }) => [id, { state: "missing" }])),
    context: { qualitative_note: "SYNTHETIC_PRIVATE_INPUT" },
    ...(action === "revise" ? { assessmentKey: ids.assessmentKey, previousVersionId: ids.previousVersionId, expectedVersion: 7 } : {}) };
  const normalized = parseQuestionnaireMutation(wire, ids.idempotencyKey)!;
  const request = { action: normalized.action, client_id: normalized.client_id, form_key: normalized.form_key,
    form_version: normalized.form_version, assessed_on: normalized.assessed_on, answers: normalized.answers, context: normalized.context,
    assessment_key: normalized.assessment_key ?? null, previous_version_id: normalized.previous_version_id ?? null,
    expected_version: normalized.expected_version ?? 0 };
  const receipt = { action, clientId: ids.clientId, formKey, assessmentKey: ids.assessmentKey, versionId: ids.versionId,
    version: action === "create" ? 1 : 8, recordState: "draft", assessedOn: wire.assessedOn, contentHash: "a".repeat(64),
    committedAt: "2026-09-25T01:00:00.123456+00:00", replayed: false };
  const draft = { assessmentKey: receipt.assessmentKey, versionId: receipt.versionId, version: receipt.version,
    formVersion: form.version, assessedOn: receipt.assessedOn, answers: request.answers, context: request.context,
    recordState: "draft", authorDisplayName: "合成人員", createdAt: receipt.committedAt, contentHash: receipt.contentHash };
  const expected: QuestionnaireOperationReceiptExpected = { organizationId: ids.organizationId, branchId: ids.branchId,
    actorUserId: ids.actorUserId, formKey, clientId: ids.clientId, action, idempotencyKey: ids.idempotencyKey,
    nonce: ids.nonce, request: wire };
  const common = { schemaVersion: 1, organizationId: ids.organizationId, branchId: ids.branchId,
    actorUserId: ids.actorUserId, formKey, clientId: ids.clientId, action, idempotencyKey: ids.idempotencyKey,
    nonce: ids.nonce, verifiedAt: "2026-09-27T01:00:00Z", demo: false };
  return { wire, expected, receipt, proof: { ...common, status: "committed", persisted: true, receipt, request, draft },
    negative: { ...common, status: "not_found", persisted: false, receipt: null, request: null, draft: null } };
}
function envelope(data: unknown) { return { requestId: ids.requestId, status: "ok", data, errors: [] }; }
function rejection(status: number, code: string) {
  return Response.json({ requestId: ids.requestId, status: "error", data: null,
    errors: [{ code, message: "SYNTHETIC_PRIVATE_PROVIDER_BODY" }] }, { status });
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const fetchMock = vi.fn();
function execute(method: "read" | "write", signal?: AbortSignal) {
  const initial = fixture();
  return method === "read" ? readQuestionnaireOperationReceipt(initial.expected, signal)
    : writeQuestionnaireDraft(JSON.stringify(initial.wire), ids.idempotencyKey, "spmsq", signal);
}
function assertSafe(error: unknown, code: string, status: number | null) {
  expect(error).toBeInstanceOf(QuestionnaireOperationClientError);
  expect(error).toMatchObject({ code, status });
  expect(error).not.toHaveProperty("cause");
  expect(JSON.stringify(error)).not.toMatch(/SYNTHETIC_PRIVATE|answers|qualitative_note/u);
  expect((error as Error).message).not.toMatch(/SYNTHETIC_PRIVATE|answers|qualitative_note/u);
}

describe("explicit questionnaire operation transport", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each(keys)("reads exact %s create receipt without sending clinical contents", async (key) => {
    const initial = fixture(key); fetchMock.mockResolvedValue(Response.json(envelope(initial.proof)));
    expect(await readQuestionnaireOperationReceipt(initial.expected)).toEqual(initial.proof);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/questionnaire-assessments/receipt"); expect(init.method).toBe("GET"); expect(init.body).toBeUndefined();
    expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin", redirect: "error" });
    expect(init.headers).toEqual({ accept: "application/json", "x-organization-id": ids.organizationId,
      "x-branch-id": ids.branchId, "x-client-id": ids.clientId, "x-questionnaire-form-key": key,
      "x-questionnaire-operation": "create", "idempotency-key": ids.idempotencyKey, "x-questionnaire-receipt-nonce": ids.nonce });
    expect(JSON.stringify([url, init])).not.toMatch(/SYNTHETIC_PRIVATE|answers|context|actorUserId/u);
    expect(init.signal).toBeInstanceOf(AbortSignal); expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(keys)("reads exact %s historical revision and bound observational absence", async (key) => {
    const initial = fixture(key, "revise"); fetchMock.mockResolvedValueOnce(Response.json(envelope(initial.proof)));
    expect(await readQuestionnaireOperationReceipt(initial.expected)).toEqual(initial.proof);
    fetchMock.mockResolvedValueOnce(Response.json(envelope(initial.negative)));
    expect(await readQuestionnaireOperationReceipt(initial.expected)).toEqual(initial.negative);
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(keys)("sends %s frozen create bytes/key once and retains precise timestamp", async (key) => {
    const initial = fixture(key), body = ` \n${JSON.stringify(initial.wire, null, 1)}\n`;
    fetchMock.mockResolvedValue(Response.json(envelope(initial.receipt), { status: 201 }));
    expect(await writeQuestionnaireDraft(body, ids.idempotencyKey, key)).toEqual(initial.receipt);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/questionnaire-assessments?form_key=${key}`);
    expect(init).toMatchObject({ method: "POST", body, cache: "no-store", credentials: "same-origin", redirect: "error",
      headers: { accept: "application/json", "content-type": "application/json", "idempotency-key": ids.idempotencyKey } });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(keys)("correlates exact %s revision target and expected version", async (key) => {
    const initial = fixture(key, "revise"); fetchMock.mockResolvedValue(Response.json(envelope(initial.receipt), { status: 201 }));
    expect(await writeQuestionnaireDraft(JSON.stringify(initial.wire), ids.idempotencyKey, key)).toEqual(initial.receipt);
  });
  it("retains exact old replay timestamp and does not claim scope/content proof from thin 201", async () => {
    const initial = fixture(); const receipt = { ...initial.receipt, replayed: true };
    fetchMock.mockResolvedValue(Response.json(envelope(receipt), { status: 201 }));
    const result = await writeQuestionnaireDraft(JSON.stringify(initial.wire), ids.idempotencyKey, "spmsq");
    expect(result.committedAt).toBe("2026-09-25T01:00:00.123456+00:00");
    expect(result).not.toHaveProperty("organizationId"); expect(result).not.toHaveProperty("answers"); expect(result).not.toHaveProperty("draft");
  });
  it("compares normalized request IDs while preserving frozen original bytes and whitespace", async () => {
    const initial = fixture("barthel_adl"), first = QUESTIONNAIRE_FORMS.barthel_adl.questions[0]!.id;
    const original = { ...initial.wire, clientId: ids.clientId.toUpperCase(),
      answers: { ...initial.wire.answers, [first]: { state: "not_applicable", reason: "  合成原因  " } },
      context: { qualitative_note: "  合成筆記  " } };
    const body = JSON.stringify(original, null, 2); fetchMock.mockResolvedValue(Response.json(envelope(initial.receipt), { status: 201 }));
    expect((await writeQuestionnaireDraft(body, ids.idempotencyKey, "barthel_adl")).clientId).toBe(ids.clientId);
    expect(fetchMock.mock.calls[0]![1].body).toBe(body);
    expect(original.context.qualitative_note).toBe("  合成筆記  ");
  });
  it.each(["organizationId", "branchId", "actorUserId", "clientId", "nonce", "idempotencyKey"] as const)("rejects wrong %s on GET proof", async (field) => {
    const initial = fixture(); fetchMock.mockResolvedValue(Response.json(envelope({ ...initial.proof, [field]: otherId })));
    await expect(readQuestionnaireOperationReceipt(initial.expected)).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
  });
  it.each([{ formKey: "gds_15" }, { action: "revise" }, { schemaVersion: 2 }, { demo: true }, { persisted: false },
    { verifiedAt: "2026-09-27T00:58:59.999999Z" }, { verifiedAt: "2026-09-27T01:01:00.000001Z" }, { signable: true }])("rejects forged GET proof %#", async (change) => {
    const initial = fixture(); fetchMock.mockResolvedValue(Response.json(envelope({ ...initial.proof, ...change })));
    await expect(readQuestionnaireOperationReceipt(initial.expected)).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
  });
  it("GET rechecks exact original content and refuses replay-as-proof", async () => {
    const initial = fixture();
    const changed = { ...initial.proof, request: { ...initial.proof.request, context: { qualitative_note: "later edit" } },
      draft: { ...initial.proof.draft, context: { qualitative_note: "later edit" } } };
    fetchMock.mockResolvedValueOnce(Response.json(envelope(changed)));
    await expect(readQuestionnaireOperationReceipt(initial.expected)).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
    fetchMock.mockResolvedValueOnce(Response.json(envelope({ ...initial.proof, receipt: { ...initial.receipt, replayed: true } })));
    await expect(readQuestionnaireOperationReceipt(initial.expected)).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
  });
  it("captures original GET expectation before asynchronous input mutations", async () => {
    const initial = fixture(), pendingBody = deferred<unknown>();
    fetchMock.mockResolvedValue({ status: 200, redirected: false, json: () => pendingBody.promise });
    const pending = readQuestionnaireOperationReceipt(initial.expected);
    await vi.advanceTimersByTimeAsync(0);
    Object.assign(initial.expected, { nonce: otherId });
    Object.assign(initial.wire.context, { qualitative_note: "CHANGED_AFTER_SEND" });
    // The synthetic proof must retain the original independent normalized body.
    pendingBody.resolve(envelope(initial.proof));
    expect((await pending).nonce).toBe(ids.nonce);
    expect(fetchMock.mock.calls[0]![1].headers["x-questionnaire-receipt-nonce"]).toBe(ids.nonce);
  });
  it.each(["request", "nonce", "organizationId", "branchId", "actorUserId", "clientId", "idempotencyKey"] as const)("invalid GET %s fails before fetch", async (field) => {
    const initial = fixture(); const expected = { ...initial.expected, [field]: field === "request" ? undefined : "invalid" };
    await expect(readQuestionnaireOperationReceipt(expected)).rejects.toMatchObject({ code: "INVALID_REQUEST", status: null });
    expect(fetchMock).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects expected getters without invoking them", async () => {
    const initial = fixture(), getter = vi.fn(() => { throw new Error("SYNTHETIC_PRIVATE_GETTER"); });
    Object.defineProperty(initial.expected, "request", { enumerable: true, get: getter });
    await expect(readQuestionnaireOperationReceipt(initial.expected)).rejects.toMatchObject({ code: "INVALID_REQUEST", status: null });
    expect(getter).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["{", "null", "[]", "{}", "x".repeat(65_537)])("invalid original POST fails before fetch %#", async (body) => {
    await expect(writeQuestionnaireDraft(body, ids.idempotencyKey, "spmsq")).rejects.toMatchObject({ code: "INVALID_REQUEST", status: null });
    expect(fetchMock).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([{ action: "sign" }, { assessedOn: "2026-02-30" }, { formVersion: "forged" }, { extra: "field" },
    { answers: {} }, { context: { unknown: "value" } }])("invalid original POST fields fail before fetch %#", async (change) => {
    await expect(writeQuestionnaireDraft(JSON.stringify({ ...fixture().wire, ...change }), ids.idempotencyKey, "spmsq"))
      .rejects.toMatchObject({ code: "INVALID_REQUEST", status: null }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects uppercase/invalid keys, wrong selected form and UTF8 oversized wire without reserialization", async () => {
    const body = JSON.stringify(fixture().wire);
    for (const key of [ids.idempotencyKey.toUpperCase(), "bad", `${ids.idempotencyKey}\n`]) {
      await expect(writeQuestionnaireDraft(body, key, "spmsq")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
    await expect(writeQuestionnaireDraft(body, ids.idempotencyKey, "gds_15")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(writeQuestionnaireDraft(`${body}${" ".repeat(64_000)}${"中".repeat(600)}`, ids.idempotencyKey, "spmsq"))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{ action: "revise" }, { clientId: otherId }, { formKey: "gds_15" }, { version: 2 }, { recordState: "signed" },
    { assessedOn: "2026-09-24" }, { assessedOn: "2026-02-30" }, { versionId: "invalid" }, { contentHash: "A".repeat(64) },
    { committedAt: "2026-09-27T01:01:00.000001Z" }, { committedAt: "2026-09-25T01:00:00.1234567Z" },
    { committedAt: "2026-09-25T01:00:00" }, { signed: true }, { replayed: "false" }])("rejects wrong thin POST receipt %#", async (change) => {
    fetchMock.mockResolvedValue(Response.json(envelope({ ...fixture().receipt, ...change }), { status: 201 }));
    await expect(execute("write")).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 201 });
  });
  it.each([{ assessmentKey: otherId }, { versionId: ids.previousVersionId }, { version: 7 }, { version: 9 }])("rejects mismatched revision chain %#", async (change) => {
    const initial = fixture("spmsq", "revise"); fetchMock.mockResolvedValue(Response.json(envelope({ ...initial.receipt, ...change }), { status: 201 }));
    await expect(writeQuestionnaireDraft(JSON.stringify(initial.wire), ids.idempotencyKey, "spmsq"))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 201 });
  });
  it.each(["2026-09-27T01:01:00Z", "2026-09-27T09:01:00+08:00"])("accepts inclusive future clock skew without changing timestamp %s", async (committedAt) => {
    fetchMock.mockResolvedValue(Response.json(envelope({ ...fixture().receipt, committedAt }), { status: 201 }));
    expect((await writeQuestionnaireDraft(JSON.stringify(fixture().wire), ids.idempotencyKey, "spmsq")).committedAt).toBe(committedAt);
  });
  it.each([400, 401, 403, 409, 413, 500, 503, 201, 204])("GET %s never reads untrusted error bodies or retries", async (status) => {
    const json = vi.fn(() => { throw new Error("SYNTHETIC_PRIVATE_HTTP_BODY"); });
    fetchMock.mockResolvedValue({ status, redirected: false, json });
    try { await execute("read"); throw new Error("Expected rejection"); } catch (error) { assertSafe(error, "UNAVAILABLE", status); }
    expect(json).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([[400, "QUESTIONNAIRE_INVALID"], [400, "INVALID_JSON"], [401, "AUTH_REQUIRED"],
    [403, "QUESTIONNAIRE_NOT_AUTHORIZED"], [403, "DEMO_READ_ONLY"], [409, "BRANCH_CONTEXT_REQUIRED"],
    [409, "QUESTIONNAIRE_VERSION_CONFLICT"], [409, "QUESTIONNAIRE_IDEMPOTENCY_CONFLICT"], [413, "REQUEST_TOO_LARGE"]] as const)
  ("POST exact known %s/%s returns safe rejection metadata only", async (status, code) => {
    fetchMock.mockResolvedValue(rejection(status, code));
    try { await execute("write"); throw new Error("Expected rejection"); } catch (error) { assertSafe(error, "REJECTED", status); }
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([401, 403, 409])("malformed POST %s preserves denial status but is not known noncommit proof", async (status) => {
    fetchMock.mockResolvedValue(Response.json({ message: "SYNTHETIC_PRIVATE_PROVIDER_BODY" }, { status }));
    try { await execute("write"); throw new Error("Expected rejection"); } catch (error) { assertSafe(error, "INVALID_RESPONSE", status); }
  });
  it("unexpected POST 4xx code is not promoted to a known rejection", async () => {
    fetchMock.mockResolvedValue(rejection(403, "UNKNOWN_PROVIDER_ERROR"));
    await expect(execute("write")).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 403 });
  });
  it.each([200, 202, 204, 302, 404, 500, 503])("POST %s is not the actual 201 success and never decodes", async (status) => {
    const json = vi.fn(); fetchMock.mockResolvedValue({ status, redirected: false, json });
    await expect(execute("write")).rejects.toMatchObject({ code: "UNAVAILABLE", status });
    expect(json).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["read", "write"] as const)("%s ignores provider fetch errors and leaks no private text", async (method) => {
    fetchMock.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_FETCH_STACK"));
    try { await execute(method); throw new Error("Expected rejection"); } catch (error) { assertSafe(error, "UNAVAILABLE", null); }
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "write"] as const)("%s rejects malformed successful envelope/body safely", async (method) => {
    const status = method === "read" ? 200 : 201;
    for (const raw of [null, {}, [], { ...envelope(fixture().receipt), requestId: "bad" },
      { ...envelope(fixture().receipt), errors: [{ code: "error" }] }, { ...envelope(fixture().receipt), extra: true }]) {
      fetchMock.mockResolvedValue({ status, redirected: false, json: async () => raw });
      try { await execute(method); throw new Error("Expected rejection"); } catch (error) { assertSafe(error, "INVALID_RESPONSE", status); }
    }
    fetchMock.mockResolvedValue({ status, redirected: false, json: () => Promise.reject(new Error("SYNTHETIC_PRIVATE_JSON_STACK")) });
    await expect(execute(method)).rejects.toMatchObject({ code: "INVALID_RESPONSE", status }); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "write"] as const)("%s rejects malformed response object or throwing metadata safely", async (method) => {
    for (const response of [null, {}, { status: NaN, redirected: false }, { status: 999, redirected: false },
      { status: method === "read" ? 200 : 201, redirected: true }, { get status() { throw new Error("SYNTHETIC_PRIVATE_STATUS"); } }]) {
      fetchMock.mockResolvedValue(response);
      await expect(execute(method)).rejects.toBeInstanceOf(QuestionnaireOperationClientError);
    }
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "write"] as const)("%s retains 403 admission metadata even if other response metadata throws", async (method) => {
    fetchMock.mockResolvedValue({ status: 403, get redirected() { throw new Error("SYNTHETIC_PRIVATE_METADATA"); } });
    try { await execute(method); throw new Error("Expected rejection"); } catch (error) { assertSafe(error, "INVALID_RESPONSE", 403); }
  });
  it.each(["read", "write"] as const)("%s denies response getters without evaluating clinical content", async (method) => {
    const getter = vi.fn(() => { throw new Error("SYNTHETIC_PRIVATE_GETTER"); }), raw = envelope(method === "read" ? fixture().proof : fixture().receipt);
    Object.defineProperty(raw, "data", { enumerable: true, get: getter });
    fetchMock.mockResolvedValue({ status: method === "read" ? 200 : 201, redirected: false, json: async () => raw });
    await expect(execute(method)).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); expect(getter).not.toHaveBeenCalled();
  });
  it.each(["read", "write"] as const)("%s bounds decoded malformed shapes and does not invoke toJSON", async (method) => {
    const status = method === "read" ? 200 : 201, custom = Object.create({ hidden: "SYNTHETIC_PRIVATE" });
    const circular: Record<string, unknown> = {}; circular.self = circular;
    const sparse = new Array(4), toJSON = vi.fn(() => { throw new Error("SYNTHETIC_PRIVATE_TO_JSON"); });
    for (const raw of [custom, circular, sparse, { toJSON }, { ["x".repeat(65_537)]: null }, { extra: "x".repeat(65_537) },
      Array.from({ length: 10_001 }, () => null), { [Symbol("hidden")]: null }]) {
      fetchMock.mockResolvedValue({ status, redirected: false, json: async () => raw });
      await expect(execute(method)).rejects.toMatchObject({ code: "INVALID_RESPONSE", status });
    }
    expect(toJSON).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "write"] as const)("pre-aborted %s never sends", async (method) => {
    const owner = new AbortController(); owner.abort(new Error("SYNTHETIC_PRIVATE_ABORT_REASON"));
    await expect(execute(method, owner.signal)).rejects.toMatchObject({ code: "ABORTED", status: null });
    expect(fetchMock).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "write"] as const)("%s whole 20-second deadline independently bounds uncooperative fetch", async (method) => {
    const late = deferred<Response>(); fetchMock.mockReturnValue(late.promise);
    const pending = execute(method), denied = expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE", status: null });
    await vi.advanceTimersByTimeAsync(19_999); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1); await denied;
    const json = vi.fn(); late.resolve({ status: method === "read" ? 200 : 201, redirected: false, json } as unknown as Response);
    await vi.advanceTimersByTimeAsync(0); expect(json).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "write"] as const)("%s remaining deadline includes uncooperative JSON after late headers", async (method) => {
    const headers = deferred<Response>(), body = deferred<unknown>(); fetchMock.mockReturnValue(headers.promise);
    const pending = execute(method), denied = expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE", status: null });
    await vi.advanceTimersByTimeAsync(19_000);
    headers.resolve({ status: method === "read" ? 200 : 201, redirected: false, json: () => body.promise } as Response);
    await vi.advanceTimersByTimeAsync(999); await vi.advanceTimersByTimeAsync(1); await denied;
    body.resolve(envelope(method === "read" ? fixture().proof : fixture().receipt));
    await vi.advanceTimersByTimeAsync(0); expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "write"] as const)("%s cannot publish a successful decode at the 20-second boundary", async (method) => {
    fetchMock.mockResolvedValue({ status: method === "read" ? 200 : 201, redirected: false,
      json: async () => { vi.setSystemTime(now + 20_000); return envelope(method === "read" ? fixture().proof : fixture().receipt); } });
    await expect(execute(method)).rejects.toMatchObject({ code: "UNAVAILABLE", status: null });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "write"] as const)("%s cannot publish after parse consumes its remaining deadline", async (method) => {
    const raw = envelope(method === "read" ? fixture().proof : fixture().receipt);
    // Simulates slow descriptor traversal without changing the authoritative parser.
    const proxied = new Proxy(raw, { getPrototypeOf(target) { vi.setSystemTime(now + 20_000); return Reflect.getPrototypeOf(target); } });
    fetchMock.mockResolvedValue({ status: method === "read" ? 200 : 201, redirected: false, json: async () => proxied });
    await expect(execute(method)).rejects.toMatchObject({ code: "UNAVAILABLE", status: null }); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "write"] as const)("%s owner cancellation independently bounds uncooperative fetch", async (method) => {
    const owner = new AbortController(), late = deferred<Response>(); fetchMock.mockReturnValue(late.promise);
    const pending = execute(method, owner.signal), denied = expect(pending).rejects.toMatchObject({ code: "ABORTED", status: null });
    owner.abort(); await denied;
    const json = vi.fn(); late.resolve({ status: method === "read" ? 200 : 201, redirected: false, json } as unknown as Response);
    await vi.advanceTimersByTimeAsync(0); expect(json).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "write"] as const)("%s owner cancellation after body decode wins success", async (method) => {
    const owner = new AbortController(); fetchMock.mockResolvedValue({ status: method === "read" ? 200 : 201, redirected: false,
      json: async () => { owner.abort(); return envelope(method === "read" ? fixture().proof : fixture().receipt); } });
    await expect(execute(method, owner.signal)).rejects.toMatchObject({ code: "ABORTED", status: null });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "write"] as const)("%s successful decode just before deadline remains permitted", async (method) => {
    const body = deferred<unknown>(); fetchMock.mockResolvedValue({ status: method === "read" ? 200 : 201, redirected: false, json: () => body.promise });
    const pending = execute(method); await vi.advanceTimersByTimeAsync(19_999);
    const initial = fixture(); body.resolve(envelope(method === "read" ? initial.proof : initial.receipt));
    expect(await pending).toEqual(method === "read" ? initial.proof : initial.receipt); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "write"] as const)("%s owner cancellation wins uncooperative late body and private rejection", async (method) => {
    const owner = new AbortController(), body = deferred<unknown>();
    fetchMock.mockResolvedValue({ status: method === "read" ? 200 : 201, redirected: false, json: () => body.promise });
    const pending = execute(method, owner.signal), denied = expect(pending).rejects.toMatchObject({ code: "ABORTED", status: null });
    await vi.advanceTimersByTimeAsync(0); owner.abort(new Error("SYNTHETIC_PRIVATE_ABORT_REASON")); await denied;
    body.reject(new Error("SYNTHETIC_PRIVATE_LATE_BODY")); await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["read", "write"] as const)("%s cleanup does not later abort a successful operation", async (method) => {
    fetchMock.mockResolvedValue(Response.json(envelope(method === "read" ? fixture().proof : fixture().receipt), { status: method === "read" ? 200 : 201 }));
    await execute(method); const signal = fetchMock.mock.calls[0]![1].signal;
    await vi.advanceTimersByTimeAsync(20_001); expect(signal.aborted).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it("has no server-only, Node builtin, auth/database or storage dependency in its runtime graph", () => {
    const visited = new Set<string>();
    const inspect = (file: string) => {
      if (visited.has(file)) return; visited.add(file);
      const source = readFileSync(file, "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      expect(source).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB|console)\s*\./u);
      for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        if (ts.isImportDeclaration(statement)) {
          if (statement.importClause?.isTypeOnly) continue;
          const binding = statement.importClause?.namedBindings;
          if (!statement.importClause?.name && binding && ts.isNamedImports(binding) && binding.elements.every(entry => entry.isTypeOnly)) continue;
        } else if (statement.isTypeOnly) continue;
        const name = statement.moduleSpecifier.text;
        expect(name).not.toMatch(/^(?:node:|server-only$|@supabase\/)|(?:\/auth\/|\/supabase\/|rule-catalog|validation-catalog|readiness-source)/u);
        if (name.startsWith("@/")) inspect(resolve("src", `${name.slice(2)}.ts`));
        else if (name.startsWith(".")) inspect(resolve(dirname(file), `${name}.ts`));
      }
    };
    inspect(resolve("src/lib/questionnaire-assessments/operation-client.ts")); expect(visited.size).toBeGreaterThan(6);
  });
});
