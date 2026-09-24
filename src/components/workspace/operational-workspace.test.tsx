// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getModule, pageCatalog } from "@/lib/catalog";
import { buildDemoRecords, type DemoRecord } from "@/lib/demo/fixtures";
import { OperationalWorkspace } from "./operational-workspace";

const sharedPages = pageCatalog.filter((page) => [15, 16, 17, 18, 79, 85, 86, 87, 88, 89].includes(page.number));
const page = sharedPages[0];
const initialRecords = buildDemoRecords(page);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function workspace(demo: boolean, records: DemoRecord[] = initialRecords) {
  return <OperationalWorkspace page={page} moduleTitle={getModule(page.moduleId).title} initialRecords={records} demo={demo} />;
}

function summaryCount(label: string) {
  return screen.getByText(label, { exact: true }).closest("article")?.querySelector("strong")?.textContent;
}

describe("shared workspace truthful availability", () => {
  it.each(sharedPages)("does not invent counts or a data timestamp on production page $number", (entry) => {
    const { container } = render(<OperationalWorkspace page={entry} moduleTitle={getModule(entry.moduleId).title} initialRecords={[]} demo={false} />);

    expect(screen.getByRole("status")).toHaveTextContent("本頁尚未開放使用");
    expect(screen.getByRole("status")).toHaveTextContent("不能據此判斷是否有待辦或已完成的紀錄");
    expect(screen.getByRole("status")).toHaveTextContent("請先使用機構現行紀錄流程");
    expect(screen.getByRole("button", { name: "新增紀錄（未開放）" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "匯出（未開放）" })).toBeDisabled();
    expect(container.querySelector(".metric-card, time, table")).toBeNull();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "清除篩選" })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/今天 10:24|0 筆|沒有符合條件的紀錄|伺服器時間將在送出時寫入/u);
    expect(container).not.toHaveTextContent(/正式表單尚未接線|狀態機及正式寫入/u);
  });

  it("does not render fixture values accidentally passed to a disconnected production page", () => {
    const { container } = render(workspace(false));
    for (const record of initialRecords) {
      expect(container).not.toHaveTextContent(record.primary);
      expect(container).not.toHaveTextContent(record.secondary);
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "展示清單摘要" })).not.toBeInTheDocument();
  });

  it("labels synthetic data and derives every summary count from actual fixture statuses", () => {
    const { container } = render(workspace(true));
    expect(screen.getByRole("note")).toHaveTextContent("不代表真實個案、正式評估結果或機構統計");
    expect(screen.getByRole("region", { name: "展示清單摘要" })).toBeInTheDocument();
    expect(summaryCount("展示紀錄")).toBe(String(initialRecords.length));
    for (const status of ["待處理", "需留意", "已完成"]) {
      expect(summaryCount(`展示${status}`)).toBe(String(initialRecords.filter((record) => record.status === status).length));
    }
    expect(container).not.toHaveTextContent("今天 10:24");
    expect(screen.getByRole("button", { name: "匯出（未開放）" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "更多篩選" })).not.toBeInTheDocument();
  });

  it("keeps demo summary denominators explicit and independent of list filters", () => {
    render(workspace(true));
    const count = initialRecords.filter((record) => record.status === "待處理").length;
    fireEvent.click(screen.getByRole("button", { name: "待處理" }));
    expect(screen.getByText(`${count} 筆展示紀錄符合目前條件`)).toBeInTheDocument();
    expect(summaryCount("展示紀錄")).toBe(String(initialRecords.length));
    expect(screen.getAllByText("依本頁全部展示紀錄計算")).toHaveLength(4);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "不存在的展示紀錄" } });
    expect(screen.getByRole("heading", { name: "沒有符合條件的展示紀錄" })).toBeInTheDocument();
    expect(screen.getByText("0 筆展示紀錄符合目前條件")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除篩選" }));
    expect(screen.getByText(`${initialRecords.length} 筆展示紀錄符合目前條件`)).toBeInTheDocument();
  });

  it("reports zero only for a known empty demo list, never a forced nonzero count", () => {
    render(workspace(true, []));
    for (const label of ["展示紀錄", "展示待處理", "展示需留意", "展示已完成"]) {
      expect(summaryCount(label)).toBe("0");
    }
    expect(screen.getByRole("heading", { name: "沒有符合條件的展示紀錄" })).toBeInTheDocument();
  });

  it("creates only a local demo draft and updates its count without a server-write claim", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(workspace(true));
    fireEvent.click(screen.getByRole("button", { name: "開始評估" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("僅保留在本頁，不會寫入正式紀錄");
    expect(dialog).not.toHaveTextContent("伺服器時間將在送出時寫入");
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(summaryCount("展示紀錄")).toBe(String(initialRecords.length + 1));
    expect(screen.getByRole("status")).toHaveTextContent("展示草稿已加入本頁；重新整理後會復原");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("hides open demo drawers and fixture data when the production boundary replaces demo mode", () => {
    const { container, rerender } = render(workspace(true));
    fireEvent.click(screen.getByRole("button", { name: "開始評估" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    rerender(workspace(false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("本頁尚未開放使用");
    expect(container.querySelector(".metric-card, table")).toBeNull();
    for (const record of initialRecords) expect(container).not.toHaveTextContent(record.primary);
  });

  it("keeps technical acceptance plans in a collapsed disclosure, not presented as completed features", () => {
    render(workspace(false));
    const reminder = screen.getByRole("complementary", { name: "使用提醒" });
    expect(reminder).toHaveTextContent("本頁尚未開放離線紀錄");
    const details = within(reminder).getByText("管理參考：預定功能與驗收項目").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("以下為建置目標，不代表功能已完成");
    expect(details).toHaveTextContent("預定支援的篩選");
  });
});
