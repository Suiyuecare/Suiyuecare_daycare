import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUESTIONNAIRE_FORMS } from "./forms";
import { parseQuestionnaireMutation } from "./mutation-contract";
import { parseQuestionnaireOperationReceipt, QuestionnaireOperationReceiptError, type QuestionnaireOperationReceiptExpected } from "./operation-receipt";
import type { QuestionnaireFormKey } from "./types";

const ids = {
  organizationId: "1000000a-0000-4000-8000-000000000001", branchId: "2000000b-0000-4000-8000-000000000001",
  actorUserId: "3000000c-0000-4000-8000-000000000001", clientId: "4000000d-0000-4000-8000-000000000001",
  assessmentKey: "5000000e-0000-4000-8000-000000000001", versionId: "6000000f-0000-4000-8000-000000000001",
  previousVersionId: "7000000a-0000-4000-8000-000000000001", idempotencyKey: "8000000b-0000-4000-8000-000000000001",
  nonce: "9000000c-0000-4000-8000-000000000001",
};
const otherId = "a000000d-0000-4000-8000-000000000001";
const now = Date.parse("2026-09-27T01:00:00Z");
const keys = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];
function fixture(formKey: QuestionnaireFormKey = "spmsq", action: "create" | "revise" = "create") {
  const form = QUESTIONNAIRE_FORMS[formKey];
  const wire = { action, clientId: ids.clientId, formKey, formVersion: form.version, assessedOn: "2026-09-25",
    answers: Object.fromEntries(form.questions.map(({ id }) => [id, { state: "missing" }])), context: {},
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
  const common = { schemaVersion: 1, organizationId: ids.organizationId, branchId: ids.branchId, actorUserId: ids.actorUserId,
    formKey, clientId: ids.clientId, action, idempotencyKey: ids.idempotencyKey, nonce: ids.nonce,
    verifiedAt: "2026-09-27T01:00:00Z", demo: false };
  const proof = { ...common, status: "committed", persisted: true, receipt, request, draft };
  const expected: QuestionnaireOperationReceiptExpected = { organizationId: common.organizationId, branchId: common.branchId,
    actorUserId: common.actorUserId, formKey, clientId: common.clientId, action, idempotencyKey: common.idempotencyKey,
    nonce: common.nonce, request: wire };
  const negative = { ...common, status: "not_found", persisted: false, receipt: null, request: null, draft: null };
  return { proof, expected, negative, wire };
}
function assertDenied(proof: unknown, expected: QuestionnaireOperationReceiptExpected = fixture().expected, clock = now) {
  expect(() => parseQuestionnaireOperationReceipt(proof, expected, clock)).toThrow(QuestionnaireOperationReceiptError);
  try { parseQuestionnaireOperationReceipt(proof, expected, clock); }
  catch (error) { expect((error as Error).message).toBe("原評估操作的保存結果尚未核對完成。"); }
}

describe("exact original questionnaire operation proof", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());
  it.each(keys)("accepts complete scoped %s historical create without rewriting original input", (formKey) => {
    const { proof, expected } = fixture(formKey), before = JSON.stringify({ proof, expected });
    expect(parseQuestionnaireOperationReceipt(proof, expected)).toEqual(proof);
    expect(JSON.stringify({ proof, expected })).toBe(before);
  });
  it.each(keys)("accepts exact %s historical revision, not an arbitrary latest draft", (formKey) => {
    const { proof, expected } = fixture(formKey, "revise");
    expect(parseQuestionnaireOperationReceipt(proof, expected, now)).toEqual(proof);
    expect(proof.draft.createdAt).not.toBe(proof.verifiedAt);
  });
  it.each(keys)("accepts bound %s not_found only with null evidence", (formKey) => {
    const { negative, expected } = fixture(formKey);
    expect(parseQuestionnaireOperationReceipt(negative, expected, now)).toEqual(negative);
  });
  it("allows API-only expected identity without copied draft answers", () => {
    const { proof, expected } = fixture(); const scope = { ...expected }; delete scope.request;
    expect(parseQuestionnaireOperationReceipt(proof, scope, now)).toEqual(proof);
  });
  it("compares canonical normalized request without mutating original uppercase IDs/trim fields", () => {
    const { proof, expected, wire } = fixture("barthel_adl");
    const first = QUESTIONNAIRE_FORMS.barthel_adl.questions[0]!.id;
    const answers = { ...wire.answers, [first]: { state: "not_applicable", reason: "  原因 \n" } };
    const request = { ...wire, clientId: ids.clientId.toUpperCase(), answers, context: { qualitative_note: " 筆記 " } };
    const normalized = parseQuestionnaireMutation(request, ids.idempotencyKey)!;
    proof.request.answers = normalized.answers; proof.draft.answers = normalized.answers;
    proof.request.context = normalized.context; proof.draft.context = normalized.context;
    const before = JSON.stringify(request);
    expect(parseQuestionnaireOperationReceipt(proof, { ...expected, request }, now)).toEqual(proof);
    expect(JSON.stringify(request)).toBe(before);
  });
  it.each(["organizationId", "branchId", "actorUserId", "clientId", "idempotencyKey", "nonce"] as const)("rejects wrong %s in either envelope or expected", (field) => {
    const { proof, expected, negative } = fixture();
    assertDenied({ ...proof, [field]: otherId }, expected); assertDenied({ ...negative, [field]: otherId }, expected);
    assertDenied(proof, { ...expected, [field]: otherId });
    assertDenied({ ...proof, [field]: proof[field].toUpperCase() }, expected);
  });
  it.each([{ formKey: "gds_15" }, { action: "revise" }, { schemaVersion: 2 }, { demo: true }, { persisted: false },
    { status: "accepted" }, { formalScore: 0 }, { signable: true }, { receipt: null }, { request: null }, { draft: null },
    { source: "sensitive provider body" }])("rejects forged outer proof %#", (change) => {
    const { proof, expected } = fixture(); assertDenied({ ...proof, ...change }, expected);
  });
  it.each(["receipt", "request", "draft"] as const)("rejects non-null %s on not_found", (field) => {
    const { proof, negative, expected } = fixture(); assertDenied({ ...negative, [field]: proof[field] }, expected);
  });
  it.each([{ persisted: true }, { demo: true }, { extra: false }, { status: "committed" }])("rejects malformed negative %#", (change) => {
    const { negative, expected } = fixture(); assertDenied({ ...negative, ...change }, expected);
  });
  it.each([{ action: "revise" }, { clientId: otherId }, { formKey: "gds_15" }, { assessmentKey: otherId },
    { versionId: otherId }, { version: 2 }, { recordState: "signed" }, { assessedOn: "2026-09-24" },
    { contentHash: "b".repeat(64) }, { replayed: true }, { extra: true }])("rejects wrong receipt evidence %#", (change) => {
    const { proof, expected } = fixture(); assertDenied({ ...proof, receipt: { ...proof.receipt, ...change } }, expected);
  });
  it.each([{ assessmentKey: otherId }, { versionId: otherId }, { version: 2 }, { formVersion: "old-form" },
    { assessedOn: "2026-09-24" }, { contentHash: "b".repeat(64) }, { recordState: "signed" },
    { assessmentCreatedAt: "2026-09-25T01:00:00Z" }, { extra: "field" }])("rejects mismatched/nonoriginal draft %#", (change) => {
    const { proof, expected } = fixture(); assertDenied({ ...proof, draft: { ...proof.draft, ...change } }, expected);
  });
  it.each([{ action: "revise" }, { client_id: otherId }, { form_key: "gds_15" }, { form_version: "wrong-version" },
    { assessed_on: "2026-02-30" }, { assessment_key: otherId }, { previous_version_id: otherId }, { expected_version: 1 },
    { idempotencyKey: ids.idempotencyKey }, { extra: true }])("rejects forged normalized request %#", (change) => {
    const { proof, expected } = fixture(); assertDenied({ ...proof, request: { ...proof.request, ...change } }, expected);
  });
  it("rejects missing explicit create target fields", () => {
    const { proof, expected } = fixture(); const { assessment_key: _target, ...request } = proof.request;
    expect(_target).toBeNull();
    assertDenied({ ...proof, request }, expected);
  });
  it("rejects missing/extra/illegal answers even when draft copied the forgery", () => {
    const { proof, expected } = fixture(), first = QUESTIONNAIRE_FORMS.spmsq.questions[0]!.id;
    const missing = { ...proof.request.answers }; delete missing[first];
    for (const answers of [missing, { ...proof.request.answers, extra: { state: "missing" } },
      { ...proof.request.answers, [first]: { state: "answered", value: "forged" } },
      { ...proof.request.answers, [first]: { state: "not_applicable", reason: "原因" } }]) {
      assertDenied({ ...proof, request: { ...proof.request, answers }, draft: { ...proof.draft, answers } }, expected);
    }
  });
  it("rejects changed persisted answers or context compared to frozen original request", () => {
    const { proof, expected } = fixture(), first = QUESTIONNAIRE_FORMS.spmsq.questions[0]!.id;
    const answers = { ...proof.request.answers, [first]: { state: "answered", value: "correct" } };
    assertDenied({ ...proof, request: { ...proof.request, answers }, draft: { ...proof.draft, answers } }, expected);
    assertDenied({ ...proof, request: { ...proof.request, context: { qualitative_note: "later edited" } },
      draft: { ...proof.draft, context: { qualitative_note: "later edited" } } }, expected);
  });
  it("rejects noncanonical persisted context but does not add stricter N-A reason restrictions", () => {
    const { proof, expected } = fixture("barthel_adl"), first = QUESTIONNAIRE_FORMS.barthel_adl.questions[0]!.id;
    for (const context of [{ qualitative_note: " " }, { qualitative_note: " padded " }, { unknown: "a" }]) {
      assertDenied({ ...proof, request: { ...proof.request, context }, draft: { ...proof.draft, context } }, expected);
    }
    const answers = { ...proof.request.answers, [first]: { state: "not_applicable", reason: "x".repeat(501) } };
    const wire = { ...fixture("barthel_adl").wire, answers };
    expect(parseQuestionnaireOperationReceipt({ ...proof, request: { ...proof.request, answers }, draft: { ...proof.draft, answers } },
      { ...expected, request: wire }, now).status).toBe("committed");
  });
  it("requires exact revision chain, new result version and expected+1", () => {
    const { proof, expected } = fixture("spmsq", "revise");
    assertDenied({ ...proof, request: { ...proof.request, assessment_key: otherId } }, expected);
    assertDenied({ ...proof, receipt: { ...proof.receipt, version: 9 }, draft: { ...proof.draft, version: 9 } }, expected);
    assertDenied({ ...proof, receipt: { ...proof.receipt, versionId: ids.previousVersionId }, draft: { ...proof.draft, versionId: ids.previousVersionId } }, expected);
    assertDenied({ ...proof, request: { ...proof.request, expected_version: 1_000_000 }, receipt: { ...proof.receipt, version: 1_000_001 },
      draft: { ...proof.draft, version: 1_000_001 } }, expected);
  });
  it.each(["2026-09-27T00:59:00Z", "2026-09-27T01:01:00Z", "2026-09-27T09:00:00+08:00"])("accepts inclusive fresh proof %s", (verifiedAt) => {
    const { proof, expected } = fixture(); expect(parseQuestionnaireOperationReceipt({ ...proof, verifiedAt }, expected, now).status).toBe("committed");
  });
  it.each(["2026-09-27T00:58:59.999999Z", "2026-09-27T01:01:00.000001Z", "2026-09-27T01:00:00", "2026-02-30T00:00:00Z",
    "2026-09-27T01:00:00.0000001Z", "not-time"])("rejects stale/future/malformed exact timestamp %s", (verifiedAt) => {
    const { proof, expected } = fixture(); assertDenied({ ...proof, verifiedAt }, expected);
  });
  it.each([NaN, Infinity, -Infinity, now + 0.5])("rejects nonfinite/fractional observation clock %s", (clock) => {
    const { proof, expected } = fixture(); assertDenied(proof, expected, clock);
  });
  it("does not collapse committed timestamp microsecond difference to milliseconds", () => {
    const { proof, expected } = fixture();
    assertDenied({ ...proof, draft: { ...proof.draft, createdAt: "2026-09-25T01:00:00.123457+00:00" } }, expected);
    const committedAt = "2026-09-27T01:00:00.000001Z";
    assertDenied({ ...proof, receipt: { ...proof.receipt, committedAt }, draft: { ...proof.draft, createdAt: committedAt } }, expected);
  });
  it("compares ordering across nonzero offsets and keeps timestamp original spelling", () => {
    const { proof, expected } = fixture(); const committedAt = "2026-09-27T08:59:59.999999+08:00";
    const input = { ...proof, receipt: { ...proof.receipt, committedAt }, draft: { ...proof.draft, createdAt: committedAt } };
    expect(parseQuestionnaireOperationReceipt(input, expected, now).receipt?.committedAt).toBe(committedAt);
  });
  it.each(["root", "expected", "receipt", "draft", "answer"])("rejects accessors at %s without calling them", (where) => {
    const { proof, expected } = fixture(); const getter = vi.fn(() => { throw new Error("sensitive getter"); });
    const target = where === "root" ? proof : where === "expected" ? expected : where === "receipt" ? proof.receipt :
      where === "draft" ? proof.draft : proof.request.answers[QUESTIONNAIRE_FORMS.spmsq.questions[0]!.id]!;
    Object.defineProperty(target, "forged", { enumerable: true, get: getter });
    assertDenied(proof, expected); expect(getter).not.toHaveBeenCalled();
  });
  it.each(["symbol", "nonenumerable", "cycle", "hole", "customPrototype", "date", "undefined", "tooDeep", "oversize"])("rejects hostile direct JSON %s generically", (kind) => {
    const { proof, expected } = fixture(); const value: Record<string | symbol, unknown> = proof;
    if (kind === "symbol") value[Symbol("hidden")] = true;
    if (kind === "nonenumerable") Object.defineProperty(value, "hidden", { value: true });
    if (kind === "cycle") value.hidden = value;
    if (kind === "hole") value.hidden = Array(1);
    if (kind === "customPrototype") Object.setPrototypeOf(value, { hidden: true });
    if (kind === "date") value.hidden = new Date();
    if (kind === "undefined") value.hidden = undefined;
    if (kind === "oversize") value.hidden = "x".repeat(65_537);
    if (kind === "tooDeep") { let nested: unknown = null; for (let i = 0; i < 17; i++) nested = { nested }; value.hidden = nested; }
    assertDenied(value, expected);
  });
  it("does not treat a present undefined expected request as omitted", () => {
    const { proof, expected } = fixture(); assertDenied(proof, { ...expected, request: undefined });
  });
  it("rejects malformed original expected request even for not_found", () => {
    const { proof, negative, expected } = fixture();
    for (const request of [null, {}, { ...fixture().wire, clientId: otherId }, { ...fixture().wire, action: "revise" }]) {
      assertDenied(proof, { ...expected, request }); assertDenied(negative, { ...expected, request });
    }
  });
});
