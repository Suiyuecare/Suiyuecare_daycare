// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { hasPendingOperations, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { buildDemoReferralManagementSnapshot } from "./demo";
import { parseReferralManagementApiSuccess, parseReferralManagementMutation } from "./parser";
import type { ReferralAction, ReferralManagementItem, ReferralManagementMutationInput, ReferralManagementSnapshot } from "./types";
import { beginReferral, clearReferralPendingOnLogout, getReferralPending, getReferralSnapshotAdmission, isConfirmedReferralRejection, observeReferralAuthority,
  observeReferralSnapshot, reconcileReferralConfirmed, referralAuthoritySignature, referralRequestBody, referralScopeIdentity,
  retryReferral, settleReferral } from "./pending";

const guardFault = vi.hoisted(() => ({ fail: false }));
const interleave = vi.hoisted(() => ({ run: null as (() => void) | null }));
vi.mock("@/lib/navigation/pending-operation-lock", async (original) => {
  const actual = await original<typeof import("@/lib/navigation/pending-operation-lock")>();
  return { ...actual, tryAcquirePendingOperation: () => { const lease = actual.tryAcquirePendingOperation();
    if (lease && interleave.run) { const run = interleave.run; interleave.run = null; run(); } return lease; } };
});
vi.mock("@/lib/navigation/pending-navigation-guard", async (original) => {
  const actual = await original<typeof import("@/lib/navigation/pending-navigation-guard")>();
  return { ...actual, installPendingNavigationGuard: (options: Parameters<typeof actual.installPendingNavigationGuard>[0]) => {
    if (guardFault.fail) throw new Error("synthetic guard fault"); return actual.installPendingNavigationGuard(options); } };
});
const uuid = (n: number) => `39000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { organizationId: uuid(80), branchId: uuid(81), userId: uuid(82) };
const context: TenantContext = { ...scope, organizationName: "合成機構", branchName: "合成分支", displayName: "合成社工",
  roles: ["case_manager_social_worker"], scopes: ["clients.read", "referral_management.read", ...["create", "submit", "receive", "respond", "close", "correct"].map((value) => `referral_management.${value}`)],
  assuranceLevel: "aal2", recentAal2At: null, demo: false };
function snapshot(): ReferralManagementSnapshot {
  return { ...buildDemoReferralManagementSnapshot({ ...scope, filters: { clientId: null, receivingUnitMode: "all", receivingUnitCode: null,
    status: "all", recentFrom: null, recentTo: null, query: "" } }), demo: false,
    canCreate: true, canSubmit: true, canRegisterReceipt: true, canRespond: true, canClose: true, canCorrect: true };
}
let view: ReferralManagementSnapshot;
let testTime = Date.parse("2026-09-26T11:00:00.000Z");
function observe(value = view) { observeReferralSnapshot(scope, false, value); }
function input(action: ReferralAction = "create", source?: ReferralManagementItem, n = 1): ReferralManagementMutationInput {
  const body = action === "create" ? { action, clientId: view.clientOptions[0]!.clientId,
    receivingUnitState: "manual_unstandardized", receivingUnitCode: "SYNTHETIC", receivingUnitName: "合成院所",
    referralDate: "2026-09-26T08:00:00+08:00", referralReason: "合成轉介原因" }
    : { action, referralKey: source!.referralKey, previousEventId: source!.eventId, expectedSequence: source!.sequence,
      ...(action === "submit" ? {} : { entryContent: "合成處理內容" }),
      ...(action === "correct" ? { correctsEventId: source!.history.at(-1)!.eventId, correctionReason: "合成更正理由" } : {}) };
  return parseReferralManagementMutation(body, uuid(100 + n));
}
function receipt(value: ReferralManagementMutationInput, source?: ReferralManagementItem, n = 1) {
  const kind = { create: "created", submit: "submitted", register_received: "receipt_registered", respond: "response_recorded", close: "closed", correct: "corrected" } as const;
  const status = { create: "draft", submit: "submitted", register_received: "received", respond: "responded", close: "closed", correct: source?.status ?? "draft" } as const;
  return parseReferralManagementApiSuccess({ requestId: uuid(900 + n), status: "ok", errors: [], data: {
    organizationId: scope.organizationId, branchId: scope.branchId, operationId: uuid(200 + n), operationKind: value.action,
    referralKey: value.referralKey ?? uuid(300 + n), eventId: uuid(400 + n), eventSequence: (value.expectedSequence ?? 0) + 1,
    previousEventId: value.previousEventId, eventKind: kind[value.action], referralStatus: status[value.action],
    receivingUnitState: value.receivingUnitState ?? source!.receivingUnitState, notificationCount: 1,
    notificationQueueStatus: "queued", notificationProviderStatus: "not_configured", externalDeliveryStatus: "not_configured",
    deliveryClaim: "no_external_delivery_claim", attachmentStatus: "not_configured", exportStatus: "not_configured",
    committedAt: new Date().toISOString(), replayed: false, persisted: true, demo: false,
  } }, value, scope.organizationId, scope.branchId, 201);
}
function begin() { return beginReferral(scope, false, input(), view.generatedAt)!; }
function withItems(items: ReferralManagementItem[], base = view): ReferralManagementSnapshot {
  return { ...base, items, metrics: { matching: items.length, draft: items.filter((item) => item.status === "draft").length,
    submitted: items.filter((item) => item.status === "submitted").length, received: items.filter((item) => item.status === "received").length,
    responded: items.filter((item) => item.status === "responded").length, closed: items.filter((item) => item.status === "closed").length,
    unitMissing: items.filter((item) => item.receivingUnitState === "missing").length, unitNotApplicable: items.filter((item) => item.receivingUnitState === "not_applicable").length } };
}
function savedSnapshot(value: ReturnType<typeof receipt>, request: ReferralManagementMutationInput) {
  const result = value.data;
  const source = request.action === "create" ? view.items[0]! : view.items.find((item) => item.referralKey === request.referralKey)!;
  const event = { ...source.history[0]!, eventId: result.eventId, sequence: result.eventSequence, eventKind: result.eventKind,
    correctsEventId: request.correctsEventId, entryContent: request.entryContent, correctionReason: request.correctionReason,
    status: result.referralStatus, occurredAt: result.committedAt };
  const item: ReferralManagementItem = { ...source, eventId: result.eventId, referralKey: result.referralKey, sequence: result.eventSequence,
    previousEventId: result.previousEventId, correctsEventId: request.correctsEventId, eventKind: result.eventKind,
    clientId: request.clientId ?? source.clientId, receivingUnitState: result.receivingUnitState,
    receivingUnitCode: request.receivingUnitCode ?? source.receivingUnitCode, receivingUnitName: request.receivingUnitName ?? source.receivingUnitName,
    entryContent: request.entryContent, correctionReason: request.correctionReason, status: result.referralStatus,
    occurredAt: result.committedAt, history: [event, ...(request.action === "create" ? [] : source.history)] };
  return withItems([item, ...view.items.filter((old) => old.referralKey !== item.referralKey)]);
}
beforeEach(() => {
  vi.useFakeTimers(); testTime += 120_000; vi.setSystemTime(new Date(testTime)); clearReferralPendingOnLogout();
  observeReferralAuthority(referralAuthoritySignature(context)); view = snapshot(); observe();
});
afterEach(() => { guardFault.fail = false; interleave.run = null; clearReferralPendingOnLogout(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.useRealTimers(); });

describe("immutable tab-local referral journal", () => {
  it("normalizes actor/key, freezes exact wire body and retains it across owner remount/unknown retry", () => {
    const value = input(); value.idempotencyKey = value.idempotencyKey.toUpperCase();
    const first = beginReferral({ ...scope, organizationId: scope.organizationId.toUpperCase() }, false, value, view.generatedAt)!;
    value.referralReason = "改動後的內容";
    expect(Object.isFrozen(first.input)).toBe(true); expect(first.identity).toBe(referralScopeIdentity(scope, false));
    expect(JSON.parse(first.body)).toEqual(referralRequestBody(first.input)); expect(first.body).not.toContain("改動");
    settleReferral(first, "unknown"); const next = retryReferral(first.token, scope, false)!;
    expect(next.token).toBe(first.token); expect(next.attempt).not.toBe(first.attempt); expect(next.body).toBe(first.body); expect(next.input.idempotencyKey).toBe(uuid(101));
  });
  it("deep freezes full existing source and correction history", () => {
    const source = view.items[2]!; const value = input("correct", source);
    const first = beginReferral(scope, false, value, view.generatedAt, source)!;
    expect(Object.isFrozen(first.target!.history[0])).toBe(true); expect(first.target!.history.at(-1)!.eventId).toBe(value.correctsEventId);
  });
  it("keeps unknown body/key/lease after any later known rejection", () => {
    const first = begin(); settleReferral(first, "unknown"); const next = retryReferral(first.token, scope, false)!;
    expect(settleReferral(next, "denied")).toBe(true); expect(getReferralPending().operation?.phase).toBe("unknown");
    expect(getReferralPending().operation?.body).toBe(first.body); expect(hasPendingOperations()).toBe(true); expect(begin()).toBeNull();
  });
  it("releases only a positively known first denial", () => {
    expect(settleReferral(begin(), "denied")).toBe(true); expect(getReferralPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(false);
  });
  it("does not automatically POST or expire an unknown request's manual retry solely from snapshot age", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const first = begin(); settleReferral(first, "unknown");
    vi.advanceTimersByTime(90_000); const next = retryReferral(first.token, scope, false)!;
    expect(next.body).toBe(first.body); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it("denies fresh writes after snapshot expiry or with a mismatched snapshot timestamp", () => {
    expect(beginReferral(scope, false, input(), "2026-09-26T10:59:59Z")).toBeNull();
    vi.advanceTimersByTime(60_000); expect(begin()).toBeNull(); expect(hasPendingOperations()).toBe(false);
  });
  it("prevents concurrent composers and foreign shared/view leases", () => {
    const held = tryAcquirePendingOperation()!; expect(begin()).toBeNull(); expect(hasPendingOperations()).toBe(true); held();
    const viewLease = tryAcquireViewTransition()!; expect(begin()).toBeNull(); viewLease();
    const first = begin(); expect(begin()).toBeNull(); expect(settleReferral({ ...first }, "denied")).toBe(false);
  });
  it.each(["scope", "scope ABA", "logout", "capabilities ABA"])("rejects admission invalidated at the shared lease notification: %s", (kind) => {
    interleave.run = () => {
      if (kind === "logout") clearReferralPendingOnLogout();
      else if (kind === "capabilities ABA") { observe({ ...view, canCreate: false }); observe(); }
      else { observeReferralAuthority(referralAuthoritySignature({ ...context, branchId: uuid(999) }));
        if (kind === "scope ABA") { observeReferralAuthority(referralAuthoritySignature(context)); observe(); } }
    };
    expect(begin()).toBeNull(); expect(getReferralPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(false);
  });
  it.each(["organizationId", "branchId", "userId"] as const)("denies foreign %s begin/retry/observation", (field) => {
    const foreign = { ...scope, [field]: uuid(999) };
    expect(beginReferral(foreign, false, input(), view.generatedAt)).toBeNull();
    expect(observeReferralSnapshot(foreign, false, view)).toBe(false);
    const first = begin(); settleReferral(first, "unknown"); expect(retryReferral(first.token, foreign, false)).toBeNull();
  });
  it("handles demo authority without UUID validation but grants no writes", () => {
    observeReferralAuthority(referralAuthoritySignature({ ...context, organizationId: "demo-org", branchId: "demo-branch", userId: "demo-user", demo: true }));
    expect(beginReferral(scope, true, input(), view.generatedAt)).toBeNull();
    const before = getReferralPending().authoritySignature; expect(() => observeReferralAuthority("arbitrary")).toThrow(); expect(getReferralPending().authoritySignature).toBe(before);
  });
  it.each(["actor", "roles", "scope", "aal", "flags", "assignment"])("discards a late result after %s ABA and keeps exact manual recovery", (kind) => {
    const first = begin(); const saved = receipt(first.input);
    if (kind === "flags") { observe({ ...view, canCreate: false }); observe(); }
    else if (kind === "assignment") { observe({ ...view, clientOptions: view.clientOptions.slice(1) }); observe(); }
    else { const other = kind === "actor" ? { ...context, userId: uuid(999) } : kind === "roles" ? { ...context, roles: [] }
      : kind === "scope" ? { ...context, scopes: [] } : { ...context, assuranceLevel: "aal1" as const };
      observeReferralAuthority(referralAuthoritySignature(other)); observeReferralAuthority(referralAuthoritySignature(context));
      vi.advanceTimersByTime(1); view = snapshot(); observe(); }
    expect(settleReferral(first, saved)).toBe(false); expect(getReferralPending().operation?.phase).toBe("unknown");
    expect(retryReferral(first.token, scope, false)?.body).toBe(first.body);
  });
  it("does not invalidate an in-flight attempt when only labels/order or fresh generatedAt change", () => {
    const first = begin(); vi.advanceTimersByTime(1000);
    observe({ ...view, generatedAt: new Date().toISOString(), staleAfter: new Date(Date.now() + 60_000).toISOString(),
      clientOptions: [...view.clientOptions].reverse().map((client) => ({ ...client, displayName: "顯示名更新" })) });
    expect(getReferralPending().operation).toBe(first); expect(settleReferral(first, receipt(first.input))).toBe(true);
  });
  it("logout synchronously releases only its lease; old callbacks cannot settle a new actor operation", () => {
    const old = begin(); clearReferralPendingOnLogout(); observeReferralAuthority(referralAuthoritySignature({ ...context, userId: uuid(999) }));
    vi.advanceTimersByTime(1); view = snapshot();
    const newScope = { ...scope, userId: uuid(999) }; observeReferralSnapshot(newScope, false, view);
    const next = beginReferral(newScope, false, input(), view.generatedAt)!;
    expect(settleReferral(old, receipt(old.input))).toBe(false); expect(getReferralPending().operation).toBe(next); expect(hasPendingOperations()).toBe(true);
  });
  it("rolls back guard-registration failure without a phantom operation or lease", () => {
    guardFault.fail = true; expect(() => begin()).toThrow("synthetic guard fault"); expect(getReferralPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(false);
  });
  it("blocks same-tab cross-origin links and GET forms while retaining permitted recovery form", () => {
    begin(); const link = document.createElement("a"); link.href = "https://finance.suiyuecare.com"; document.body.append(link);
    expect(link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(false);
    const form = document.createElement("form"); form.action = "/app/staff/referrals"; document.body.append(form);
    expect(form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))).toBe(false);
    form.setAttribute("data-referral-management-form", ""); expect(form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))).toBe(true);
    expect(getReferralPending().navigationBlocked).toBe(true);
  });
});

describe("referral source/receipt and positive read evidence", () => {
  it.each(["key", "event", "sequence", "history", "status", "unit"])("rejects an altered source %s before acquiring a lease", (kind) => {
    const source = structuredClone(view.items[2]!); const value = input("correct", source);
    if (kind === "key") source.referralKey = uuid(999); else if (kind === "event") source.eventId = uuid(999);
    else if (kind === "sequence") source.sequence += 1; else if (kind === "history") value.correctsEventId = uuid(999);
    else if (kind === "status") source.status = "closed"; else source.receivingUnitState = "missing";
    expect(() => beginReferral(scope, false, value, view.generatedAt, source)).toThrow(); expect(hasPendingOperations()).toBe(false);
  });
  it("rejects submit with a missing unit and a transition from the wrong state", () => {
    const source = view.items[0]!; expect(() => beginReferral(scope, false, input("submit", source), view.generatedAt, source)).toThrow();
    expect(() => beginReferral(scope, false, input("close", source), view.generatedAt, source)).toThrow(); expect(hasPendingOperations()).toBe(false);
  });
  it.each(["same event", "unit", "correct status", "branch", "sequence", "malformed"])("keeps its lease on an invalid receipt: %s", (kind) => {
    const source = view.items[2]!; const first = beginReferral(scope, false, input("correct", source), view.generatedAt, source)!;
    const saved = receipt(first.input, source);
    if (kind === "same event") saved.data.eventId = source.eventId; else if (kind === "unit") saved.data.receivingUnitState = "missing";
    else if (kind === "correct status") saved.data.referralStatus = "closed"; else if (kind === "branch") saved.data.branchId = uuid(999);
    else if (kind === "sequence") saved.data.eventSequence += 1; else Object.assign(saved.data, { forged: true });
    expect(() => settleReferral(first, saved)).toThrow(); expect(getReferralPending().operation).toBe(first); expect(hasPendingOperations()).toBe(true);
    settleReferral(first, "unknown"); expect(getReferralPending().operation?.phase).toBe("unknown");
  });
  it("correlated success releases write lease but blocks new stale-source work until exact positive same-chain event", () => {
    const first = begin(); const saved = receipt(first.input); settleReferral(first, saved);
    expect(hasPendingOperations()).toBe(false); expect(begin()).toBeNull(); expect(getReferralPending().confirmed).toHaveLength(1);
    reconcileReferralConfirmed(scope, withItems([]), Date.now()); expect(getReferralPending().confirmed).toHaveLength(1);
    const fresh = savedSnapshot(saved, first.input); reconcileReferralConfirmed(scope, fresh, Date.now());
    expect(getReferralPending().confirmed).toHaveLength(0); expect(begin()).not.toBeNull();
  });
  it.each(["client", "chain", "event", "time", "stale", "future", "demo"])("does not clear markers from %s evidence", (kind) => {
    const first = begin(); const saved = receipt(first.input); settleReferral(first, saved); const fresh = savedSnapshot(saved, first.input);
    const item = fresh.items[0]!;
    if (kind === "client") item.clientId = view.clientOptions[1]!.clientId; else if (kind === "chain") item.referralKey = uuid(999);
    else if (kind === "event") { item.eventId = uuid(999); item.history[0]!.eventId = uuid(999); }
    else if (kind === "time") item.history[0]!.occurredAt = "2026-09-26T10:59:59.000Z";
    else if (kind === "stale") vi.advanceTimersByTime(60_000);
    else if (kind === "future") { fresh.generatedAt = new Date(Date.now() + 1000).toISOString(); fresh.staleAfter = new Date(Date.now() + 61_000).toISOString(); }
    else fresh.demo = true;
    reconcileReferralConfirmed(scope, fresh, Date.now()); expect(getReferralPending().confirmed).toHaveLength(1);
  });
  it("accepts exact historical event in a newer same-chain head rather than treating mere greater sequence as proof", () => {
    const source = view.items[2]!; const first = beginReferral(scope, false, input("register_received", source), view.generatedAt, source)!;
    const saved = receipt(first.input, source); settleReferral(first, saved); const fresh = savedSnapshot(saved, first.input);
    const item = fresh.items[0]!; const historical = item.history[0]!;
    Object.assign(item, { eventId: uuid(999), previousEventId: historical.eventId, sequence: historical.sequence + 1, status: "responded", eventKind: "response_recorded" });
    item.history = [{ ...historical, eventId: uuid(999), sequence: item.sequence, status: "responded", eventKind: "response_recorded" }, ...item.history];
    const adjusted = withItems([...fresh.items], fresh); reconcileReferralConfirmed(scope, adjusted, Date.now()); expect(getReferralPending().confirmed).toHaveLength(0);
  });
  it("bounds retained confirmations at32 across distinct clients without discarding unresolved proof", () => {
    for (let index = 0; index < 32; index++) {
      const clientId = uuid(1000 + index); view = { ...view, clientOptions: [...view.clientOptions, { clientId, displayName: "合成個案", clientCode: `S${index}` }] }; observe();
      const value = { ...input("create", undefined, index + 1), clientId }; const first = beginReferral(scope, false, value, view.generatedAt)!;
      expect(first).not.toBeNull(); settleReferral(first, receipt(first.input, undefined, index + 1));
    }
    expect(getReferralPending().confirmed).toHaveLength(32); expect(begin()).toBeNull(); expect(hasPendingOperations()).toBe(false);
  });
  it.each([null, "<html>offline</html>", {}, { status: "error", errors: [] }])("malformed rejection %j stays unknown", (value) => {
    expect(isConfirmedReferralRejection(value, 403)).toBe(false);
  });
  it("distinguishes known first rejection from generic SAVE_FAILED409 uncertainty", () => {
    const error = (code: string) => ({ requestId: uuid(900), status: "error", data: null, errors: [{ code, message: "合成錯誤" }] });
    expect(isConfirmedReferralRejection(error("REFERRAL_MANAGEMENT_SEQUENCE_CONFLICT"), 409)).toBe(true);
    expect(isConfirmedReferralRejection(error("REFERRAL_MANAGEMENT_NOT_AUTHORIZED"), 403)).toBe(true);
    expect(isConfirmedReferralRejection(error("REFERRAL_MANAGEMENT_SAVE_FAILED"), 409)).toBe(false);
    expect(isConfirmedReferralRejection(error("REFERRAL_MANAGEMENT_NOT_AUTHORIZED"), 500)).toBe(false);
  });
});

describe("data-free source generation floor across privacy boundaries", () => {
  it.each(["actor", "branch", "organization", "demo", "read", "aal"])("retains %s ABA floor across provider remount and requires newer authorized source", (kind) => {
    const old = view.generatedAt; const first = begin(); settleReferral(first, "unknown");
    const other = kind === "actor" ? { ...context, userId: uuid(999) } : kind === "branch" ? { ...context, branchId: uuid(999) }
      : kind === "organization" ? { ...context, organizationId: uuid(999) } : kind === "demo" ? { ...context, demo: true }
        : kind === "read" ? { ...context, scopes: context.scopes.filter((scope) => scope !== "referral_management.read") }
          : { ...context, assuranceLevel: "aal1" as const };
    observeReferralAuthority(referralAuthoritySignature(other)); observeReferralAuthority(referralAuthoritySignature(context));
    expect(getReferralPending().snapshotFloor).toBe(old);
    // Reobserving the old RSC props from a new provider must not re-admit them.
    expect(observeReferralSnapshot(scope, false, structuredClone(view))).toBe(false);
    expect(retryReferral(first.token, scope, false)).toBeNull(); expect(getReferralPending().operation?.body).toBe(first.body);
    expect(hasPendingOperations()).toBe(true);
    vi.advanceTimersByTime(1); view = snapshot(); expect(observeReferralSnapshot(scope, false, view)).toBe(true);
    expect(getReferralPending().snapshotFloor).toBeNull(); expect(retryReferral(first.token, scope, false)?.input.idempotencyKey).toBe(first.input.idempotencyKey);
  });
  it("keeps a data-free logout floor while deleting body/key/markers/authority and its write lease", () => {
    const old = view.generatedAt; begin(); clearReferralPendingOnLogout();
    expect(getReferralPending().snapshotFloor).toBe(old); expect(getReferralPending().operation).toBeNull();
    expect(getReferralPending().confirmed).toHaveLength(0); expect(getReferralPending().authoritySignature).toBeNull(); expect(hasPendingOperations()).toBe(false);
    observeReferralAuthority(referralAuthoritySignature(context)); expect(observeReferralSnapshot(scope, false, view)).toBe(false);
    vi.advanceTimersByTime(1); view = snapshot(); observe(); expect(begin()).not.toBeNull();
  });
  it("does not impose a new privacy floor on manage-only permission/role changes", () => {
    observeReferralAuthority(referralAuthoritySignature({ ...context, roles: [...context.roles, "organization_manager"],
      scopes: context.scopes.filter((scope) => scope !== "referral_management.create") }));
    expect(getReferralPending().snapshotFloor).toBeNull(); expect(observeReferralSnapshot(scope, false, { ...view, canCreate: false })).toBe(true);
    observeReferralAuthority(referralAuthoritySignature(context)); expect(observeReferralSnapshot(scope, false, view)).toBe(true); expect(begin()).not.toBeNull();
  });
  it("rejects a regressed generation after newer admitted source without losing current permissions", () => {
    const old = structuredClone(view); vi.advanceTimersByTime(1); view = snapshot(); observe();
    expect(observeReferralSnapshot(scope, false, old)).toBe(false);
    expect(getReferralSnapshotAdmission(scope, false)).toBe(view.generatedAt); expect(begin()).not.toBeNull();
  });
  it("does not use pre-boundary positive history to clear a confirmed marker before newer authorized read", () => {
    const first = begin(); const saved = receipt(first.input); settleReferral(first, saved);
    const old = savedSnapshot(saved, first.input);
    observeReferralAuthority(referralAuthoritySignature({ ...context, userId: uuid(999) }));
    observeReferralAuthority(referralAuthoritySignature(context));
    reconcileReferralConfirmed(scope, old, Date.now()); expect(getReferralPending().confirmed).toHaveLength(1);
    vi.advanceTimersByTime(1); const fresh = { ...old, generatedAt: new Date().toISOString(), staleAfter: new Date(Date.now() + 60_000).toISOString() };
    expect(observeReferralSnapshot(scope, false, fresh)).toBe(true); reconcileReferralConfirmed(scope, fresh, Date.now());
    expect(getReferralPending().confirmed).toHaveLength(0);
  });
  it("exposes only a data-free current-identity watermark after a fresh proof clears the privacy floor", () => {
    const old = structuredClone(view); observeReferralAuthority(referralAuthoritySignature({ ...context, userId: uuid(999) }));
    observeReferralAuthority(referralAuthoritySignature(context));
    vi.advanceTimersByTime(1); view = snapshot(); observe(); expect(getReferralPending().snapshotFloor).toBeNull();
    // A new React owner can reject old supplied props synchronously, before its
    // layout observer runs, without receiving any previous user's source data.
    expect(Date.parse(old.generatedAt)).toBeLessThan(Date.parse(getReferralSnapshotAdmission(scope, false)!));
    expect(observeReferralSnapshot(scope, false, old)).toBe(false);
    expect(getReferralSnapshotAdmission({ ...scope, userId: uuid(999) }, false)).toBeNull();
    expect(getReferralSnapshotAdmission(scope, true)).toBeNull();
    clearReferralPendingOnLogout(); expect(getReferralSnapshotAdmission(scope, false)).toBeNull();
    expect(getReferralPending().acceptedSnapshotAt).toBe(view.generatedAt); expect(getReferralPending().operation).toBeNull();
  });
  it("retains the boundary watermark if a manage-only change already cleared the source admission", () => {
    const old = view.generatedAt;
    observeReferralAuthority(referralAuthoritySignature({ ...context, scopes: context.scopes.filter((scope) => scope !== "referral_management.create") }));
    expect(getReferralPending().snapshotFloor).toBeNull(); expect(getReferralSnapshotAdmission(scope, false)).toBe(old);
    observeReferralAuthority(referralAuthoritySignature({ ...context, userId: uuid(999) }));
    observeReferralAuthority(referralAuthoritySignature(context));
    expect(getReferralPending().snapshotFloor).toBe(old); expect(observeReferralSnapshot(scope, false, view)).toBe(false);
  });
  it("retains a strictly newer watermark when a snapshot temporarily becomes unavailable", () => {
    const old = structuredClone(view); vi.advanceTimersByTime(1); view = snapshot(); observe();
    expect(observeReferralSnapshot(scope, false, null)).toBe(true); expect(getReferralSnapshotAdmission(scope, false)).toBe(view.generatedAt);
    expect(observeReferralSnapshot(scope, false, old)).toBe(false); expect(getReferralSnapshotAdmission(scope, false)).toBe(view.generatedAt);
  });
});
