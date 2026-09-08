// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoAuthorizedCarePlanViewSnapshot } from "@/lib/authorized-care-plan-view/demo";
import type { AuthorizedCarePlanFilters } from "@/lib/authorized-care-plan-view/types";

import { AuthorizedCarePlanViewWorkspace } from "./authorized-care-plan-view-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const page = staffPages.find(({ number }) => number === 55)!;
const filters: AuthorizedCarePlanFilters = {
  asOf: "2026-09-08",
  clientId: null,
  authorizedFrom: null,
  authorizedTo: null,
  effectiveState: "all",
  sourceSystem: null,
  page: 1,
  pageSize: 25,
};
const demo = buildDemoAuthorizedCarePlanViewSnapshot({
  organizationId: "55000000-0000-4000-8000-000000000001",
  branchId: "55000000-0000-4000-8000-000000000002",
  filters,
  now: new Date("2026-09-08T04:00:00.000Z"),
});

describe("Page 55 authorized-care-plan view workspace", () => {
  afterEach(cleanup);

  it("renders a read-only snapshot and honest unconfigured boundaries", () => {
    render(<AuthorizedCarePlanViewWorkspace filters={filters} page={page} snapshot={demo} />);
    expect(screen.getByRole("heading", { level: 1, name: "核定照顧計畫" })).toBeInTheDocument();
    expect(screen.getByText(/中央資料發布／核准流程、官方服務限制規則與欄位映射登錄/u))
      .toBeInTheDocument();
    expect(screen.getByText(/不代表可申報資格/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /新增|編輯|簽署|申報/u })).not.toBeInTheDocument();
  });

  it("keeps exact plan and version identities in keyboard-openable history", () => {
    const { container } = render(
      <AuthorizedCarePlanViewWorkspace filters={filters} page={page} snapshot={demo} />,
    );
    expect(container.querySelectorAll('[data-plan-key="55020000-0000-4000-8000-000000000001"]'))
      .toHaveLength(4);
    const historySummary = screen.getAllByText(/不可變版本歷程/u)[0];
    fireEvent.click(historySummary);
    expect((historySummary.closest("details") as HTMLDetailsElement).open).toBe(true);
    expect(container.querySelector('[data-version-id="55030000-0000-4000-8000-000000000001"]'))
      .toBeInTheDocument();
  });

  it("renders unknown legacy HTML only as escaped text and creates no executable element", () => {
    const malicious = '<script>globalThis.__page55 = true</script><img src="https://invalid.example/x" onerror="globalThis.__page55 = true">';
    const snapshot = structuredClone(demo);
    const version = snapshot.plans[0].history[0];
    version.planData.canonicalJson = JSON.stringify({ legacy_html: malicious });
    const { container } = render(
      <AuthorizedCarePlanViewWorkspace filters={filters} page={page} snapshot={snapshot} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('img[src="https://invalid.example/x"]')).toBeNull();
    expect(container.textContent).toContain("<script>globalThis.__page55 = true</script>");
    expect((globalThis as typeof globalThis & { __page55?: boolean }).__page55).toBeUndefined();
  });

  it("fails closed without substituting demo data", () => {
    render(<AuthorizedCarePlanViewWorkspace
      filters={filters} loadError page={page} snapshot={null}
    />);
    expect(screen.getByRole("alert")).toHaveTextContent(/不會改用展示資料/u);
    expect(screen.queryByText("展示個案甲")).not.toBeInTheDocument();
  });
});
