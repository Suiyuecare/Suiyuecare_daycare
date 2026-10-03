// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { buildDemoDailyServiceSummary } from "@/lib/daily-service-summary/demo";
import { DailySummaryFilterForm } from "./daily-summary-filter-form";

afterEach(cleanup);

const filters = { serviceDate: "2026-09-07", clientId: null, completeness: "all" as const };
const options = buildDemoDailyServiceSummary(filters).clientOptions;

describe("daily summary filter", () => {
  it("preserves authorized options and submits through an authorization-refreshing GET", () => {
    const { container } = render(<DailySummaryFilterForm filters={filters} clientOptions={options} />);
    const form = container.querySelector("form")!;
    expect(form).toHaveAttribute("action", "/app/staff/service-management/daily-summary#daily-summary-results");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("novalidate");
    expect(screen.getByLabelText("日期")).toHaveValue("2026-09-07");
    expect(screen.getByLabelText("個案").querySelectorAll("option")).toHaveLength(options.length + 1);
  });

  it("keeps an invalid date in place with a focused field-level explanation", () => {
    const { container } = render(<DailySummaryFilterForm filters={filters} clientOptions={options} />);
    const date = screen.getByLabelText("日期") as HTMLInputElement;
    fireEvent.change(date, { target: { value: "" } });
    const submit = fireEvent.submit(container.querySelector("form")!);
    expect(submit).toBe(false);
    expect(date).toHaveFocus();
    expect(date).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("請選擇 2000 至 2200 年間的有效日期");
  });
});
