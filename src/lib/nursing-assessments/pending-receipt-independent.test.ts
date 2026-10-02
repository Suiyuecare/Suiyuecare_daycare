// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { buildDemoNursingAssessmentSnapshot } from "./demo";
import { beginNursingAssessment, beginNursingAssessmentReceiptCheck, cancelNursingAssessmentReceiptCheck,
  clearNursingAssessmentPendingOnLogout, getNursingAssessmentPending, isNursingAssessmentReceiptCheckCurrent,
  nursingAssessmentAuthoritySignature, observeNursingAssessmentAuthority, observeNursingAssessmentSnapshot,
  reconcileNursingAssessmentConfirmed, retryNursingAssessment, settleNursingAssessment,
  settleNursingAssessmentReceiptCheck, type NursingAssessmentOperation, type NursingAssessmentReceiptCheck } from "./pending";
import type { NursingAssessmentSnapshot, NursingReceipt } from "./types";

const interleave = vi.hoisted(() => ({ run: null as (() => void) | null }));
vi.mock("@/lib/navigation/pending-operation-lock", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/navigation/pending-operation-lock")>();
  return { ...actual, tryAcquirePendingRecoveryRead: (owner?: () => void) => {
    const held = actual.tryAcquirePendingRecoveryRead(owner);
    if (held && interleave.run) { const run = interleave.run; interleave.run = null; run(); }
    return held;
  } };
});
const uuid = (n: number) => `51930000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3) };
let serial = 0, now = Date.parse("2026-09-27T08:00:00.000Z");
let actor: TenantContext;
const caps = { canManage: true, canSign: true, hasRecentAal2: true };
function snapshot(): NursingAssessmentSnapshot {
  return { ...buildDemoNursingAssessmentSnapshot(scope.organizationId, scope.branchId), demo: false };
}
function observe(value = actor, flags = caps) {
  observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(value));
  return observeNursingAssessmentSnapshot({ organizationId: value.organizationId, branchId: value.branchId, userId: value.userId }, false, snapshot(), flags);
}
function begin(action: "create_draft" | "sign" = "create_draft") {
  const value = snapshot(), client = value.clients[0]!, source = client.versions[0]!;
  return beginNursingAssessment(scope, false, { idempotencyKey: uuid(10), request: action === "create_draft"
    ? { action, clientId: client.clientId, content: source.content }
    : { action, clientId: client.clientId, assessmentKey: source.assessmentKey, previousVersionId: source.versionId,
      expectedVersion: source.version, expectedContentHash: source.contentHash } }, value.generatedAt, action === "create_draft" ? undefined
      : { clientId: client.clientId, assessmentKey: source.assessmentKey, versionId: source.versionId, version: source.version,
        contentHash: source.contentHash, state: source.state, content: source.content })!;
}
function unknown(action: "create_draft" | "sign" = "create_draft") {
  const operation = begin(action); expect(operation).not.toBeNull(); settleNursingAssessment(operation, "unknown");
  return getNursingAssessmentPending().operation!;
}
function receipt(operation: NursingAssessmentOperation): NursingReceipt {
  const source = snapshot().clients[0]!.versions[0]!, request = operation.input.request;
  const signing = request.action === "sign";
  return { operationId: uuid(20), organizationId: scope.organizationId, branchId: scope.branchId, actorUserId: scope.userId,
    idempotencyKey: operation.input.idempotencyKey, request, replayed: false, persisted: true, demo: false,
    result: { ...source, assessmentKey: request.action === "create_draft" ? uuid(21) : request.assessmentKey,
      versionId: uuid(22), version: request.action === "create_draft" ? 1 : request.expectedVersion + 1,
      previousVersionId: request.action === "create_draft" ? null : request.previousVersionId,
      previousContentHash: request.action === "create_draft" ? null : request.expectedContentHash,
      content: structuredClone("content" in request ? request.content : operation.target!.content), contentHash: "b".repeat(64),
      state: signing ? "signed" : "draft", recordedBy: scope.userId,
      createdAt: new Date(now).toISOString(), signedAt: signing ? new Date(now).toISOString() : null,
      signedBy: signing ? scope.userId : null, signerDisplayName: signing ? "獨立合成護理" : null,
      signaturePurpose: signing ? "人工護理評估簽署" : null, signatureChallengeId: signing ? uuid(23) : null } };
}
function proof(check: NursingAssessmentReceiptCheck) {
  const operation = check.operation;
  return { schemaVersion: 1, status: "committed", organizationId: scope.organizationId, branchId: scope.branchId,
    actorUserId: scope.userId, clientId: operation.input.request.clientId, action: operation.input.request.action,
    idempotencyKey: operation.input.idempotencyKey, nonce: check.nonce, verifiedAt: new Date().toISOString(),
    persisted: true, demo: false, receipt: receipt(operation) };
}
function retained(operation: NursingAssessmentOperation) {
  expect(getNursingAssessmentPending().operation?.token).toBe(operation.token);
  expect(getNursingAssessmentPending().operation?.body).toBe(operation.body);
  expect(getNursingAssessmentPending().operation?.input.idempotencyKey).toBe(operation.input.idempotencyKey);
  expect(getNursingAssessmentPending().operation?.target).toBe(operation.target);
  expect(getNursingAssessmentPending().operation?.phase).toBe("unknown");
  expect(getNursingAssessmentPending().confirmed).toHaveLength(0); expect(hasPendingOperations()).toBe(true);
}
beforeEach(() => {
  now = Date.parse("2026-09-27T08:00:00.000Z") + ++serial * 86400000;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  clearNursingAssessmentPendingOnLogout(); actor = { ...scope, organizationName: "獨立合成機構", branchName: "獨立合成分支", displayName: "獨立合成護理",
    roles: ["nurse"], scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage", "nursing_assessments.sign"],
    assuranceLevel: "aal2", recentAal2At: new Date(now).toISOString(), demo: false };
  expect(observe()).toBe(true);
});
afterEach(() => { interleave.run = null; clearNursingAssessmentPendingOnLogout(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("independent exact nursing history-confirmation journal", () => {
  it("does not check when absent, sending, demo or a foreign actor owns the operation", () => {
    expect(beginNursingAssessmentReceiptCheck(scope, false)).toBeNull(); const sending = begin();
    expect(beginNursingAssessmentReceiptCheck(scope, false)).toBeNull(); settleNursingAssessment(sending, "unknown");
    expect(beginNursingAssessmentReceiptCheck(scope, true)).toBeNull();
    expect(beginNursingAssessmentReceiptCheck({ ...scope, userId: uuid(99) }, false)).toBeNull();
  });
  it("holds both read and original write leases, and excludes retries, double checks and other writes", () => {
    const operation = unknown(), check = beginNursingAssessmentReceiptCheck(scope, false)!;
    expect(check).not.toBeNull(); expect(Object.isFrozen(check)).toBe(true); expect(check.operation).toBe(operation);
    expect(isNursingAssessmentReceiptCheckCurrent(check)).toBe(true); expect(hasViewTransition()).toBe(true);
    expect(tryAcquirePendingOperation()).toBeNull(); expect(beginNursingAssessmentReceiptCheck(scope, false)).toBeNull();
    expect(retryNursingAssessment(operation.token, scope, false)).toBeNull(); retained(operation);
    expect(cancelNursingAssessmentReceiptCheck(check)).toBe(true); expect(cancelNursingAssessmentReceiptCheck(check)).toBe(false);
    expect(hasViewTransition()).toBe(false); retained(operation);
  });
  it("foreign pending leases deny history check without releasing the original or foreign owner", () => {
    const operation = unknown(), foreign = tryAcquirePendingOperation()!;
    try { expect(beginNursingAssessmentReceiptCheck(scope, false)).toBeNull(); retained(operation); }
    finally { foreign(); }
    const check = beginNursingAssessmentReceiptCheck(scope, false)!; expect(check).not.toBeNull(); cancelNursingAssessmentReceiptCheck(check);
    retained(operation);
  });
  it("never performs network, automatically retries or mints a fresh write key on check/cancel", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const operation = unknown();
    const check = beginNursingAssessmentReceiptCheck(scope, false)!; cancelNursingAssessmentReceiptCheck(check);
    expect(fetch).not.toHaveBeenCalled(); retained(operation);
  });
  it("not_found preserves the unknown request and releases only its read lease", () => {
    const operation = unknown(), check = beginNursingAssessmentReceiptCheck(scope, false)!;
    expect(settleNursingAssessmentReceiptCheck(check, { ...proof(check), status: "not_found", persisted: false, receipt: null })).toBe("not_found");
    retained(operation); expect(hasViewTransition()).toBe(false); expect(isNursingAssessmentReceiptCheckCurrent(check)).toBe(false);
    const next = beginNursingAssessmentReceiptCheck(scope, false)!; expect(next.nonce).not.toBe(check.nonce); cancelNursingAssessmentReceiptCheck(next);
  });
  it.each(["organizationId", "branchId", "actorUserId", "clientId", "idempotencyKey", "nonce"] as const)("does not confirm proof with different %s", field => {
    const operation = unknown(), check = beginNursingAssessmentReceiptCheck(scope, false)!;
    expect(settleNursingAssessmentReceiptCheck(check, { ...proof(check), [field]: uuid(99) })).toBe("unavailable");
    retained(operation); expect(hasViewTransition()).toBe(false);
  });
  it.each([{ action: "sign" }, { schemaVersion: 2 }, { persisted: false }, { demo: true }, { extra: "PRIVATE_SECRET" }, { status: "not_found" }, { receipt: null }])("does not confirm malformed committed proof %#", change => {
    const operation = unknown(), check = beginNursingAssessmentReceiptCheck(scope, false)!;
    expect(settleNursingAssessmentReceiptCheck(check, { ...proof(check), ...change })).toBe("unavailable");
    retained(operation); expect(hasViewTransition()).toBe(false);
  });
  it.each([null, {}, { status: "error", data: null }, "PRIVATE_SECRET"])("does not treat arbitrary envelope/denial %# as completed receipt", value => {
    const operation = unknown(), check = beginNursingAssessmentReceiptCheck(scope, false)!;
    expect(settleNursingAssessmentReceiptCheck(check, value)).toBe("unavailable"); retained(operation);
  });
  it("rejects cloned handles without releasing a legitimate check or its original write", () => {
    const operation = unknown(), check = beginNursingAssessmentReceiptCheck(scope, false)!, clone = { ...check };
    expect(isNursingAssessmentReceiptCheckCurrent(clone)).toBe(false); expect(cancelNursingAssessmentReceiptCheck(clone)).toBe(false);
    expect(settleNursingAssessmentReceiptCheck(clone, proof(check))).toBe("stale");
    expect(isNursingAssessmentReceiptCheckCurrent(check)).toBe(true); expect(hasViewTransition()).toBe(true); retained(operation);
    cancelNursingAssessmentReceiptCheck(check);
  });
  it.each([-60001, 60001])("rejects checked-at timestamp beyond frozen 60-second skew boundary %i", skew => {
    const operation = unknown(), check = beginNursingAssessmentReceiptCheck(scope, false)!;
    expect(settleNursingAssessmentReceiptCheck(check, { ...proof(check), verifiedAt: new Date(Date.now() + skew).toISOString() })).toBe("unavailable");
    retained(operation);
  });
  it("rejects original content changed under the same key", () => {
    const operation = unknown(), check = beginNursingAssessmentReceiptCheck(scope, false)!, evidence = proof(check);
    const changed = structuredClone(evidence); if ("content" in changed.receipt.request) changed.receipt.request.content.domains.observations.detail = "不是原始請求";
    expect(settleNursingAssessmentReceiptCheck(check, changed)).toBe("unavailable"); retained(operation);
  });
  it("rejects replay-marked rather than original stored receipt", () => {
    const operation = unknown(), check = beginNursingAssessmentReceiptCheck(scope, false)!, evidence = proof(check);
    evidence.receipt.replayed = true; expect(settleNursingAssessmentReceiptCheck(check, evidence)).toBe("unavailable"); retained(operation);
  });
  it.each(["content", "versionId"] as const)("rejects signed receipt with wrong predecessor %s", field => {
    const operation = unknown("sign"), check = beginNursingAssessmentReceiptCheck(scope, false)!, evidence = proof(check);
    if (field === "content") evidence.receipt.result.content.domains.observations.detail = "不是確認過的簽署內容";
    else evidence.receipt.result.versionId = operation.target!.versionId;
    expect(settleNursingAssessmentReceiptCheck(check, evidence)).toBe("unavailable"); retained(operation);
  });
  it("rejects a persisted result created after verifiedAt", () => {
    const operation = unknown(), check = beginNursingAssessmentReceiptCheck(scope, false)!, evidence = proof(check);
    evidence.receipt.result.createdAt = new Date(Date.now() + 1).toISOString();
    expect(settleNursingAssessmentReceiptCheck(check, evidence)).toBe("unavailable"); retained(operation);
  });
  it.each(["actor", "read permission", "clinical role", "write permission", "AAL", "source generation", "assignment"])("late proof after %s boundary cannot settle or discard immutable intent", kind => {
    const operation = unknown(), check = beginNursingAssessmentReceiptCheck(scope, false)!, evidence = proof(check);
    if (kind === "actor") { observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature({ ...actor, userId: uuid(99) })); observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(actor)); }
    else if (kind === "read permission") { observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature({ ...actor, scopes: [] })); observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(actor)); }
    else if (kind === "clinical role") { observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature({ ...actor, roles: ["branch_supervisor"], recentAal2At: null })); observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(actor)); }
    else if (kind === "write permission") { observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature({ ...actor, scopes: ["clients.read", "nursing_assessments.read"], recentAal2At: null })); observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(actor)); }
    else if (kind === "AAL") { observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature({ ...actor, assuranceLevel: "aal1" })); observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(actor)); }
    else { vi.setSystemTime(Date.now() + 1); const source = snapshot();
      if (kind === "assignment") { source.clients = []; source.clientTotal = 0; }
      observeNursingAssessmentSnapshot(scope, false, source, caps);
    }
    expect(isNursingAssessmentReceiptCheckCurrent(check)).toBe(false);
    expect(settleNursingAssessmentReceiptCheck(check, evidence)).toBe("stale"); retained(operation); expect(hasViewTransition()).toBe(false);
  });
  it("logout and late old proof cannot release a newer request's write lease", () => {
    const operation = unknown(), check = beginNursingAssessmentReceiptCheck(scope, false)!, evidence = proof(check);
    clearNursingAssessmentPendingOnLogout(); cancelNursingAssessmentReceiptCheck(check); vi.setSystemTime(Date.now() + 1); expect(observe()).toBe(true);
    const newer = unknown(); expect(newer.token).not.toBe(operation.token);
    expect(settleNursingAssessmentReceiptCheck(check, evidence)).toBe("stale"); retained(newer);
  });
  it.each(["logout", "scope ABA", "source generation"])("synchronous read lease observer %s prevents admission before lookup", kind => {
    const operation = unknown(); interleave.run = () => {
      if (kind === "logout") clearNursingAssessmentPendingOnLogout();
      else if (kind === "scope ABA") { observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature({ ...actor, branchId: uuid(99) })); observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(actor)); }
      else { vi.setSystemTime(Date.now() + 1); expect(observe()).toBe(true); }
    };
    expect(beginNursingAssessmentReceiptCheck(scope, false)).toBeNull(); expect(hasViewTransition()).toBe(false);
    if (kind !== "logout") retained(operation);
  });
  it("confirms the exact existing signature after MFA expires without authorizing a new sign or replay", () => {
    const operation = unknown("sign"), persisted = receipt(operation);
    vi.setSystemTime(now + 16 * 60000); actor = { ...actor, recentAal2At: null };
    expect(observe(actor, { ...caps, hasRecentAal2: false })).toBe(true);
    expect(retryNursingAssessment(operation.token, scope, false)).toBeNull();
    const check = beginNursingAssessmentReceiptCheck(scope, false)!; expect(check).not.toBeNull();
    const evidence = { ...proof(check), receipt: persisted };
    expect(settleNursingAssessmentReceiptCheck(check, evidence)).toBe("confirmed");
    expect(getNursingAssessmentPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(false); expect(hasViewTransition()).toBe(false);
    expect(getNursingAssessmentPending().confirmed).toHaveLength(1); expect(actor.recentAal2At).toBeNull(); expect(begin("sign")).toBeNull();
  });
  it("current own-history read authority can confirm after clinical writing scopes are removed", () => {
    const operation = unknown("sign"), persisted = receipt(operation); vi.setSystemTime(now + 1000);
    actor = { ...actor, roles: ["branch_supervisor"], scopes: ["clients.read", "nursing_assessments.read"], recentAal2At: null };
    expect(observe(actor, { canManage: false, canSign: false, hasRecentAal2: false })).toBe(true);
    const check = beginNursingAssessmentReceiptCheck(scope, false)!; expect(check).not.toBeNull();
    expect(settleNursingAssessmentReceiptCheck(check, { ...proof(check), receipt: persisted })).toBe("confirmed");
    expect(getNursingAssessmentPending().confirmed).toHaveLength(1); expect(begin("sign")).toBeNull();
  });
  it("positive exact history creates a guard but does not pretend the visible list already contains that result", () => {
    unknown(); const check = beginNursingAssessmentReceiptCheck(scope, false)!, evidence = proof(check);
    expect(settleNursingAssessmentReceiptCheck(check, evidence)).toBe("confirmed");
    expect(getNursingAssessmentPending().operation).toBeNull(); expect(getNursingAssessmentPending().confirmed).toHaveLength(1);
    reconcileNursingAssessmentConfirmed(scope, snapshot(), Date.now()); expect(getNursingAssessmentPending().confirmed).toHaveLength(1);
    expect(begin()).toBeNull(); expect(hasPendingOperations()).toBe(false);
    vi.setSystemTime(now + 1); const updated = snapshot(); updated.clients = updated.clients.map(client => client.clientId === evidence.clientId
      ? { ...client, versions: [evidence.receipt.result, ...client.versions.map(version => ({ ...version, createdAt: new Date(now - 1000).toISOString() }))], versionsTotal: client.versionsTotal + 1 } : client);
    reconcileNursingAssessmentConfirmed(scope, { ...updated, clientTotal: updated.clientTotal + 1, clientsTruncated: true }, Date.now());
    expect(getNursingAssessmentPending().confirmed).toHaveLength(1);
    reconcileNursingAssessmentConfirmed(scope, updated, Date.now()); expect(getNursingAssessmentPending().confirmed).toHaveLength(0);
  });
});
