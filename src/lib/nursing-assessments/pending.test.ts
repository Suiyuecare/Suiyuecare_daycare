// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { hasPendingOperations, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { buildDemoNursingAssessmentSnapshot } from "./demo";
import { parseNursingRequest } from "./parser";
import type { NursingAssessmentSnapshot, NursingReceipt, NursingRequest } from "./types";
import { beginNursingAssessment, clearNursingAssessmentPendingOnLogout, getNursingAssessmentPending,
  isConfirmedNursingAssessmentRejection, nursingAssessmentAuthoritySignature, nursingAssessmentScopeIdentity,
  observeNursingAssessmentAuthority, observeNursingAssessmentSnapshot, reconcileNursingAssessmentConfirmed, retryNursingAssessment,
  settleNursingAssessment, type NursingAssessmentTarget } from "./pending";

const guardFault = vi.hoisted(() => ({ fail: false }));
const leaseInterleave = vi.hoisted(() => ({ run: null as (() => void) | null }));
vi.mock("@/lib/navigation/pending-operation-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/navigation/pending-operation-lock")>();
  return { ...actual, tryAcquirePendingOperation: () => {
    const lease = actual.tryAcquirePendingOperation();
    if (lease && leaseInterleave.run) { const run = leaseInterleave.run; leaseInterleave.run = null; run(); }
    return lease;
  } };
});
vi.mock("@/lib/navigation/pending-navigation-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/navigation/pending-navigation-guard")>();
  return { ...actual, installPendingNavigationGuard: (options: Parameters<typeof actual.installPendingNavigationGuard>[0]) => {
    if (guardFault.fail) throw new Error("synthetic guard registration failure");
    return actual.installPendingNavigationGuard(options);
  } };
});
const uuid = (n: number) => `51000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { organizationId: uuid(80), branchId: uuid(81), userId: uuid(13) };
const context: TenantContext = { ...scope, organizationName: "合成機構", branchName: "合成分支", displayName: "合成護理",
  roles: ["nurse"], scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage", "nursing_assessments.sign"],
  assuranceLevel: "aal2", recentAal2At: "2026-09-26T11:00:00.000Z", demo: false };
let testSerial = 0;
function admit(currentScope = scope, currentContext = context) {
  const snapshot = { ...buildDemoNursingAssessmentSnapshot(currentScope.organizationId, currentScope.branchId), demo: false };
  const age = currentContext.recentAal2At === null ? Infinity : Date.now() - Date.parse(currentContext.recentAal2At);
  return observeNursingAssessmentSnapshot(currentScope, false, snapshot, { canManage: currentContext.roles.includes("nurse") && currentContext.scopes.includes("nursing_assessments.manage"),
    canSign: currentContext.roles.includes("nurse") && currentContext.scopes.includes("nursing_assessments.sign"), hasRecentAal2: age >= 0 && age <= 15 * 60_000 });
}
const source = () => buildDemoNursingAssessmentSnapshot(scope.organizationId, scope.branchId).clients[0].versions[0];
const target = (): NursingAssessmentTarget => ({ clientId: uuid(1), assessmentKey: source().assessmentKey,
  versionId: source().versionId, version: source().version, state: source().state, contentHash: source().contentHash, content: source().content });
function input(action: NursingRequest["action"] = "create_draft", n = 1) {
  const old = source();
  const request: NursingRequest = action === "create_draft" ? { action, clientId: uuid(2), content: old.content }
    : action === "sign" ? { action, clientId: uuid(1), assessmentKey: old.assessmentKey, previousVersionId: old.versionId, expectedVersion: old.version, expectedContentHash: old.contentHash }
      : { action, clientId: uuid(1), assessmentKey: old.assessmentKey, previousVersionId: old.versionId, expectedVersion: old.version, expectedContentHash: old.contentHash,
        content: old.content, ...(action === "correct" ? { correctionReason: "合成更正理由" } : {}) } as NursingRequest;
  return parseNursingRequest(request, uuid(100 + n));
}
function receipt(value = input(), n = 1): NursingReceipt {
  const request = value.request; const signing = request.action === "sign" || request.action === "correct";
  return { operationId: uuid(200 + n), organizationId: scope.organizationId, branchId: scope.branchId, actorUserId: scope.userId, idempotencyKey: value.idempotencyKey, request,
    replayed: false, persisted: true, demo: false,
    result: { ...source(), assessmentKey: request.action === "create_draft" ? uuid(300 + n) : request.assessmentKey,
      versionId: uuid(400 + n), version: request.action === "create_draft" ? 1 : request.expectedVersion + 1,
      previousVersionId: request.action === "create_draft" ? null : request.previousVersionId,
      previousContentHash: request.action === "create_draft" ? null : request.expectedContentHash,
      content: "content" in request ? request.content : source().content, contentHash: "b".repeat(64),
      state: request.action === "sign" ? "signed" : request.action === "correct" ? "corrected" : "draft",
      correctionReason: request.action === "correct" ? request.correctionReason : null,
      recordedBy: scope.userId, signedAt: signing ? new Date().toISOString() : null, signedBy: signing ? scope.userId : null,
      signerDisplayName: signing ? "合成護理" : null, signaturePurpose: signing ? request.action === "sign" ? "人工護理評估簽署" : "人工護理評估更正簽署" : null,
      signatureChallengeId: signing ? uuid(500 + n) : null, createdAt: new Date().toISOString() } };
}
function begin(action: NursingRequest["action"] = "create_draft") {
  return beginNursingAssessment(scope, false, input(action), new Date().toISOString(), action === "create_draft" ? undefined : target())!;
}
function snapshotWith(saved: NursingReceipt): NursingAssessmentSnapshot {
  const base = buildDemoNursingAssessmentSnapshot(scope.organizationId, scope.branchId);
  return { ...base, demo: false, clients: base.clients.map((client) => client.clientId === saved.request.clientId
    ? { ...client, versions: [saved.result, ...client.versions], versionsTotal: client.versionsTotal + 1 } : client) };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(Date.parse("2026-09-26T11:00:00.000Z") + ++testSerial * 86400000));
  context.recentAal2At = new Date().toISOString();
  clearNursingAssessmentPendingOnLogout(); observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(context));
  expect(admit()).toBe(true);
});
afterEach(() => { guardFault.fail = false; leaseInterleave.run = null; clearNursingAssessmentPendingOnLogout(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.useRealTimers(); });

describe("bounded immutable nursing write journal", () => {
  it("normalizes UUIDs, deep-freezes separate clinical content and retries exactly the original key/body/source", () => {
    const value = input("revise_draft"); const proof = target();
    const first = beginNursingAssessment({ ...scope, organizationId: scope.organizationId.toUpperCase() }, false, value, new Date().toISOString(), proof)!;
    expect(first.identity).toBe(nursingAssessmentScopeIdentity(scope, false));
    expect(Object.isFrozen(first.input.request)).toBe(true); expect(Object.isFrozen(first.target!.content.domains.observations)).toBe(true);
    if ("content" in value.request) value.request.content.domains.observations.detail = "後改的合成文字";
    proof.content.domains.observations.detail = "後改的來源文字";
    expect(first.body).not.toContain("後改"); expect(first.target!.content.domains.observations.detail).not.toContain("後改");
    settleNursingAssessment(first, "unknown"); const retry = retryNursingAssessment(first.token, scope, false)!;
    expect(retry.body).toBe(first.body); expect(retry.input.idempotencyKey).toBe(first.input.idempotencyKey);
    expect(retry.target).toBe(first.target); expect(retry.token).toBe(first.token); expect(retry.attempt).not.toBe(first.attempt);
  });
  it("keeps the original unknown operation and shared lease after a later known rejection", () => {
    const first = begin(); settleNursingAssessment(first, "unknown"); const next = retryNursingAssessment(first.token, scope, false)!;
    expect(settleNursingAssessment(next, "denied")).toBe(true);
    expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"); expect(getNursingAssessmentPending().operation?.input.idempotencyKey).toBe(first.input.idempotencyKey);
    expect(hasPendingOperations()).toBe(true); expect(begin()).toBeNull();
  });
  it("only releases a first positively known rejection without creating a confirmation marker", () => {
    const first = begin(); expect(settleNursingAssessment(first, "denied")).toBe(true);
    expect(getNursingAssessmentPending().operation).toBeNull(); expect(getNursingAssessmentPending().confirmed).toHaveLength(0); expect(hasPendingOperations()).toBe(false);
  });
  it("prevents double starts, stale attempts and forged operation copies from settling", () => {
    const first = begin(); expect(begin()).toBeNull(); expect(settleNursingAssessment({ ...first }, "denied")).toBe(false);
    settleNursingAssessment(first, "unknown"); const next = retryNursingAssessment(first.token, scope, false)!;
    expect(settleNursingAssessment(first, receipt())).toBe(false); expect(getNursingAssessmentPending().operation).toBe(next);
  });
  it("holds memory and lease without any React owner; it never performs an automatic request", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const first = begin(); settleNursingAssessment(first, "unknown");
    vi.advanceTimersByTime(60_000); expect(getNursingAssessmentPending().operation?.body).toBe(first.body); expect(hasPendingOperations()).toBe(true); expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("blocks starts under another journal or view lease without clearing its owner", () => {
    const held = tryAcquirePendingOperation()!; expect(begin()).toBeNull(); expect(hasPendingOperations()).toBe(true); held();
    const view = tryAcquireViewTransition()!; expect(begin()).toBeNull(); view(); expect(begin()).not.toBeNull();
  });
  it.each(["scope", "scope ABA", "logout"])("invalidates admission when synchronous lease notifications change %s", (change) => {
    leaseInterleave.run = () => {
      if (change === "logout") clearNursingAssessmentPendingOnLogout();
      else observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature({ ...context, branchId: uuid(999) }));
      if (change !== "scope") observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(context));
    };
    expect(begin()).toBeNull(); expect(getNursingAssessmentPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(false);
  });
  it("rejects old source admission when synchronous lease notifications publish a newer same-capability generation", () => {
    leaseInterleave.run = () => { vi.setSystemTime(Date.now() + 1); expect(admit()).toBe(true); };
    expect(begin("revise_draft")).toBeNull();
    expect(getNursingAssessmentPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(false);
  });
  it.each(["organizationId", "branchId", "userId"] as const)("rejects foreign %s beginning and retrying", (field) => {
    expect(beginNursingAssessment({ ...scope, [field]: uuid(999) }, false, input(), new Date().toISOString())).toBeNull();
    const first = begin(); settleNursingAssessment(first, "unknown"); expect(retryNursingAssessment(first.token, { ...scope, [field]: uuid(999) }, false)).toBeNull();
  });
  it("rejects demo writes and malformed authority signatures without replacing the current authority", () => {
    expect(beginNursingAssessment(scope, true, input(), new Date().toISOString())).toBeNull();
    const before = getNursingAssessmentPending().authoritySignature;
    expect(() => observeNursingAssessmentAuthority("arbitrary")).toThrow(); expect(getNursingAssessmentPending().authoritySignature).toBe(before);
  });
  it("observes valid demo context identifiers without UUID parsing or granting write authority", () => {
    const demo = { ...context, organizationId: "demo-org", branchId: "demo-branch", userId: "demo-user", recentAal2At: null, demo: true };
    expect(() => observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(demo))).not.toThrow();
    expect(begin()).toBeNull(); expect(beginNursingAssessment({ organizationId: demo.organizationId, branchId: demo.branchId, userId: demo.userId }, true, input(), new Date().toISOString())).toBeNull();
    expect(hasPendingOperations()).toBe(false);
  });
  it.each([{ roles: ["organization_manager"] }, { scopes: ["clients.read", "nursing_assessments.read"] }, { assuranceLevel: "aal1" }])("does not start without current nursing authority %j", (change) => {
    observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature({ ...context, ...change } as TenantContext)); expect(begin()).toBeNull(); expect(hasPendingOperations()).toBe(false);
  });
  it("drafts do not invent recent reauth, but sign/retry require actual current recency", () => {
    const noRecent = { ...context, recentAal2At: null };
    observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(noRecent)); admit(scope, noRecent);
    const first = begin(); expect(first).not.toBeNull(); settleNursingAssessment(first, "denied"); expect(begin("sign")).toBeNull();
    observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(context)); admit(); const sign = begin("sign"); settleNursingAssessment(sign, "unknown");
    vi.advanceTimersByTime(16 * 60_000); expect(retryNursingAssessment(sign.token, scope, false)).toBeNull(); expect(hasPendingOperations()).toBe(true);
  });
  it("actual recency expiring in flight preserves unknown and never marks success", () => {
    const first = begin("sign"); vi.advanceTimersByTime(16 * 60_000);
    expect(settleNursingAssessment(first, receipt(input("sign")))).toBe(true);
    expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"); expect(getNursingAssessmentPending().confirmed).toHaveLength(0); expect(hasPendingOperations()).toBe(true);
  });
  it.each(["scope", "permission", "aal"])("makes old replies invalid through global %s ABA while retaining exact recovery", (kind) => {
    const first = begin();
    const dropped: TenantContext = kind === "scope" ? { ...context, branchId: uuid(99) } : kind === "permission" ? { ...context, scopes: [] } : { ...context, assuranceLevel: "aal1" };
    observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(dropped)); observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(context));
    expect(settleNursingAssessment(first, receipt())).toBe(false); expect(settleNursingAssessment(first, "denied")).toBe(false);
    expect(retryNursingAssessment(first.token, scope, false)).toBeNull();
    vi.setSystemTime(Date.now() + 1); expect(admit()).toBe(true);
    const retry = retryNursingAssessment(first.token, scope, false)!; expect(retry.body).toBe(first.body); expect(retry.everUnknown).toBe(true); expect(retry.authorityEpoch).toBeGreaterThan(first.authorityEpoch);
  });
  it("safe logout erases clinical payload and old replies cannot release a new actor's lease", () => {
    const old = begin(); const privacy = getNursingAssessmentPending().privacyEpoch; clearNursingAssessmentPendingOnLogout();
    const nextContext = { ...context, userId: uuid(99) }, nextScope = { ...scope, userId: uuid(99) };
    observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature(nextContext));
    expect(beginNursingAssessment(nextScope, false, input(), new Date().toISOString())).toBeNull();
    vi.setSystemTime(Date.now() + 1); expect(admit(nextScope, nextContext)).toBe(true);
    const next = beginNursingAssessment({ ...scope, userId: uuid(99) }, false, input(), new Date().toISOString())!;
    expect(next).not.toBeNull(); expect(getNursingAssessmentPending().privacyEpoch).toBeGreaterThan(privacy);
    expect(settleNursingAssessment(old, receipt())).toBe(false); expect(getNursingAssessmentPending().operation).toBe(next); expect(hasPendingOperations()).toBe(true);
  });
  it("rolls back only its own operation and lease if shared guard installation fails", () => {
    guardFault.fail = true; expect(() => begin()).toThrow("synthetic guard");
    expect(getNursingAssessmentPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(false);
    guardFault.fail = false; const held = tryAcquirePendingOperation()!; clearNursingAssessmentPendingOnLogout(); expect(hasPendingOperations()).toBe(true); held();
  });
  it.each(["clientId", "assessmentKey", "versionId", "contentHash", "version", "state"] as const)("rejects wrong %s predecessor before acquiring a lease", (field) => {
    const proof = target(); const altered = { ...proof, [field]: field === "version" ? 7 : field === "contentHash" ? "f".repeat(64) : field === "state" ? "signed" : uuid(999) } as NursingAssessmentTarget;
    expect(() => beginNursingAssessment(scope, false, input("revise_draft"), new Date().toISOString(), altered)).toThrow(); expect(hasPendingOperations()).toBe(false);
  });
  it("requires exact predecessor for existing writes and forbids a predecessor on create", () => {
    expect(() => beginNursingAssessment(scope, false, input("sign"), new Date().toISOString())).toThrow();
    expect(() => beginNursingAssessment(scope, false, input(), new Date().toISOString(), target())).toThrow(); expect(hasPendingOperations()).toBe(false);
  });
  it.each(["actorUserId", "organizationId", "branchId", "idempotencyKey"] as const)("rejects a mismatched successful %s without unlocking", (field) => {
    const first = begin(); expect(() => settleNursingAssessment(first, { ...receipt(), [field]: uuid(999) })).toThrow();
    expect(getNursingAssessmentPending().operation).toBe(first); expect(hasPendingOperations()).toBe(true);
  });
  it("rejects changed sign content and reused source version ID, but not a legitimate new signature hash", () => {
    const value = input("sign"); const first = begin("sign"); const saved = receipt(value);
    const changed = structuredClone(saved); changed.result.content.domains.observations.detail = "錯誤的簽署內容";
    expect(() => settleNursingAssessment(first, changed)).toThrow("INVALID_NURSING_RECEIPT_SOURCE_BINDING");
    expect(() => settleNursingAssessment(first, { ...saved, result: { ...saved.result, versionId: target().versionId } })).toThrow();
    expect(settleNursingAssessment(first, saved)).toBe(true); expect(saved.result.contentHash).not.toBe(target().contentHash); expect(hasPendingOperations()).toBe(false);
  });
  it("keeps its confirmed guard after absent, stale, truncated, foreign and wrong-chain snapshots", () => {
    const first = begin(); const saved = receipt(); settleNursingAssessment(first, saved); const fresh = snapshotWith(saved);
    expect(begin()).toBeNull();
    for (const candidate of [{ ...fresh, clients: [], clientTotal: 0 }, { ...fresh, clientsTruncated: true },
      { ...fresh, staleAfter: new Date(Date.now() - 1).toISOString() }, { ...fresh, branchId: uuid(99) },
      { ...fresh, clients: fresh.clients.map((client) => ({ ...client, versions: [], versionsTotal: 0 })) }]) {
      reconcileNursingAssessmentConfirmed(scope, candidate, Date.now()); expect(getNursingAssessmentPending().confirmed).toHaveLength(1);
    }
    reconcileNursingAssessmentConfirmed({ ...scope, userId: uuid(99) }, fresh, Date.now()); expect(getNursingAssessmentPending().confirmed).toHaveLength(1);
    reconcileNursingAssessmentConfirmed(scope, fresh, Date.now()); expect(getNursingAssessmentPending().confirmed).toHaveLength(0); expect(begin()).not.toBeNull();
  });
  it("only accepts a complete same-chain signed version, not refresh intent or an old source snapshot", () => {
    const first = begin("sign"); const saved = receipt(input("sign")); settleNursingAssessment(first, saved);
    const old = { ...buildDemoNursingAssessmentSnapshot(scope.organizationId, scope.branchId), demo: false };
    reconcileNursingAssessmentConfirmed(scope, old, Date.now()); expect(getNursingAssessmentPending().confirmed).toHaveLength(1);
    reconcileNursingAssessmentConfirmed(scope, snapshotWith(saved), Date.now()); expect(getNursingAssessmentPending().confirmed).toHaveLength(0);
  });
  it("blocks only a confirmed client's stale next write, so another assigned client can still work", () => {
    const first = begin(); settleNursingAssessment(first, receipt()); expect(begin()).toBeNull(); expect(begin("sign")).not.toBeNull();
  });
  it("has a bounded 32-marker cap and never silently drops stale source protection", () => {
    const base = buildDemoNursingAssessmentSnapshot(scope.organizationId, scope.branchId);
    const allClients = { ...base, demo: false, clients: Array.from({ length: 32 }, (_, index) => ({ ...base.clients[1]!, clientId: uuid(1001 + index) })), clientTotal: 32 };
    expect(observeNursingAssessmentSnapshot(scope, false, allClients, { canManage: true, canSign: true, hasRecentAal2: true })).toBe(false);
    vi.setSystemTime(Date.now() + 1); allClients.generatedAt = new Date().toISOString(); allClients.staleAfter = new Date(Date.now() + 300000).toISOString();
    expect(observeNursingAssessmentSnapshot(scope, false, allClients, { canManage: true, canSign: true, hasRecentAal2: true })).toBe(true);
    for (let i = 1; i <= 32; i++) {
      const value = input("create_draft", i); value.request.clientId = uuid(1000 + i);
      const first = beginNursingAssessment(scope, false, value, new Date().toISOString())!; expect(first).not.toBeNull(); settleNursingAssessment(first, receipt(value, i));
    }
    expect(getNursingAssessmentPending().confirmed).toHaveLength(32); expect(begin()).toBeNull(); expect(hasPendingOperations()).toBe(false);
  });
  it("shared navigation blocks same-tab departures but permits its own form submit and safe logout can clear", () => {
    const first = begin(); settleNursingAssessment(first, "unknown");
    document.body.innerHTML = '<a href="https://company.example.invalid/">公司入口</a><form data-nursing-assessment-form method="post"></form><form method="get"></form>';
    const leave = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }); document.querySelector("a")!.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true); expect(getNursingAssessmentPending().navigationBlocked).toBe(true);
    const own = new Event("submit", { bubbles: true, cancelable: true }); document.querySelector("form")!.dispatchEvent(own); expect(own.defaultPrevented).toBe(false);
    const get = new Event("submit", { bubbles: true, cancelable: true }); document.querySelectorAll("form")[1].dispatchEvent(get); expect(get.defaultPrevented).toBe(true);
    clearNursingAssessmentPendingOnLogout(); expect(hasPendingOperations()).toBe(false);
  });
  it("classifies only exact safe first-denial envelopes, not arbitrary 4xx text or malformed success", () => {
    const raw = { requestId: uuid(900), status: "error", data: null, errors: [{ code: "NURSING_NOT_AUTHORIZED", message: "目前授權未通過" }] };
    expect(isConfirmedNursingAssessmentRejection(raw, 403)).toBe(true); expect(isConfirmedNursingAssessmentRejection(raw, 409)).toBe(false);
    expect(isConfirmedNursingAssessmentRejection({ ...raw, data: {} }, 403)).toBe(false); expect(isConfirmedNursingAssessmentRejection({ error: "403" }, 403)).toBe(false);
  });
});
