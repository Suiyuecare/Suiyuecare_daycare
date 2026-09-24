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

  it("keeps DOB masked and intake links hidden without field authority", () => {
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
    expect(screen.queryByRole("link", { name: "個案匯入與收案" })).toBeNull();
    expect(screen.queryByRole("link", { name: "核對／補充資料" })).toBeNull();
  });

  it("routes local and central cases through intake without requiring reauth for reading", () => {
    const snapshot = { ...buildDemoClientMasterSnapshot(), demo: false, demographicsReadable: true };
    render(<ClientMasterWorkspace canCreate canManage hasRecentAal2={false} page={page} query="" snapshot={snapshot} source="all" status="all" />);
    const links = screen.getAllByRole("link", { name: "核對／補充資料" });
    for (const client of snapshot.clients) expect(links.some((link) => link.getAttribute("href") === `/app/client-intake?client=${client.id}`)).toBe(true);
    expect(screen.queryByRole("button", { name: "編輯本機欄位" })).toBeNull();
    expect(screen.getByRole("link", { name: "個案匯入與收案" }).getAttribute("href")).toBe("/app/client-intake");
  });
});
