// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { hasPendingOperations, tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { buildDemoNursingAssessmentSnapshot } from "./demo";
import {
  beginNursingAssessment, clearNursingAssessmentPendingOnLogout, getNursingAssessmentPending,
  nursingAssessmentAuthoritySignature, observeNursingAssessmentAuthority, observeNursingAssessmentSnapshot,
  reconcileNursingAssessmentConfirmed, retryNursingAssessment, settleNursingAssessment,
  type NursingAssessmentInput, type NursingAssessmentOperation,
} from "./pending";
import type { NursingReceipt, NursingRequest, NursingVersion } from "./types";

const org = "51100000-0000-4000-8000-000000000001";
const branch = "51200000-0000-4000-8000-000000000001";
const actor = "51000000-0000-4000-8000-000000000013";
const key = "51700000-0000-4000-8000-000000000011";
const resultId = "51800000-0000-4000-8000-000000000011";
let now = "2026-09-26T10:00:00.000Z";
let sourceAt = "2026-09-26T09:59:59.000Z";
let freshAt = "2026-09-26T10:00:01.000Z";
let testSerial = 0;
const scope = { organizationId: org, branchId: branch, userId: actor };
function context(overrides: Partial<TenantContext> = {}): TenantContext {
  return { ...scope, organizationName: "合成機構", branchName: "合成分支", displayName: "合成護理人員",
    roles: ["nurse"], scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage", "nursing_assessments.sign"],
    assuranceLevel: "aal2", recentAal2At: now, demo: false, ...overrides };
}
function observe(overrides: Partial<TenantContext> = {}) {
  observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(context(overrides)));
}
function source() {
  const snapshot = { ...buildDemoNursingAssessmentSnapshot(org, branch), demo: false, generatedAt: sourceAt,
    staleAfter: new Date(Date.parse(sourceAt) + 300000).toISOString() };
  const client = snapshot.clients[0]!;
  const version = { ...client.versions[0]!, recordedBy: actor, createdAt: sourceAt };
  snapshot.clients = snapshot.clients.map(row => row.clientId === client.clientId ? { ...row, versions: [version] } : row);
  return { snapshot, client, version, target: { clientId: client.clientId, assessmentKey: version.assessmentKey,
    versionId: version.versionId, version: version.version, contentHash: version.contentHash,
    state: version.state, content: version.content } };
}
function admit(overrides: Partial<TenantContext> = {}) {
  const current = context(overrides);
  return observeNursingAssessmentSnapshot({ organizationId: org, branchId: branch, userId: current.userId }, false, source().snapshot,
    { canManage: true, canSign: true, hasRecentAal2: true });
}
function newerAdmission(overrides: Partial<TenantContext> = {}) {
  vi.setSystemTime(Date.now() + 1); sourceAt = new Date().toISOString();
  expect(admit(overrides)).toBe(true);
}
function createInput(): NursingAssessmentInput {
  const { client, version } = source();
  return { request: { action: "create_draft", clientId: client.clientId, content: version.content }, idempotencyKey: key };
}
function beginSign() {
  const { target } = source();
  const request: NursingRequest = { action: "sign", clientId: target.clientId,
    assessmentKey: target.assessmentKey, previousVersionId: target.versionId,
    expectedVersion: target.version, expectedContentHash: target.contentHash };
  return beginNursingAssessment(scope, false, { request, idempotencyKey: key }, sourceAt, target)!;
}
function receipt(operation: NursingAssessmentOperation): NursingReceipt {
  const { version } = source();
  const request = operation.input.request;
  const signing = request.action === "sign" || request.action === "correct";
  const result: NursingVersion = { ...version, versionId: resultId,
    version: request.action === "create_draft" ? 1 : request.expectedVersion + 1,
    assessmentKey: request.action === "create_draft" ? version.assessmentKey : request.assessmentKey,
    previousVersionId: request.action === "create_draft" ? null : request.previousVersionId,
    previousContentHash: request.action === "create_draft" ? null : request.expectedContentHash,
    contentHash: "b".repeat(64), content: structuredClone("content" in request ? request.content : operation.target!.content),
    state: request.action === "sign" ? "signed" : request.action === "correct" ? "corrected" : "draft",
    correctionReason: request.action === "correct" ? request.correctionReason : null,
    createdAt: now, signedAt: signing ? now : null, signedBy: signing ? actor : null,
    signerDisplayName: signing ? "合成護理人員" : null,
    signaturePurpose: signing ? request.action === "sign" ? "人工護理評估簽署" : "人工護理評估更正簽署" : null,
    signatureChallengeId: signing ? key : null };
  return { organizationId: org, branchId: branch, actorUserId: actor, operationId: resultId, idempotencyKey: key,
    request, result, replayed: false, persisted: true, demo: false };
}
beforeEach(() => { now = new Date(Date.parse("2026-09-26T10:00:00.000Z") + ++testSerial * 86400000).toISOString();
  sourceAt = new Date(Date.parse(now) - 1000).toISOString(); freshAt = new Date(Date.parse(now) + 1000).toISOString();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(now)); clearNursingAssessmentPendingOnLogout(); observe(); expect(admit()).toBe(true); });
