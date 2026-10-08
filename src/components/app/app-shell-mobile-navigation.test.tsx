// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import type Link from "next/link";

import { filterNavigationByAccess, getNavigationGroups } from "@/lib/catalog";
import type { TenantContext } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({ pathname: "/app/staff/workspace/dashboard" }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<typeof Link>) => <a href={String(href)}
    aria-label={props["aria-label"]} aria-current={props["aria-current"]} onClick={props.onClick}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("./branch-switcher", () => ({ BranchSwitcher: () => <span>合成分支</span> }));

import { AppShell } from "./app-shell";

const baseContext: TenantContext = {
  organizationId: "synthetic-org", branchId: "synthetic-branch", userId: "synthetic-user",
  organizationName: "合成機構", branchName: "合成分支", displayName: "合成人員",
  roles: ["care_worker"], scopes: ["clients.read", "health.read"],
  assuranceLevel: "aal1", recentAal2At: null, demo: false,
};

function renderShell(roles: TenantContext["roles"], scopes: string[]) {
  const context = { ...baseContext, roles, scopes };
  const navigation = filterNavigationByAccess(getNavigationGroups("staff"), context);
  return render(<AppShell context={context} navigation={navigation}><p>合成工作頁</p></AppShell>);
}

function bottomNavigation() {
  return within(screen.getByRole("navigation", { name: "常用功能" }));
}

function bottomHrefs() {
  return bottomNavigation().getAllByRole("link").map((link) => link.getAttribute("href"));
}

beforeEach(() => {
  mocks.pathname = "/app/staff/workspace/dashboard";
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("authorized role-aware mobile navigation", () => {
  it("labels the dedicated external assessment route in the shared header", () => {
    mocks.pathname = "/app/staff/assessments/external-results";
    renderShell(["nurse"], ["clients.read", "care_records.read"]);
    expect(screen.getByText("外部評估結果登錄")).toBeInTheDocument();
  });

  it("keeps the care worker's today, case and measurement destinations", () => {
    renderShell(["care_worker"], ["clients.read", "health.read"]);
    expect(bottomHrefs()).toEqual([
      "/app/staff/workspace/dashboard", "/app/staff/workspace/case-center", "/app/staff/daily-care/vital-signs",
    ]);
    expect(bottomNavigation().getByRole("button", { name: "更多功能" })).toBeInTheDocument();
  });

  it("puts the nurse's medication record before generic measurement when authorized", () => {
    mocks.pathname = "/app/staff/daily-care/medication-records";
    renderShell(["nurse"], ["clients.read", "medications.read", "health.read"]);
    expect(bottomHrefs()).toEqual([
      "/app/staff/workspace/dashboard", "/app/staff/workspace/case-center", "/app/staff/daily-care/medication-records",
    ]);
    expect(bottomNavigation().getByRole("link", { name: "用藥紀錄 2.0" })).toHaveAttribute("aria-current", "page");
    expect(bottomNavigation().getByRole("link", { name: "用藥紀錄 2.0" })).toHaveTextContent("用藥");
  });

  it("puts the social worker's service record on the third slot", () => {
    renderShell(["case_manager_social_worker"], ["clients.read", "social_work_records.read", "health.read"]);
    expect(bottomHrefs()).toEqual([
      "/app/staff/workspace/dashboard", "/app/staff/workspace/case-center", "/app/staff/social-work/service-records",
    ]);
    expect(bottomNavigation().getByRole("link", { name: "社工服務紀錄" })).toHaveTextContent("社工");
  });

  it("uses a stable clinical priority for a director concurrently approved as nurse and social worker", () => {
    mocks.pathname = "/app/staff/social-work/service-records";
    renderShell(["branch_director", "case_manager_social_worker", "nurse"],
      ["clients.read", "health.read", "medications.read", "social_work_records.read", "daily_service_summary.read"]);
    expect(bottomHrefs()).toEqual([
      "/app/staff/workspace/dashboard", "/app/staff/workspace/case-center", "/app/staff/daily-care/medication-records",
    ]);
    expect(bottomNavigation().getByRole("button", { name: "更多功能，目前頁面在選單中" })).toHaveAttribute("data-current", "true");
    expect(screen.getByRole("link", { name: "社工服務紀錄" })).toBeInTheDocument();
  });

  it("never invents a medication shortcut after that scope is removed and uses only an approved fallback", () => {
    const view = renderShell(["nurse"], ["clients.read", "medications.read", "health.read"]);
    expect(bottomNavigation().getByRole("link", { name: "用藥紀錄 2.0" })).toBeInTheDocument();
    view.unmount();
    renderShell(["nurse"], ["clients.read", "nursing_assessments.read"]);
    expect(bottomHrefs()).toEqual([
      "/app/staff/workspace/dashboard", "/app/staff/workspace/case-center", "/app/staff/service-management/nursing-assessment",
    ]);
    expect(bottomNavigation().queryByRole("link", { name: "用藥紀錄 2.0" })).not.toBeInTheDocument();
  });

  it("marks More, then opens the complete allowed catalog without exposing a forbidden page", () => {
    mocks.pathname = "/app/staff/social-work/service-records";
    renderShell(["case_manager_social_worker"], ["clients.read", "social_work_records.read"]);
    const more = bottomNavigation().getByRole("button", { name: "更多功能" });
    expect(more).not.toHaveAttribute("data-current");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("link", { name: "社工服務紀錄" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "用藥紀錄 2.0" })).not.toBeInTheDocument();
  });
});
