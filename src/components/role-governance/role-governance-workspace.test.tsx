// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import { buildDemoRoleGovernanceSnapshot } from "@/lib/role-governance/demo";

import { RoleGovernanceWorkspace } from "./role-governance-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const page = getPageBySlug("staff/governance/roles-data-scopes")!;

afterEach(cleanup);

describe("role governance workspace", () => {
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
