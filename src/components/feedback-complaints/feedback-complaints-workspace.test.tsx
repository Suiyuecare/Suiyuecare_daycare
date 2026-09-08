// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoFeedbackComplaintSnapshot } from "@/lib/feedback-complaints/demo";
import { parseFeedbackComplaintFilters } from "@/lib/feedback-complaints/query";
import type { FeedbackComplaintSnapshot } from "@/lib/feedback-complaints/types";

import { FeedbackComplaintsWorkspace } from "./feedback-complaints-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const filters = parseFeedbackComplaintFilters(new URLSearchParams());
const demo = buildDemoFeedbackComplaintSnapshot(filters);
const formal: FeedbackComplaintSnapshot = { ...demo, demo: false };
const page = staffPages.find(({ number }) => number === 56)!;

function workspace(snapshot: FeedbackComplaintSnapshot | null, options: {
  loadError?: boolean;
  canManage?: boolean;
  canCorrect?: boolean;
  canClose?: boolean;
  recent?: boolean;
} = {}) {
  return render(<FeedbackComplaintsWorkspace
    canClose={options.canClose ?? false}
    canCorrect={options.canCorrect ?? false}
    canManage={options.canManage ?? false}
    filters={filters}
    hasRecentAal2={options.recent ?? false}
    loadError={options.loadError ?? false}
    page={page}
    snapshot={snapshot}
  />);
}

describe("Page 56 feedback and complaint workspace", () => {
  beforeEach(() => {
    refresh.mockReset();
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true, value(this: HTMLDialogElement) { this.open = true; },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true, value(this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event("close"));
      },
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("freezes catalog permissions, fail-closed rules and immutable acceptance", () => {
    expect(page.requiredPermissions).toEqual(["complaints.read"]);
    expect(page.offline.mode).toBe("online-only");
    expect(page.acceptance.join(" ")).toMatch(/沒有正式規則.*失敗即關閉/u);
    expect(page.acceptance.join(" ")).toMatch(/不可變事件.*預期版本.*冪等鍵/u);
    expect(page.acceptance.join(" ")).toMatch(/complaints\.sensitive.*稽核/u);
  });

  it("renders reconciled synthetic metrics, deadlines, escalation and boundaries", () => {
    workspace(demo);
    expect(screen.getByRole("heading", { level: 1, name: "意見與申訴" }))
      .toBeInTheDocument();
    const metrics = within(screen.getByRole("region", { name: "意見與申訴摘要" }));
    for (const [label, value] of [["符合案件", "3"], ["高風險", "2"],
      ["未結案", "2"], ["已逾期", "1"]]) {
      const labelNode = metrics.getByText(label);
      expect(within(labelNode.closest("article")!).getByText(value)).toBeInTheDocument();
    }
    expect(screen.getAllByText("高風險").length).toBeGreaterThan(1);
    expect(screen.getAllByText("已逾期").length).toBeGreaterThan(1);
    expect(screen.getByText(/所有寫入按鈕維持唯讀/u)).toBeInTheDocument();
    expect(screen.getByText(/外部升級通知 worker 與正式匯出格式尚未配置/u))
      .toBeInTheDocument();
  });

  it("shows sensitive content or a database-enforced mask without inventing values", () => {
    workspace(demo);
    const details = screen.getAllByText(/案件內容與 1 筆事件/u)[0]
      .closest("details") as HTMLDetailsElement;
    fireEvent.click(within(details).getByText(/案件內容與 1 筆事件/u));
    expect(within(details).getByText("敏感內容已遮蔽")).toBeInTheDocument();
    expect(within(details).queryByText("合成安全流程意見")).not.toBeInTheDocument();
    const visible = screen.getAllByText(/案件內容與 2 筆事件/u)[0]
      .closest("details") as HTMLDetailsElement;
    fireEvent.click(within(visible).getByText(/案件內容與 2 筆事件/u));
    expect(within(visible).getByText("合成安全流程意見")).toBeInTheDocument();
    expect(within(visible).getByText("demo-feedback@example.invalid")).toBeInTheDocument();
  });

  it("fails closed without substituting synthetic cases", () => {
    workspace(null, { loadError: true });
    expect(screen.getByRole("alert")).toHaveTextContent("意見與申訴暫時無法載入");
    expect(screen.getByRole("alert")).toHaveTextContent("沒有改用展示資料");
    expect(screen.queryByText("合成承辦甲")).not.toBeInTheDocument();
  });

  it("disables intake when no exact published deadline rule exists", () => {
    workspace({ ...formal, deadlineRules: [], deadlineRuleStatus: "not_configured" },
      { canManage: true });
    expect(screen.getByText(/尚未發布正式規則/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /建立案件：尚無已發布的精確期限規則/u }))
      .toBeDisabled();
  });

  it("requires exact permissions and recent AAL2 for sensitive correction and close", () => {
    workspace(formal, { canManage: true, canCorrect: true, canClose: true, recent: false });
    expect(screen.getAllByRole("button", { name: /追加更正：須在同一工作階段/u }).length)
      .toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /完成結案：須在同一工作階段/u }).length)
      .toBeGreaterThan(0);
  });

  it("locks body and idempotency key after an unknown result and replays exactly", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network outcome unknown"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        requestId: "req-feedback-1", status: "ok", errors: [], data: {
          operationId: "56900000-0000-4000-8000-000000000001",
          action: "progress", caseId: demo.items[0].id,
          caseNumber: demo.items[0].caseNumber,
          eventId: "56910000-0000-4000-8000-000000000001",
          version: demo.items[0].chainVersion + 1,
          status: "escalated", effectiveRisk: "high", dueAt: demo.items[0].dueAt,
          committedAt: "2026-09-07T05:00:00Z", replayed: true,
          persisted: true, demo: false,
        },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    workspace(formal, { canManage: true, canCorrect: true, canClose: true, recent: true });

    fireEvent.click(screen.getAllByRole("button", { name: "更新處理" })[0]);
    const dialog = screen.getByRole("dialog", { name: "更新處理" });
    fireEvent.change(within(dialog).getByLabelText("處理進度與證據 *"), {
      target: { value: "合成處理證據" },
    });
    fireEvent.submit(within(dialog).getByRole("button", { name: "更新處理" })
      .closest("form")!);
    expect(await within(dialog).findByText(/結果未知/u)).toBeInTheDocument();
    const first = fetchMock.mock.calls[0][1] as RequestInit;
    expect(within(dialog).getByRole("button", { name: "使用原操作重試" }))
      .toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "使用原操作重試" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = fetchMock.mock.calls[1][1] as RequestInit;
    expect(second.body).toBe(first.body);
    expect((second.headers as Record<string, string>)["Idempotency-Key"])
      .toBe((first.headers as Record<string, string>)["Idempotency-Key"]);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
