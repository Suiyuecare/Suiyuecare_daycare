// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import { DEFAULT_ROLE_CATEGORIES } from "@/lib/domain/roles";
import { buildDemoRoleGovernanceSnapshot } from "@/lib/role-governance/demo";

import { RoleGovernanceWorkspace } from "./role-governance-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const page = getPageBySlug("staff/governance/roles-data-scopes")!;

afterEach(cleanup);

describe("role governance workspace", () => {
  it("gives all three scrollable tables distinct accessible names and keyboard focus", () => {
    render(<RoleGovernanceWorkspace canManage hasRecentAal2 page={page}
      snapshot={buildDemoRoleGovernanceSnapshot()} />);
    const names = ["可捲動的角色與權限現況表格", "可捲動的成員目前角色表格", "可捲動的申請與獨立核准表格"];
    const regions = names.map((name) => screen.getByRole("region", { name }));
    expect(regions).toHaveLength(3);
    for (const region of regions) {
      expect(region.tabIndex).toBe(0);
      expect(within(region).getByRole("table")).toBeTruthy();
      region.focus();
      expect(document.activeElement).toBe(region);
    }
  });

  it("lists exactly 11 reference categories without fabricating active roles or permissions", () => {
    const snapshot = buildDemoRoleGovernanceSnapshot();
    const before = JSON.stringify(snapshot);
    render(<RoleGovernanceWorkspace canManage hasRecentAal2 page={page} snapshot={snapshot} />);
    const guide = screen.getByRole("region", { name: "職務類別與管理範圍" });
    expect(guide.querySelector("details")?.open).toBe(false);
    expect(Array.from(guide.querySelectorAll("dt"), (node) => node.textContent))
      .toEqual(DEFAULT_ROLE_CATEGORIES.map((category) => category.label));
    expect(guide.querySelectorAll("button, input, select")).toHaveLength(0);
    expect(guide.textContent).toContain("不代表帳號已開通或已取得權限");
    expect(guide.textContent).toContain("不因主任職稱自動取得護理或社工權限");
    expect(screen.getByText(`${snapshot.roles.length} 個角色・${snapshot.permissions.length} 項權限・更新 2026/09/01 17:00`))
      .toBeTruthy();
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("normalizes current system labels while preserving custom and request history names", () => {
    const original = buildDemoRoleGovernanceSnapshot();
    const snapshot = { ...original,
      roles: original.roles.map((role) => role.roleKey === "organization_manager"
        ? { ...role, name: "旧版機構管理員" } : role),
      requests: original.requests.map((request) => request.operation === "create_role"
        ? { ...request, roleName: "歷史申請職稱" } : request),
    };
    render(<RoleGovernanceWorkspace canManage hasRecentAal2 page={page} snapshot={snapshot} />);
    const matrix = screen.getAllByRole("table")[0]!;
    expect(within(matrix).getByText("全機構管理員（多點管理）")).toBeTruthy();
    expect(within(matrix).getByText("活動帶領人")).toBeTruthy();
    expect(within(matrix).queryByText("旧版機構管理員")).toBeNull();
    expect(screen.getAllByText("歷史申請職稱").length).toBeGreaterThan(0);
  });

  it("renders demo data as explicitly read-only and blocks self approval", () => {
    const snapshot = buildDemoRoleGovernanceSnapshot();
    const { container } = render(
      <RoleGovernanceWorkspace
        canManage
        hasRecentAal2
        page={page}
        snapshot={snapshot}
      />,
    );

    expect(screen.getByText(/唯讀展示模式/u).textContent).toMatch(
      /按鈕已停用，永不呼叫寫入 API/u,
    );
    const writeButtons = screen.getAllByRole("button").filter((button) =>
      /建立變更申請|獨立核准/u.test(button.textContent ?? ""),
    );
    expect(writeButtons.length).toBeGreaterThan(0);
    expect(writeButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getAllByText("申請人不可自批").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain(snapshot.requests[0]!.id);
  });

  it("shows a fail-visible notice when the request snapshot is truncated", () => {
    const snapshot = {
      ...buildDemoRoleGovernanceSnapshot(),
      requestTotal: 203,
      requestsTruncated: true,
    };
    render(
      <RoleGovernanceWorkspace
        canManage
        hasRecentAal2
        page={page}
        snapshot={snapshot}
      />,
    );

    expect(screen.getByText(/尚有 200 筆未載入/u).textContent).toMatch(
      /待核准本身超過上限/u,
    );
  });
});
