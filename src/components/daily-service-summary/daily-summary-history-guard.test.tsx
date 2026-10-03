// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DailySummaryHistoryGuard,
  installDailySummaryHistoryGuard,
} from "./daily-summary-history-guard";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

function restoredPageEvent(persisted: boolean) {
  const event = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: persisted });
  return event;
}

describe("Page 54 browser history guard", () => {
  it("conceals sensitive content synchronously on pagehide and leaves a neutral cover", () => {
    render(<DailySummaryHistoryGuard><p>個案姓名：測試個案</p></DailySummaryHistoryGuard>);
    const sensitive = screen.getByText("個案姓名：測試個案");
    const content = sensitive.parentElement!;
    const cover = screen.getByRole("status", { hidden: true });
    expect(cover).toHaveAttribute("hidden");

    window.dispatchEvent(new Event("pagehide"));

    expect(content).toHaveAttribute("inert");
    expect(content).toHaveAttribute("aria-hidden", "true");
    expect(content.style.getPropertyValue("display")).toBe("none");
    expect(content.style.getPropertyPriority("display")).toBe("important");
    expect(cover).not.toHaveAttribute("hidden");
    expect(cover).toHaveTextContent("正在重新驗證頁面");
    expect(cover).not.toHaveTextContent("測試個案");
  });

  it("keeps the restored bfcache snapshot concealed while requesting one reload", () => {
    const content = document.createElement("div");
    const cover = document.createElement("div");
    cover.hidden = true;
    const reload = vi.fn();
    const uninstall = installDailySummaryHistoryGuard(content, cover, reload);

    window.dispatchEvent(new Event("pagehide"));
    expect(content.style.display).toBe("none");
    expect(cover.hidden).toBe(false);
    window.dispatchEvent(restoredPageEvent(true));
    window.dispatchEvent(restoredPageEvent(true));

    expect(content).toHaveAttribute("aria-hidden", "true");
    expect(cover.hidden).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it("reloads a retained Page 54 subtree on popstate but ignores other routes", () => {
    const content = document.createElement("div");
    const cover = document.createElement("div");
    cover.hidden = true;
    const reload = vi.fn();
    const uninstall = installDailySummaryHistoryGuard(content, cover, reload);

    window.history.replaceState({}, "", "/app/staff/other");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(reload).not.toHaveBeenCalled();
    expect(cover.hidden).toBe(true);

    window.history.replaceState({}, "", "/app/staff/service-management/daily-summary?date=2026-10-03");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(content).toHaveAttribute("inert");
    expect(cover.hidden).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it("does not reload a non-persisted pageshow and removes listeners on teardown", () => {
    const content = document.createElement("div");
    const cover = document.createElement("div");
    cover.hidden = true;
    const reload = vi.fn();
    const uninstall = installDailySummaryHistoryGuard(content, cover, reload);

    window.dispatchEvent(restoredPageEvent(false));
    expect(reload).not.toHaveBeenCalled();
    uninstall();
    window.dispatchEvent(new Event("pagehide"));
    expect(cover.hidden).toBe(true);
  });

  it("keeps a previously covered page hidden even if restoration is not flagged persisted", () => {
    const content = document.createElement("div");
    const cover = document.createElement("div");
    cover.hidden = true;
    const reload = vi.fn();
    const uninstall = installDailySummaryHistoryGuard(content, cover, reload);

    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(restoredPageEvent(false));

    expect(content.style.display).toBe("none");
    expect(cover.hidden).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    uninstall();
  });
});
