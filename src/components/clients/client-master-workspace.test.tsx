// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import { buildDemoClientMasterSnapshot } from "@/lib/clients/master-demo";

import { ClientMasterWorkspace } from "./client-master-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

const page = getPageBySlug("staff/operations/clients")!;

describe("client master workspace states", () => {
  it("renders a fail-closed load error without substituting demo data", () => {
    render(
      <ClientMasterWorkspace
        canCreate={false}
        canManage={false}
        hasRecentAal2={false}
        loadError
        page={page}
        query=""
        snapshot={null}
        source="all"
        status="all"
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/失敗即關閉/u);
    expect(screen.queryByText("陳O華")).toBeNull();
  });

  it("keeps DOB masked and the combined form disabled without field authority", () => {
    const demo = buildDemoClientMasterSnapshot();
    const snapshot = {
      ...demo,
      clients: demo.clients.map((client) => ({ ...client, dateOfBirth: null })),
      demographicsReadable: false,
      demo: false,
    };
    render(
      <ClientMasterWorkspace
        canCreate={false}
        canManage={false}
        hasRecentAal2
        page={page}
        query=""
        snapshot={snapshot}
        source="all"
        status="all"
      />,
    );
    expect(screen.getAllByText("依角色遮罩").length).toBeGreaterThan(0);
    expect(screen.queryByText("1944/02/14")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: /新增本機個案：此表單包含生日欄位/u,
      }),
    ).toHaveProperty("disabled", true);
  });
});
