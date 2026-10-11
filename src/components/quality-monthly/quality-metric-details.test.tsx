// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { QualityMetricDetails } from "./quality-metric-details";
afterEach(cleanup);
it("does not mount hidden thousands of sources and exposes bounded, keyboard-operable pages", async () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({ id: `d1000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    clientId: null, date: "2026-10-11", source: "fall" as const }));
  const view = render(<QualityMetricDetails metric={{ key: "falls", numerator: 1000, denominator: 0, rate: null, numeratorItems: rows, denominatorItems: [] }} />);
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  const disclosure = view.container.querySelector("details")!;
  disclosure.open = true; fireEvent(disclosure, new Event("toggle"));
  await waitFor(() => expect(screen.queryAllByRole("link")).toHaveLength(25));
  const navigation = screen.getByRole("navigation", { name: "分子分頁" });
  expect(within(navigation).getByRole("button", { name: "上一頁" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(within(navigation).getByRole("button", { name: "下一頁" }));
  expect(within(navigation).getByRole("status").textContent).toContain("第 2／40 頁");
  expect(screen.queryAllByRole("link")).toHaveLength(25);
  disclosure.open = false; fireEvent(disclosure, new Event("toggle"));
  await waitFor(() => expect(screen.queryAllByRole("link")).toHaveLength(0));
});
