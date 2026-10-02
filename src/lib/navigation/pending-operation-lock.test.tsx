// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquirePendingRecoveryRead, tryAcquireViewTransition, usePendingOperations, useViewTransitionPending } from "./pending-operation-lock";

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
    expect(tryAcquirePendingRecoveryRead()).toBeNull();
  });
  it("holds exactly its own write during a mutually exclusive recovery read", () => {
    const own = remember(tryAcquirePendingOperation())!;
    const read = remember(tryAcquirePendingRecoveryRead(own))!;
    expect(read).not.toBeNull(); expect(hasPendingOperations()).toBe(true); expect(hasViewTransition()).toBe(true);
    expect(tryAcquirePendingOperation()).toBeNull(); expect(tryAcquireViewTransition()).toBeNull();
    expect(tryAcquirePendingRecoveryRead(own)).toBeNull();
    read(); expect(hasViewTransition()).toBe(false); expect(hasPendingOperations()).toBe(true);
    own(); expect(hasPendingOperations()).toBe(false);
  });
  it("rejects extra foreign owners, fabricated and already-released closures", () => {
    const own = remember(tryAcquirePendingOperation())!;
    const foreign = remember(tryAcquirePendingOperation())!;
    expect(tryAcquirePendingRecoveryRead(own)).toBeNull();
    foreign(); expect(tryAcquirePendingRecoveryRead(foreign)).toBeNull();
    expect(tryAcquirePendingRecoveryRead(() => own())).toBeNull();
    expect(tryAcquirePendingRecoveryRead()).toBeNull();
    const read = remember(tryAcquirePendingRecoveryRead(own))!; expect(read).not.toBeNull(); read(); own();
    expect(tryAcquirePendingRecoveryRead(own)).toBeNull();
  });
  it("an obsolete read release cannot unlock a newer read, including logout", () => {
    const own = remember(tryAcquirePendingOperation())!;
    const read = remember(tryAcquirePendingRecoveryRead(own))!;
    own(); expect(hasPendingOperations()).toBe(false); expect(tryAcquirePendingOperation()).toBeNull();
    read(); const newer = remember(tryAcquirePendingRecoveryRead())!;
    read(); expect(hasViewTransition()).toBe(true); expect(tryAcquirePendingOperation()).toBeNull(); newer();
  });
  it("ordinary recovery without a write uses the existing read exclusion fence", () => {
    const read = remember(tryAcquirePendingRecoveryRead())!;
    expect(read).not.toBeNull(); expect(hasPendingOperations()).toBe(false); expect(hasViewTransition()).toBe(true);
    expect(tryAcquirePendingOperation()).toBeNull(); read();
    expect(remember(tryAcquirePendingOperation())).not.toBeNull();
  });
});
