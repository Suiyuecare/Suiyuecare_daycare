// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getModule, pageCatalog } from "@/lib/catalog";
import { buildDemoRecords, type DemoRecord } from "@/lib/demo/fixtures";
import { OperationalWorkspace } from "./operational-workspace";

const sharedPages = pageCatalog.filter((page) => [15, 16, 17, 18, 79, 85, 86, 87, 88, 89].includes(page.number));
const page = sharedPages[0];
const initialRecords = buildDemoRecords(page);

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
});

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

    expect(screen.getByRole("status")).toHaveTextContent("此功能尚未啟用");
    expect(screen.getByRole("status")).toHaveTextContent("請先使用機構核准的既有表單");
    expect(screen.queryByRole("button", { name: /新增紀錄/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /匯出/u })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: /匯出/u })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "選擇個案並填寫" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("僅保留在本頁，不會寫入正式紀錄");
    expect(dialog).not.toHaveTextContent("伺服器時間將在送出時寫入");
    fireEvent.change(within(dialog).getByLabelText("個案 *"), { target: { value: "陳O華" } });
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(summaryCount("展示紀錄")).toBe(String(initialRecords.length + 1));
    expect(screen.getByRole("status")).toHaveTextContent("展示草稿已加入本頁；重新整理後會復原");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the shared modal, preserves an invalid demo draft, and focuses its first error", async () => {
    render(workspace(true, []));
    const trigger = screen.getByRole("button", { name: "選擇個案並填寫" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    const form = within(dialog).getByRole("button", { name: "儲存草稿" }).closest("form")!;
    expect(dialog.tagName).toBe("DIALOG");
    expect(form).toHaveAttribute("novalidate");
    const client = within(dialog).getByLabelText("個案 *");
    const note = within(dialog).getByLabelText("紀錄摘要");
    fireEvent.change(note, { target: { value: "合成觀察內容" } });
    fireEvent.submit(form);
    expect(client).toHaveFocus();
    expect(client).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByText("請填寫個案。", { selector: "small" })).toHaveAttribute("id", client.getAttribute("aria-describedby"));
    expect(note).toHaveValue("合成觀察內容");
    expect(summaryCount("展示紀錄")).toBe("0");
    fireEvent.change(client, { target: { value: "林O英" } });
    expect(client).not.toHaveAttribute("aria-invalid");
    fireEvent.submit(form);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(summaryCount("展示紀錄")).toBe("1");
    expect(trigger).toHaveFocus();
  });

  it("clears only the local demo search and returns focus without resetting status", () => {
    render(workspace(true));
    fireEvent.click(screen.getByRole("button", { name: "待處理" }));
    const search = screen.getByRole("searchbox", { name: "搜尋本頁紀錄" });
    fireEvent.change(search, { target: { value: "合成查詢" } });
    fireEvent.click(screen.getByRole("button", { name: "清除搜尋" }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(screen.getByRole("button", { name: "待處理" })).toHaveAttribute("aria-pressed", "true");
  });

  it("closes the shared demo modal on Escape and restores the originating trigger", () => {
    render(workspace(true));
    const trigger = screen.getByRole("button", { name: "選擇個案並填寫" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("hides open demo drawers and fixture data when the production boundary replaces demo mode", () => {
    const { container, rerender } = render(workspace(true));
    fireEvent.click(screen.getByRole("button", { name: "選擇個案並填寫" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    rerender(workspace(false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("此功能尚未啟用");
    expect(container.querySelector(".metric-card, table")).toBeNull();
    for (const record of initialRecords) expect(container).not.toHaveTextContent(record.primary);
  });

  it("keeps technical acceptance plans in a collapsed disclosure, not presented as completed features", () => {
    render(workspace(true));
    const reminder = screen.getByRole("complementary", { name: "使用提醒" });
    expect(reminder).toHaveTextContent("展示草稿僅保留在目前頁面");
    const details = within(reminder).getByText("管理參考：預定功能與驗收項目").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("以下為建置目標，不代表功能已完成");
    expect(details).toHaveTextContent("預定支援的篩選");
  });
});
