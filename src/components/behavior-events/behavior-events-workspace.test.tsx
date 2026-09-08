// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoBehaviorEventSnapshot } from "@/lib/behavior-events/demo";
import type { BehaviorEventSnapshot } from "@/lib/behavior-events/types";

import { BehaviorEventsWorkspace } from "./behavior-events-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const page = staffPages.find(({ number }) => number === 20)!;
const filters = { dateFrom: null, dateTo: null, clientId: null, eventType: null, state: "all" as const };
const demo = buildDemoBehaviorEventSnapshot(filters);
const formal: BehaviorEventSnapshot = { ...demo, demo: false };

function workspace(snapshot: BehaviorEventSnapshot | null, options: { loadError?: boolean;
  canManage?: boolean; canSign?: boolean; recent?: boolean } = {}) {
  return render(<BehaviorEventsWorkspace canManage={options.canManage ?? false}
    canSign={options.canSign ?? false} filters={filters} hasRecentAal2={options.recent ?? false}
    loadError={options.loadError ?? false} page={page} snapshot={snapshot} />);
}

describe("Page 20 behavior-event workspace", () => {
  afterEach(cleanup);

  it("freezes dedicated permissions, immutable workflow and online-only boundary", () => {
    expect(page.requiredPermissions).toEqual(["clients.read", "behavior_events.read"]);
    expect(page.acceptance.join(" ")).toMatch(/occurred_at.*created_at/u);
    expect(page.acceptance.join(" ")).toMatch(/recorded.*missing.*not_applicable/u);
    expect(page.acceptance.join(" ")).toMatch(/不得從敘事自動推論.*診斷/u);
    expect(page.acceptance.join(" ")).toMatch(/最近 15 分鐘 AAL2/u);
    expect(page.offline.mode).toBe("online-only");
    expect(page.offline.note).toMatch(/尚未配置/u);
  });

  it("renders full-set metrics and honest unconfigured boundaries", () => {
    workspace(demo);
    expect(screen.getByRole("heading", { level: 1, name: "行為與情緒紀錄" })).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "行為事件統計" });
    for (const [label, value] of [["符合事件", "3"], ["含缺值", "1"], ["草稿", "1"],
      ["已簽／更正", "1"], ["已作廢", "1"]]) {
      const node = within(region).getByText(label);
      expect(within(node.closest("article")!).getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByText(/附件、外部通知、匯出與 24 小時離線草稿均為 not_configured/u)).toBeInTheDocument();
    expect(screen.getByText(/目前為合成展示資料/u)).toBeInTheDocument();
  });

  it("shows explicit field states without diagnosis or narrative inference", () => {
    workspace(demo);
    expect(screen.getAllByText("缺值").length).toBeGreaterThan(0);
    expect(screen.getAllByText("不適用").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/均為人員明確選擇與原文；系統不自動診斷/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText("尚未記錄；不可視為空字或零。").length).toBeGreaterThan(0);
  });

  it("exposes signer, server time, purpose, role and reauth evidence in keyboard details", () => {
    const { container } = workspace(demo);
    const summary = [...container.querySelectorAll("summary")]
      .find((node) => node.textContent?.includes("版本與簽署證據")) as HTMLElement;
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false); fireEvent.click(summary); expect(details.open).toBe(true);
    expect(screen.getAllByText(/簽署人：合成簽署員（care_worker）/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/伺服器簽署時間：.*目的：行為與情緒事件簽署/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/重驗證證據：/u).length).toBeGreaterThan(0);
  });

  it("fails closed without substituting synthetic events", () => {
    workspace(null, { loadError: true });
    expect(screen.getByRole("heading", { level: 1, name: "行為與情緒紀錄" })).toBeInTheDocument();
    expect(screen.getByText(/正式事件快照暫時無法取得/u)).toBeInTheDocument();
    expect(screen.queryByText("日照個案甲")).not.toBeInTheDocument();
  });

  it("shows formal create and version actions only with exact authority", () => {
    workspace(formal, { canManage: true, canSign: true, recent: false });
    expect(screen.getByText("新增獨立事件草稿")).toBeInTheDocument();
    expect(screen.getAllByText(/簽署、更正與作廢需同一工作階段最近 15 分鐘 AAL2/u).length).toBeGreaterThan(0);
    cleanup(); workspace(formal);
    expect(screen.queryByText("新增獨立事件草稿")).not.toBeInTheDocument();
    expect(screen.getAllByText("無可用操作").length).toBeGreaterThan(0);
  });

  it("requires an explicit confirmation when selecting sign", () => {
    const { container } = workspace(formal, { canManage: true, canSign: true, recent: true });
    const operationSelect = [...container.querySelectorAll("select")].find((select) =>
      [...select.options].some((option) => option.value === "sign"))!;
    fireEvent.change(operationSelect, { target: { value: "sign" } });
    expect(screen.getAllByText(/簽署確認：/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/系統未自動診斷或從敘事推論/u).length).toBeGreaterThan(0);
  });
});
