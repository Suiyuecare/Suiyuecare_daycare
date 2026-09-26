// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearUnsavedChangesOnLogout, mayDiscardUnsavedChanges, registerUnsavedChangesOwner,
  requestUnsavedExit, type UnsavedChangesOwner } from "./unsaved-changes";
import { tryAcquirePendingOperation, tryAcquireViewTransition } from "./pending-operation-lock";

let cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup) dispose(); cleanup = []; });
function owner(dirty = true): UnsavedChangesOwner {
  return { isDirty: () => dirty, requestDiscard: vi.fn(), onBlocked: vi.fn(), onInvalidate: vi.fn() };
}
function register(entry: UnsavedChangesOwner) { cleanup.push(registerUnsavedChangesOwner(entry)); return entry; }
describe("shared unsaved editor coordination", () => {
  it("does not run clean continuations itself or prompt unchanged owners", () => {
    const entry = register(owner(false)); const proceed = vi.fn();
    expect(requestUnsavedExit(proceed)).toBe(false); expect(proceed).not.toHaveBeenCalled();
    expect(entry.requestDiscard).not.toHaveBeenCalled();
  });
  it("routes one dirty editor to its own confirmation and preserves destination validation", () => {
    const entry = register(owner()); const proceed = vi.fn(); const valid = vi.fn(() => true);
    expect(requestUnsavedExit(proceed, valid)).toBe(true);
    expect(entry.requestDiscard).toHaveBeenCalledWith(proceed, valid); expect(proceed).not.toHaveBeenCalled();
    expect(mayDiscardUnsavedChanges(entry)).toBe(true);
  });
  it("fails closed for multiple dirty owners without selecting either draft to discard", () => {
    const a = register(owner()); const b = register(owner());
    expect(requestUnsavedExit(vi.fn())).toBe(true); expect(mayDiscardUnsavedChanges(a)).toBe(false);
    expect(a.requestDiscard).not.toHaveBeenCalled(); expect(b.requestDiscard).not.toHaveBeenCalled();
    expect(a.onBlocked).toHaveBeenCalledOnce(); expect(b.onBlocked).toHaveBeenCalledOnce();
  });
  it.each([tryAcquirePendingOperation, tryAcquireViewTransition])("never bypasses a pending write or view lease", (acquire) => {
    const entry = register(owner()); const release = acquire()!; cleanup.push(release);
    expect(requestUnsavedExit(vi.fn())).toBe(true); expect(mayDiscardUnsavedChanges(entry)).toBe(false);
    expect(entry.requestDiscard).not.toHaveBeenCalled(); expect(entry.onBlocked).toHaveBeenCalledOnce();
  });
  it("does not bypass an operation lease even when every editor is clean", () => {
    register(owner(false)); const release = tryAcquirePendingOperation()!; cleanup.push(release);
    expect(requestUnsavedExit(vi.fn())).toBe(true);
  });
  it("cleanup is token-safe and repeated disposal cannot remove another editor", () => {
    const first = owner(); const dispose = registerUnsavedChangesOwner(first); const second = register(owner());
    dispose(); dispose(); expect(requestUnsavedExit(vi.fn())).toBe(true);
    expect(first.requestDiscard).not.toHaveBeenCalled(); expect(second.requestDiscard).toHaveBeenCalledOnce();
  });
  it("logout invalidates every owner unconditionally, including after a broken consumer", () => {
    const first = register(owner()); const second = register(owner());
    vi.mocked(first.onInvalidate).mockImplementation(() => { throw new Error("synthetic consumer failure"); });
    clearUnsavedChangesOnLogout(); expect(first.onInvalidate).toHaveBeenCalledOnce(); expect(second.onInvalidate).toHaveBeenCalledOnce();
    expect(first.requestDiscard).not.toHaveBeenCalled(); expect(second.requestDiscard).not.toHaveBeenCalled();
    expect(requestUnsavedExit(vi.fn())).toBe(false);
  });
  it("logout detaches old owners before callbacks and token cleanup cannot remove a new reentrant owner", () => {
    const first = owner(); const disposeOld = registerUnsavedChangesOwner(first); cleanup.push(disposeOld);
    const next = owner(); vi.mocked(first.onInvalidate).mockImplementation(() => { register(next); });
    clearUnsavedChangesOnLogout(); disposeOld(); disposeOld();
    expect(requestUnsavedExit(vi.fn())).toBe(true); expect(next.requestDiscard).toHaveBeenCalledOnce();
    expect(first.requestDiscard).not.toHaveBeenCalled(); expect(mayDiscardUnsavedChanges(first)).toBe(false);
  });
});
