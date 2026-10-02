// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginClaimValidation, clearClaimValidationPendingOnLogout, getClaimValidationPending,
  reconcileClaimValidationConfirmed, retryClaimValidation, settleClaimValidation } from "./claim-validation-pending";
import { hasPendingOperations, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";

const scope = { organizationId: "4A000000-0000-4000-8000-000000000001", branchId: "4A000000-0000-4000-8000-000000000002", userId: "4A000000-0000-4000-8000-000000000003" };
const batch = { id: "4A000000-0000-4000-8000-000000000004", itemCount: 2, totalAmount: "12.1", periodLabel: "合成九月" };
describe("tab-local claim operation journal", () => {
  beforeEach(() => { clearClaimValidationPendingOnLogout(); let count = 10;
    vi.stubGlobal("crypto", { randomUUID: () => `4a000000-0000-4000-8000-${String(count++).padStart(12, "0")}` }); });
  afterEach(() => { clearClaimValidationPendingOnLogout(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
  it("normalizes and freezes the complete financial operation", () => {
    const input = { ...batch }; const actor = { ...scope }; const operation = beginClaimValidation(actor, false, input)!;
    input.totalAmount = "999"; actor.userId = batch.id;
    expect(operation.scope.userId).toBe(scope.userId.toLowerCase()); expect(operation.batch.id).toBe(batch.id.toLowerCase());
    expect(operation.expected.totalAmount).toBe("12.10"); expect(Object.isFrozen(operation.expected)).toBe(true);
    expect(operation.body).toBe(JSON.stringify({ claim_batch_id: batch.id.toLowerCase(), expected_total_amount: "12.10", expected_item_count: 2 }));
    expect(beginClaimValidation(scope, false, batch)).toBeNull(); expect(hasPendingOperations()).toBe(true);
  });
  it("keeps exactly one key and body across unknown retries and subsequent denials", () => {
    const original = beginClaimValidation(scope, false, batch)!; settleClaimValidation(original, "unknown");
    const retry = retryClaimValidation(original.token)!; expect(retry.body).toBe(original.body); expect(retry.expected).toBe(original.expected);
    expect(retryClaimValidation(original.token)).toBeNull(); settleClaimValidation(retry, "denied");
    expect(getClaimValidationPending().operation?.phase).toBe("unknown"); expect(hasPendingOperations()).toBe(true);
    expect(settleClaimValidation(original, "success")).toBe(false);
  });
  it("only first known rejection releases a lease", () => {
    const first = beginClaimValidation(scope, false, batch)!; settleClaimValidation(first, "denied");
    expect(hasPendingOperations()).toBe(false); expect(getClaimValidationPending().operation).toBeNull();
    const second = beginClaimValidation(scope, false, batch)!; expect(second.expected.idempotencyKey).not.toBe(first.expected.idempotencyKey);
  });
  it("marks confirmed real batches, rejects stale re-send, and only removes on authoritative draft absence", () => {
    const first = beginClaimValidation(scope, false, batch)!; settleClaimValidation(first, "success");
    expect(hasPendingOperations()).toBe(false); expect(beginClaimValidation(scope, false, batch)).toBeNull();
    reconcileClaimValidationConfirmed(scope, false, [batch.id]); expect(getClaimValidationPending().confirmed).toHaveLength(1);
    reconcileClaimValidationConfirmed({ ...scope, branchId: batch.id }, false, []); expect(getClaimValidationPending().confirmed).toHaveLength(1);
    reconcileClaimValidationConfirmed(scope, false, []); expect(getClaimValidationPending().confirmed).toHaveLength(0);
    expect(beginClaimValidation(scope, false, batch)).not.toBeNull();
  });
  it("does not turn demo validation into a persisted marker", () => {
    const first = beginClaimValidation(scope, true, batch)!; settleClaimValidation(first, "success");
    expect(getClaimValidationPending().confirmed).toHaveLength(0);
  });
  it("does not acquire a write while another view transition is pending", () => {
    const release = tryAcquireViewTransition()!; expect(beginClaimValidation(scope, false, batch)).toBeNull(); release();
    expect(beginClaimValidation(scope, false, batch)).not.toBeNull();
  });
  it("does not create a key or release another journal's pending operation", () => {
    const releaseOther = tryAcquirePendingOperation()!; const random = vi.spyOn(crypto, "randomUUID");
    try {
      expect(beginClaimValidation(scope, false, batch)).toBeNull();
      expect(random).not.toHaveBeenCalled(); expect(getClaimValidationPending().operation).toBeNull();
      clearClaimValidationPendingOnLogout(); expect(hasPendingOperations()).toBe(true);
    } finally { releaseOther(); random.mockRestore(); }
    expect(beginClaimValidation(scope, false, batch)).not.toBeNull();
  });
  it("explicit logout invalidates old callbacks, which cannot release or mutate a later operation", () => {
    const first = beginClaimValidation(scope, false, batch)!; clearClaimValidationPendingOnLogout();
    const next = beginClaimValidation(scope, false, batch)!; expect(settleClaimValidation(first, "success")).toBe(false);
    expect(settleClaimValidation(first, "unknown")).toBe(false);
    expect(getClaimValidationPending().operation?.token).toBe(next.token); expect(hasPendingOperations()).toBe(true);
  });
  it.each(["/app/clients", "https://finance.suiyuecare.com", "https://finance.suiyuecare.com/company"])("blocks ordinary same-tab HTTP link %s across composers", (url) => {
    const operation = beginClaimValidation(scope, false, batch)!; settleClaimValidation(operation, "unknown");
    const link = document.createElement("a"); link.href = url; document.body.append(link);
    const event = new MouseEvent("click", { button: 0, bubbles: true, cancelable: true }); link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(getClaimValidationPending().navigationBlocked).toBe(true);
  });
  it.each(["_blank", "named-preview"])("allows nondeparting tab link target %s", (target) => {
    beginClaimValidation(scope, false, batch);
    const link = document.createElement("a"); link.href = "https://finance.suiyuecare.com"; link.target = target; document.body.append(link);
    const event = new MouseEvent("click", { button: 0, bubbles: true, cancelable: true }); link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
  it("respects form submitter overrides, not just the form target", () => {
    beginClaimValidation(scope, false, batch);
    const form = document.createElement("form"); form.target = "_blank"; form.action = "/safe-preview";
    const submitter = document.createElement("button"); submitter.setAttribute("formtarget", "_self"); submitter.setAttribute("formaction", "https://finance.suiyuecare.com");
    form.append(submitter); document.body.append(form);
    const event = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter }); form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
  it("does not exempt a cross-origin download link that a browser may navigate", () => {
    beginClaimValidation(scope, false, batch);
    const link = document.createElement("a"); link.href = "https://finance.suiyuecare.com/file"; link.download = "report.pdf"; document.body.append(link);
    const event = new MouseEvent("click", { button: 0, bubbles: true, cancelable: true }); link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
  it("honors a base target while an explicit empty formtarget still means the current tab", () => {
    beginClaimValidation(scope, false, batch);
    const base = document.createElement("base"); base.target = "_blank"; document.head.append(base);
    try {
      const link = document.createElement("a"); link.href = "https://finance.suiyuecare.com"; document.body.append(link);
      const click = new MouseEvent("click", { button: 0, bubbles: true, cancelable: true }); link.dispatchEvent(click); expect(click.defaultPrevented).toBe(false);
      const form = document.createElement("form"); form.action = "/current-tab";
      const button = document.createElement("button"); button.setAttribute("formtarget", ""); form.append(button); document.body.append(form);
      const submit = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }); form.dispatchEvent(submit);
      expect(submit.defaultPrevented).toBe(true);
    } finally { base.remove(); }
  });
  it("leaves claim app-owned retry forms to their validated React handler", () => {
    beginClaimValidation(scope, false, batch);
    const form = document.createElement("form"); form.setAttribute("data-claim-validation-form", ""); document.body.append(form);
    const event = new SubmitEvent("submit", { bubbles: true, cancelable: true }); form.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  });
  it("adds only an honest hard-unload warning and removes it on explicit logout", () => {
    beginClaimValidation(scope, false, batch);
    const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    clearClaimValidationPendingOnLogout(); const next = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
  });
  it("fails closed on invalid scope or request before acquiring a lease", () => {
    expect(() => beginClaimValidation({ ...scope, userId: "invalid" }, false, batch)).toThrow();
    expect(() => beginClaimValidation(scope, false, { ...batch, itemCount: 0 })).toThrow(); expect(hasPendingOperations()).toBe(false);
  });
  it("rolls back an owned lease and partial guards if installation throws", () => {
    const add = vi.spyOn(window, "addEventListener").mockImplementationOnce(() => { throw new Error("synthetic-install-failure"); });
    expect(() => beginClaimValidation(scope, false, batch)).toThrow("synthetic-install-failure"); add.mockRestore();
    expect(getClaimValidationPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(false);
    const link = document.createElement("a"); link.href = "https://finance.suiyuecare.com"; document.body.append(link);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true }); link.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    expect(beginClaimValidation(scope, false, batch)).not.toBeNull();
  });
  it("does not touch local/session storage or replace/push history", () => {
    const local = vi.spyOn(Storage.prototype, "setItem"); const push = vi.spyOn(history, "pushState"); const replace = vi.spyOn(history, "replaceState");
    const first = beginClaimValidation(scope, false, batch)!; settleClaimValidation(first, "unknown"); retryClaimValidation(first.token); clearClaimValidationPendingOnLogout();
    expect(local).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
    local.mockRestore(); push.mockRestore(); replace.mockRestore();
  });
});
