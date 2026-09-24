// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
const mock = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
import { QualificationFreshness } from "./qualification-freshness";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-14T03:00:00Z")); mock.refresh.mockClear(); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("qualification freshness and offline boundaries", () => {
  it("renders deterministic Taipei timestamps in server and client without ICU whitespace", () => {
    const element = <QualificationFreshness generatedAt="2026-09-14T13:30:00Z" staleAfter="2026-09-14T13:35:00Z" />;
    expect(renderToString(element)).toContain("2026/09/14 21:30:00");
    render(element);
    expect(screen.getByRole("status").textContent).toContain("2026/09/14 21:30:00");
    expect(screen.getByRole("status").textContent).not.toMatch(/[\u2009\u202f]|晚上/);
  });
  it("marks the loaded snapshot stale after five minutes and refreshes through router", () => {
    render(<QualificationFreshness generatedAt="2026-09-14T03:00:00Z" staleAfter="2026-09-14T03:05:00Z" />);
    expect(screen.getByRole("status").textContent).not.toContain("已超過");
    act(() => vi.advanceTimersByTime(300_000));
    expect(screen.getByRole("status").textContent).toContain("已超過 5 分鐘");
    fireEvent.click(screen.getByRole("button", { name: "重新讀取" })); expect(mock.refresh).toHaveBeenCalledOnce();
  });
  it("disables refresh offline without treating cached rows as current", () => {
    render(<QualificationFreshness generatedAt="2026-09-14T03:00:00Z" staleAfter="2026-09-14T03:05:00Z" />);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    act(() => window.dispatchEvent(new Event("offline")));
    expect((screen.getByRole("button", { name: "重新讀取" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("目前離線");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event("online")));
    expect((screen.getByRole("button", { name: "重新讀取" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
