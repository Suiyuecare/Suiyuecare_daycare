// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { buildDemoOpeningReadinessSources } from "@/lib/opening-readiness/demo";
import { projectOpeningReadiness } from "@/lib/opening-readiness/projection";
import { OpeningReadinessWorkspace } from "./opening-readiness-workspace";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }), default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
const context: TenantContext = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333", organizationName: "合成機構", branchName: "合成分支", displayName: "合成主管",
  roles: ["branch_supervisor"], scopes: [], assuranceLevel: "aal1", recentAal2At: null, demo: true };
function fixture() { return projectOpeningReadiness({ context, serviceDate: "2026-09-13",
  sources: buildDemoOpeningReadinessSources(context, "2026-09-13") }); }
beforeEach(() => { vi.clearAllMocks(); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); });
afterEach(cleanup);

describe("opening checklist user-centered states", () => {
  it("shows actionable owner-labeled steps and explicit safety limit without pass checkboxes", () => {
    render(<OpeningReadinessWorkspace snapshot={fixture()} />);
    expect(screen.getByRole("heading", { name: "今天開始服務前，先把缺項補齊" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    expect(screen.getByText(/展示模式：以下為合成資料/)).toBeTruthy();
    expect(screen.getByText(/尚未核准完整上線或新增真實資料/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("link", { name: "安排當日工作" }).getAttribute("href")).toContain("date=2026-09-13");
    expect(screen.getAllByText(/負責：/)).toHaveLength(9);
    fireEvent.click(screen.getByRole("button", { name: "重新檢查" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("forbidden screen contains no counts or source details", () => {
    render(<OpeningReadinessWorkspace snapshot={{ status: "forbidden" }} />);
    expect(screen.getByRole("heading", { name: /限獲授權的管理員/ })).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button", { name: "重新檢查" })).toBeNull();
  });
  it("offline state retains data but disables misleading refresh", () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    render(<OpeningReadinessWorkspace snapshot={fixture()} />);
    expect(screen.getByRole("status").textContent).toContain("目前離線");
    expect((screen.getByRole("button", { name: "重新檢查" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("stale and compact states expose limits and the full checklist entrance", () => {
    const data = fixture();
    if (data.status === "forbidden") throw new Error("fixture forbidden");
    render(<OpeningReadinessWorkspace snapshot={{ ...data, staleAfter: "2000-01-01T00:00:00Z" }} compact />);
    expect(screen.getByRole("status").textContent).toContain("已超過一分鐘");
    expect(screen.getByRole("link", { name: "查看完整準備清單" }).getAttribute("href")).toContain("effectiveOn=2026-09-13#opening-readiness");
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText(/尚未核准完整上線或新增真實資料/)).toBeTruthy();
  });
});
