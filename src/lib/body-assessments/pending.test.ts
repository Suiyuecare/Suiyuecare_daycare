// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDemoBodyAssessmentSnapshot } from "./demo";
import { parseBodyAssessmentMutation, type BodyAssessmentReceipt } from "./parser";
import { beginBodyAssessment, bodyAssessmentScopeIdentity, clearBodyAssessmentPendingOnLogout, getBodyAssessmentPending,
  isConfirmedBodyAssessmentRejection, reconcileBodyAssessmentConfirmed, retryBodyAssessment, settleBodyAssessment } from "./pending";
import { hasPendingOperations, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
const snapshot = buildDemoBodyAssessmentSnapshot({ clientId: null, state: "all" });
const record = snapshot.records[0].history[0];
const scope = { organizationId: snapshot.organizationId, branchId: snapshot.branchId, userId: record.actor_user_id };
const key = "00000000-0000-4000-8000-000000000001";
const sign = () => parseBodyAssessmentMutation({ action: "sign", client_id: record.client_id, assessment_key: record.assessment_key,
  previous_version_id: record.version_id, expected_version: record.version, expected_content_hash: record.content_hash,
  reason: "本人確認已核對所選部位的人工觀察與處置" }, key);
function receipt(input = sign()): BodyAssessmentReceipt {
  return { operation_id: "00000000-0000-4000-8000-000000000010", organization_id: scope.organizationId,
    branch_id: scope.branchId, actor_user_id: scope.userId, client_id: input.payload.client_id,
    idempotency_key: input.idempotencyKey, request_payload: input.payload, assessment_key: record.assessment_key,
    version_id: "00000000-0000-4000-8000-000000000020", version: input.payload.expected_version + 1,
    record_state: "signed", content_hash: "b".repeat(64), committed_at: new Date().toISOString(), replayed: false };
}
beforeEach(() => { clearBodyAssessmentPendingOnLogout(); });
afterEach(() => { clearBodyAssessmentPendingOnLogout(); vi.restoreAllMocks(); });
describe("independent memory-only body assessment journal", () => {
  it("deep-freezes normalized payload and key, reuses exact body on retry, and rejects overlap", () => {
    const input = sign(); const first = beginBodyAssessment(scope, false, input)!;
    expect(Object.isFrozen(first.input.payload)).toBe(true); expect(Object.isFrozen(first.scope)).toBe(true);
    input.payload.reason = "本人確認已核對所選部位的人工觀察與處置";
    expect(beginBodyAssessment(scope, false, sign())).toBeNull();
    settleBodyAssessment(first, "unknown"); const retry = retryBodyAssessment(first.token, scope, false)!;
    expect(retry.body).toBe(first.body); expect(retry.input.idempotencyKey).toBe(key);
    expect(retry.attempt).not.toBe(first.attempt); expect(retry.token).toBe(first.token);
  });
  it("also freezes clinical rows independently from the caller's editable source", () => {
    const input = parseBodyAssessmentMutation({ action: "create", client_id: record.client_id, assessment_key: null,
      previous_version_id: null, expected_version: 0, expected_content_hash: null, observed_at: new Date().toISOString(),
      observations: [{ area: "head", state: "normal", description: "合成文字", reason: null, disposition: null }],
      instrument: "manual_nonstandard_body_observation_v1", reason: "合成測試建立" }, key);
    const first = beginBodyAssessment(scope, false, input)!;
    if ("observations" in input.payload) input.payload.observations[0].description = "後改內容";
    expect(first.body).toContain("合成文字"); expect(first.body).not.toContain("後改內容");
    if ("observations" in first.input.payload) expect(Object.isFrozen(first.input.payload.observations[0])).toBe(true);
  });
  it("keeps prior uncertainty even when a later request is known denied", () => {
    const first = beginBodyAssessment(scope, false, sign())!; settleBodyAssessment(first, "unknown");
    const retry = retryBodyAssessment(first.token, scope, false)!; settleBodyAssessment(retry, "denied");
    expect(getBodyAssessmentPending().operation?.phase).toBe("unknown"); expect(hasPendingOperations()).toBe(true);
    expect(getBodyAssessmentPending().operation?.input.idempotencyKey).toBe(key);
  });
  it("only a first-attempt confirmed denial unlocks without a success marker", () => {
    const first = beginBodyAssessment(scope, false, sign())!; expect(settleBodyAssessment(first, "denied")).toBe(true);
    expect(getBodyAssessmentPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(false);
    expect(getBodyAssessmentPending().confirmed).toHaveLength(0);
  });
  it("never lets late attempt replies, foreign users or branches replace a newer operation", () => {
    const first = beginBodyAssessment(scope, false, sign())!; settleBodyAssessment(first, "unknown");
    const retry = retryBodyAssessment(first.token, scope, false)!;
    expect(settleBodyAssessment(first, "denied")).toBe(false);
    expect(retryBodyAssessment(first.token, { ...scope, userId: "00000000-0000-4000-8000-000000000099" }, false)).toBeNull();
    expect(retryBodyAssessment(first.token, { ...scope, branchId: "00000000-0000-4000-8000-000000000099" }, false)).toBeNull();
    expect(getBodyAssessmentPending().operation?.attempt).toBe(retry.attempt);
  });
  it("logout removes clinical payload and invalidates old replies without releasing another operation's lease", () => {
    const first = beginBodyAssessment(scope, false, sign())!; const before = getBodyAssessmentPending().privacyEpoch;
    clearBodyAssessmentPendingOnLogout(); const external = tryAcquirePendingOperation()!;
    expect(getBodyAssessmentPending().privacyEpoch).toBe(before + 1);
    expect(getBodyAssessmentPending().operation).toBeNull(); expect(getBodyAssessmentPending().confirmed).toHaveLength(0);
    expect(settleBodyAssessment(first, receipt())).toBe(false); expect(hasPendingOperations()).toBe(true); external();
  });
  it("rejects new body writes while another operation or view owns a lease", () => {
    const operation = tryAcquirePendingOperation()!;
    expect(beginBodyAssessment(scope, false, sign())).toBeNull(); operation();
    const view = tryAcquireViewTransition()!; expect(beginBodyAssessment(scope, false, sign())).toBeNull(); view();
  });
  it("does not ever start a body write in synthetic mode", () => {
    expect(beginBodyAssessment(scope, true, sign())).toBeNull(); expect(hasPendingOperations()).toBe(false);
  });
  it("requires a bound receipt even inside the journal", () => {
    const first = beginBodyAssessment(scope, false, sign())!;
    expect(() => settleBodyAssessment(first, { ...receipt(), actor_user_id: "00000000-0000-4000-8000-000000000099" })).toThrow();
    expect(getBodyAssessmentPending().operation?.token).toBe(first.token); expect(hasPendingOperations()).toBe(true);
  });
  it("keeps a confirmed marker through refresh intent and stale/empty/wrong-scope snapshots", () => {
    const first = beginBodyAssessment(scope, false, sign())!; const saved = receipt(); settleBodyAssessment(first, saved);
    expect(getBodyAssessmentPending().confirmed).toHaveLength(1); expect(hasPendingOperations()).toBe(false);
    expect(beginBodyAssessment(scope, false, sign())).toBeNull();
    const fresh = { ...snapshot, demo: false, generatedAt: saved.committed_at,
      staleAfter: new Date(Date.parse(saved.committed_at) + 300_000).toISOString() };
    reconcileBodyAssessmentConfirmed(scope, { ...fresh, records: [] }, Date.now());
    reconcileBodyAssessmentConfirmed(scope, { ...fresh, recordsTruncated: true }, Date.now());
    reconcileBodyAssessmentConfirmed(scope, { ...fresh, branchId: "00000000-0000-4000-8000-000000000099" }, Date.now());
    expect(getBodyAssessmentPending().confirmed).toHaveLength(1);
    const current = { ...record, version_id: saved.version_id, version: saved.version, record_state: saved.record_state,
      history: [], historyTotal: 0, historyTruncated: false };
    reconcileBodyAssessmentConfirmed(scope, { ...fresh, records: [current] }, Date.now());
    expect(getBodyAssessmentPending().confirmed).toHaveLength(0);
  });
  it("clears only the matching scope marker on a newer complete server version", () => {
    const first = beginBodyAssessment(scope, false, sign())!; const saved = receipt(); settleBodyAssessment(first, saved);
    const next = { ...snapshot, demo: false, generatedAt: saved.committed_at,
      staleAfter: new Date(Date.parse(saved.committed_at) + 300_000).toISOString(), records: [{ ...snapshot.records[0], version: saved.version + 1 }] };
    reconcileBodyAssessmentConfirmed({ ...scope, userId: "00000000-0000-4000-8000-000000000099" }, next, Date.now());
    expect(getBodyAssessmentPending().confirmed).toHaveLength(1);
    reconcileBodyAssessmentConfirmed(scope, next, Date.now()); expect(getBodyAssessmentPending().confirmed).toHaveLength(0);
  });
  it("rolls back its lease on guard installation failure", () => {
    const add = document.addEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation((type, listener, options) => {
      if (type === "click") throw new Error("synthetic failure"); add(type, listener, options);
    });
    expect(() => beginBodyAssessment(scope, false, sign())).toThrow("synthetic failure");
    expect(getBodyAssessmentPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(false);
  });
  it("normalizes actor scope while never putting identities or payload in persistent storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem"); const getItem = vi.spyOn(Storage.prototype, "getItem");
    expect(bodyAssessmentScopeIdentity(scope, false)).toBe(bodyAssessmentScopeIdentity({ ...scope, userId: scope.userId.toUpperCase() }, false));
    beginBodyAssessment(scope, false, sign()); expect(setItem).not.toHaveBeenCalled(); expect(getItem).not.toHaveBeenCalled();
  });
  it.each([[400, "INVALID_BODY_ASSESSMENT_OPERATION"], [401, "AUTH_REQUIRED"], [403, "AAL2_REQUIRED"],
    [409, "BODY_ASSESSMENT_VERSION_CONFLICT"], [413, "REQUEST_TOO_LARGE"]])("accepts only strict known denial %s/%s", (status, code) => {
    const denied = { requestId: key, status: "error", data: null, errors: [{ code, message: "合成拒絕" }] };
    expect(isConfirmedBodyAssessmentRejection(denied, Number(status))).toBe(true);
    expect(isConfirmedBodyAssessmentRejection({ ...denied, requestId: "bad" }, Number(status))).toBe(false);
    expect(isConfirmedBodyAssessmentRejection({ ...denied, data: {} }, Number(status))).toBe(false);
    expect(isConfirmedBodyAssessmentRejection({ ...denied, errors: [{ code: "BODY_ASSESSMENT_RESULT_UNCERTAIN", message: "未知" }] }, 409)).toBe(false);
  });
});
