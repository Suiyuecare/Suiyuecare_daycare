// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquireViewTransition, usePendingOperations, useViewTransitionPending } from "./pending-operation-lock";

const releases: (() => void)[] = [];
function remember(release: (() => void) | null) { if (release) releases.push(release); return release; }
function Observer() { const writing = usePendingOperations(); const changingView = useViewTransitionPending(); return <p>{String(writing)}:{String(changingView)}</p>; }
afterEach(() => { cleanup(); for (const release of releases.splice(0)) release(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("tab-local operation/view coordinator", () => {
  it("synchronously excludes navigation until every independent operation is resolved", () => {
    render(<Observer />);
    let first: (() => void) | null = null; let second: (() => void) | null = null;
    act(() => { first = remember(tryAcquirePendingOperation()); second = remember(tryAcquirePendingOperation()); });
    expect(screen.getByText("true:false")).toBeTruthy();
    expect(tryAcquireViewTransition()).toBeNull();
    act(() => { first?.(); first?.(); });
    expect(hasPendingOperations()).toBe(true);
    act(() => second?.());
    expect(screen.getByText("false:false")).toBeTruthy();
    expect(remember(tryAcquireViewTransition())).not.toBeNull();
  });
  it("excludes writes and another transition when refresh acquired first", () => {
    const release = remember(tryAcquireViewTransition());
    expect(hasViewTransition()).toBe(true);
    expect(tryAcquirePendingOperation()).toBeNull();
    expect(tryAcquireViewTransition()).toBeNull();
    release?.();
    const next = remember(tryAcquireViewTransition());
    release?.(); // Old idempotent release must not release a newer owner.
    expect(tryAcquirePendingOperation()).toBeNull();
    next?.();
    expect(remember(tryAcquirePendingOperation())).not.toBeNull();
  });
  it("does not lose an unresolved operation when subscribers unmount", () => {
    const { unmount } = render(<Observer />);
    act(() => { remember(tryAcquirePendingOperation()); });
    unmount();
    expect(hasPendingOperations()).toBe(true);
    expect(tryAcquireViewTransition()).toBeNull();
    render(<Observer />);
    expect(screen.getByText("true:false")).toBeTruthy();
  });
  it("warns before a hard unload while any operation lease survives a route unmount", () => {
    const { unmount } = render(<Observer />);
    const first = remember(tryAcquirePendingOperation());
    const second = remember(tryAcquirePendingOperation());
    unmount();
    const whileBothPending = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(whileBothPending);
    expect(whileBothPending.defaultPrevented).toBe(true);
    first?.();
    const whileSecondPending = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(whileSecondPending);
    expect(whileSecondPending.defaultPrevented).toBe(true);
    second?.();
    const afterSettlement = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterSettlement);
    expect(afterSettlement.defaultPrevented).toBe(false);
  });
  it("has a deterministic empty SSR snapshot and never writes browser storage", () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    remember(tryAcquirePendingOperation());
    expect(renderToString(<Observer />)).toContain("false");
    expect(storage).not.toHaveBeenCalled();
  });
  it("cannot allocate request-global server state", () => {
    vi.stubGlobal("window", undefined);
    expect(tryAcquirePendingOperation()).toBeNull();
    expect(tryAcquireViewTransition()).toBeNull();
  });
});