afterEach(() => { clearNursingAssessmentPendingOnLogout(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("independent nursing receipt and privacy regressions", () => {
  it("keeps exact request after unknown then known denial; no replacement operation or key", () => {
    const input = createInput(); const first = beginNursingAssessment(scope, false, input, sourceAt)!;
    if ("content" in input.request) input.request.content.domains.observations.detail = "在送出後變更，不得滲入重試";
    settleNursingAssessment(first, "unknown");
    const second = retryNursingAssessment(first.token, scope, false)!;
    expect(second.body).toBe(first.body); expect(second.body).not.toContain("不得滲入重試");
    settleNursingAssessment(second, "denied");
    expect(getNursingAssessmentPending().operation?.phase).toBe("unknown");
    expect(getNursingAssessmentPending().operation?.input.idempotencyKey).toBe(key);
    expect(beginNursingAssessment(scope, false, createInput(), sourceAt)).toBeNull();
    expect(hasPendingOperations()).toBe(true);
  });
  it("rejects a plausible sign receipt with changed narrative while preserving its lease", () => {
    const operation = beginSign(); const changed = receipt(operation);
    changed.result.content.domains.observations.detail = "不是使用者確認的護理內容";
    expect(() => settleNursingAssessment(operation, changed)).toThrow();
    expect(getNursingAssessmentPending().operation).toBe(operation); expect(hasPendingOperations()).toBe(true);
    settleNursingAssessment(operation, "unknown");
    const retry = retryNursingAssessment(operation.token, scope, false)!;
    expect(retry.body).toBe(operation.body);
    expect(settleNursingAssessment(retry, receipt(retry))).toBe(true);
    expect(getNursingAssessmentPending().confirmed).toHaveLength(1);
  });
  it("rejects append receipt reusing its predecessor UUID even with version+1", () => {
    const operation = beginSign(); const changed = receipt(operation);
    changed.result.versionId = operation.target!.versionId;
    expect(() => settleNursingAssessment(operation, changed)).toThrow();
    expect(getNursingAssessmentPending().confirmed).toHaveLength(0); expect(hasPendingOperations()).toBe(true);
  });
  it("does not compare a full-row signed hash with its predecessor hash", () => {
    const operation = beginSign(); const valid = receipt(operation);
    expect(valid.result.contentHash).not.toBe(operation.target!.contentHash);
    expect(settleNursingAssessment(operation, valid)).toBe(true);
    expect(hasPendingOperations()).toBe(false);
  });
  it("binds observed actor identity before begin and retry, not just syntactic scope", () => {
    observe({ userId: org });
    expect(beginNursingAssessment(scope, false, createInput(), sourceAt)).toBeNull();
    expect(hasPendingOperations()).toBe(false);
    observe(); newerAdmission(); const first = beginNursingAssessment(scope, false, createInput(), sourceAt)!;
    settleNursingAssessment(first, "unknown"); observe({ userId: org });
    expect(retryNursingAssessment(first.token, scope, false)).toBeNull();
    observe(); expect(retryNursingAssessment(first.token, scope, false)).toBeNull(); newerAdmission();
    const retry = retryNursingAssessment(first.token, scope, false)!;
    expect(retry.body).toBe(first.body); expect(settleNursingAssessment(first, receipt(first))).toBe(false);
  });
  it("privilege revoke/restore ABA invalidates the original response without releasing the unknown request", () => {
    const first = beginSign(); observe({ scopes: ["clients.read", "nursing_assessments.read"] }); observe();
    expect(settleNursingAssessment(first, receipt(first))).toBe(false);
    expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"); expect(hasPendingOperations()).toBe(true);
    expect(retryNursingAssessment(first.token, scope, false)).toBeNull(); newerAdmission();
    const retry = retryNursingAssessment(first.token, scope, false)!;
    expect(retry.attempt).not.toBe(first.attempt); expect(retry.body).toBe(first.body);
  });
  it("expiry while a signing request is in flight remains uncertain, not an accepted success", () => {
    const operation = beginSign(); vi.setSystemTime(new Date(Date.parse(now) + 15 * 60_000 + 1));
    expect(settleNursingAssessment(operation, receipt(operation))).toBe(true);
    expect(getNursingAssessmentPending().confirmed).toHaveLength(0);
    expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"); expect(hasPendingOperations()).toBe(true);
  });
  it("logout invalidates late responses and cannot release a newer request lease", () => {
    const old = beginNursingAssessment(scope, false, createInput(), sourceAt)!;
    clearNursingAssessmentPendingOnLogout(); observe();
    expect(beginNursingAssessment(scope, false, createInput(), sourceAt)).toBeNull(); newerAdmission();
    const current = beginNursingAssessment(scope, false, createInput(), sourceAt)!;
    expect(settleNursingAssessment(old, receipt(old))).toBe(false);
    expect(getNursingAssessmentPending().operation).toBe(current); expect(hasPendingOperations()).toBe(true);
  });
  it("logout does not release another journal's opaque lease", () => {
    const release = tryAcquirePendingOperation()!;
    try { clearNursingAssessmentPendingOnLogout(); expect(hasPendingOperations()).toBe(true); }
    finally { release(); }
  });
  it("does not clear saved marker from another client's matching chain or an absent page", () => {
    const operation = beginNursingAssessment(scope, false, createInput(), sourceAt)!;
    const saved = receipt(operation); settleNursingAssessment(operation, saved);
    const { snapshot, client } = source();
    const fresh = { ...snapshot, demo: false, generatedAt: freshAt,
      staleAfter: new Date(Date.parse(freshAt) + 300000).toISOString(), clientTotal: 1,
      clients: [{ ...client, clientId: org, versions: [saved.result], versionsTotal: 1, versionsTruncated: false }] };
    reconcileNursingAssessmentConfirmed(scope, fresh, Date.now());
    expect(getNursingAssessmentPending().confirmed).toHaveLength(1);
    reconcileNursingAssessmentConfirmed(scope, { ...fresh, clients: [], clientTotal: 0 }, Date.now());
    expect(getNursingAssessmentPending().confirmed).toHaveLength(1);
    vi.setSystemTime(new Date(freshAt));
    reconcileNursingAssessmentConfirmed(scope, { ...fresh, clients: [{ ...fresh.clients[0]!, clientId: client.clientId }] }, Date.now());
    expect(getNursingAssessmentPending().confirmed).toHaveLength(0);
  });
});
