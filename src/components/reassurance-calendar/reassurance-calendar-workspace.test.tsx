// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoReassuranceCalendarSnapshot } from "@/lib/reassurance-calendar/demo";
import type { ReassuranceCalendarFilters } from "@/lib/reassurance-calendar/types";

import { ReassuranceCalendarWorkspace } from "./reassurance-calendar-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const filters: ReassuranceCalendarFilters = {
  month: "2026-09", organizationId: "44000000-0000-4000-8000-000000000020",
  category: null, status: "all", todayOnly: false, query: "",
};
const branchId = "44000000-0000-4000-8000-000000000021";
const page = staffPages.find((entry) => entry.number === 44)!;

afterEach(cleanup);

describe("Page 44 reassurance calendar workspace", () => {
  it("renders the same event identities in calendar and list", () => {
    const snapshot = buildDemoReassuranceCalendarSnapshot({
      organizationId: filters.organizationId, branchId, filters,
    });
    const { container } = render(<ReassuranceCalendarWorkspace filters={filters}
      hasRecentAal2={false} loadError={false} page={page}
      snapshot={snapshot} />);
    const calendar = new Set([...container.querySelectorAll("[data-calendar-event]")]
      .map((node) => node.getAttribute("data-calendar-event")));
    const list = new Set([...container.querySelectorAll("[data-list-event]")]
      .map((node) => node.getAttribute("data-list-event")));
    expect(calendar).toEqual(list);
    expect(screen.getByText(/同一快照：月曆 4 筆／列表 4 筆/u)).toBeInTheDocument();
  });

  it("shows honest demo and unconfigured delivery boundaries", () => {
    const snapshot = buildDemoReassuranceCalendarSnapshot({
      organizationId: filters.organizationId, branchId, filters,
    });
    render(<ReassuranceCalendarWorkspace filters={filters} hasRecentAal2={false}
      loadError={false} page={page} snapshot={snapshot} />);
    expect(screen.getByText(/展示模式：全部為合成資料/u)).toBeInTheDocument();
    expect(screen.getByText(/not_configured/u)).toBeInTheDocument();
    expect(screen.getAllByText(/取消原因/u).length).toBeGreaterThanOrEqual(2);
  });

  it("fails closed without a complete snapshot", () => {
    render(<ReassuranceCalendarWorkspace filters={filters} hasRecentAal2={false}
      loadError page={page} snapshot={null} />);
    expect(screen.getByRole("heading", { name: "無法取得安心行事曆快照" }))
      .toBeInTheDocument();
  });
});
