// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCareRequestOwner } from "./use-care-request-owner";

afterEach(cleanup);
describe("daily form visible-scope request owner", () => {
  it("does not cancel on a same-scope render and releases only the finished request", () => {
    const changed = vi.fn();
    const view = renderHook(({ scope }) => useCareRequestOwner(scope, changed), { initialProps: { scope: "person-a" } });
    const first = view.result.current.begin();
    const second = view.result.current.begin();
    first.finish();
    view.rerender({ scope: "person-a" });
    expect(first.isCurrent()).toBe(true);
    expect(second.isCurrent()).toBe(true);
    expect(changed).not.toHaveBeenCalled();
    view.unmount();
    expect(first.signal.aborted).toBe(false);
    expect(first.isCurrent()).toBe(false);
    expect(second.signal.aborted).toBe(true);
  });
  it("invalidates capability ABA and cannot revive an old decode callback", () => {
    const changed = vi.fn();
    const view = renderHook(({ scope }) => useCareRequestOwner(scope, changed), { initialProps: { scope: "person-a:allowed" } });
    const request = view.result.current.begin();
    act(() => view.rerender({ scope: "person-a:denied" }));
    act(() => view.rerender({ scope: "person-a:allowed" }));
    expect(request.signal.aborted).toBe(true);
    expect(request.isCurrent()).toBe(false);
    expect(() => request.throwIfStale()).toThrow("作業範圍已更新。");
    expect(changed).toHaveBeenCalledTimes(2);
    expect(view.result.current.begin().isCurrent()).toBe(true);
  });
});
