// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaipeiClock } from "./taipei-clock";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TaipeiClock", () => {
  it("updates Taipei time without rerendering its parent shell", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T00:00:00Z"));
    const parentRender = vi.fn();
    function Shell() {
      parentRender();
      return <header><TaipeiClock /></header>;
    }

    const { container, unmount } = render(<Shell />);
    const time = container.querySelector("time");
    expect(time?.textContent).toBe("08:00:00");
    expect(time?.getAttribute("aria-label")).toBe("台北時間 08:00:00");

    act(() => vi.advanceTimersByTime(1000));
    expect(time?.textContent).toBe("08:00:01");
    expect(parentRender).toHaveBeenCalledTimes(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
