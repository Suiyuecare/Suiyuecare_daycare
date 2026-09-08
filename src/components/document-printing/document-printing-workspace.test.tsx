// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoDocumentPrintingSnapshot } from "@/lib/document-printing/demo";
import type { DocumentPrintingSnapshot } from "@/lib/document-printing/types";

import { DocumentPrintJobForm } from "./document-printing-actions";
import { DocumentPrintingWorkspace } from "./document-printing-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const ORG = "62000000-0000-4000-8000-000000000301";
const BRANCH = "62000000-0000-4000-8000-000000000302";
const filters = { templateVersionId: null, clientId: null,
  documentDate: null, query: "" };
const demoSnapshot = buildDemoDocumentPrintingSnapshot({
  organizationId: ORG,
  branchId: BRANCH,
  filters,
  now: new Date("2026-09-02T08:00:00.000Z"),
});
const formalSnapshot: DocumentPrintingSnapshot = {
  ...demoSnapshot,
  demo: false,
  shortLivedUrlStatus: "configured",
  jobs: demoSnapshot.jobs.map((job) => ({ ...job,
    previewUrl: `/api/document-print-jobs/${job.jobId}/pdf?mode=preview&token=safe`,
    downloadUrl: `/api/document-print-jobs/${job.jobId}/pdf?mode=download&token=safe`,
  })),
};
const page = staffPages.find((entry) => entry.number === 62)!;

function renderWorkspace(snapshot: DocumentPrintingSnapshot | null,
  options: { loadError?: boolean; recent?: boolean; canManage?: boolean } = {}) {
  return render(<DocumentPrintingWorkspace
    canManage={options.canManage ?? false}
    filters={filters}
    hasRecentAal2={options.recent ?? false}
    loadError={options.loadError ?? false}
    page={page}
    snapshot={snapshot}
  />);
}

function submitted(call: unknown[]) {
  const init = call[1] as RequestInit;
  return {
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
    headers: init.headers as Record<string, string>,
  };
}

describe("Page-62 document printing UI", () => {
  beforeEach(() => {
    refresh.mockReset();
    let sequence = 400;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `62000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("fails closed without one complete scoped snapshot", () => {
    renderWorkspace(null, { loadError: true });
    expect(screen.getByRole("heading", { name: "無法取得文件列印快照" }))
      .toBeInTheDocument();
    expect(screen.queryByText("示範個案")).not.toBeInTheDocument();
  });

  it("labels demo, unavailable integrations, and authorization counts honestly", () => {
    renderWorkspace(demoSnapshot, { recent: true, canManage: true });
    expect(screen.getByText(/以下範本、個案與文件均為合成資料/u))
      .toBeInTheDocument();
    expect(screen.getByText(/附件合併、作廢／簽署狀態與離線列印尚未配置/u))
      .toBeInTheDocument();
    expect(screen.getByText(/預覽與下載次數是「授權事件」紀錄/u))
      .toBeInTheDocument();
    expect(screen.queryByText("建立不可變文件工作")).not.toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.tagName === "TD" &&
      node.textContent?.includes("預覽 1") === true)).toBeInTheDocument();
  });

  it("keyboard-expands the same immutable model and preserves missing versus not-applicable", () => {
    const { container } = renderWorkspace(demoSnapshot, { recent: true });
    const summary = container.querySelector("details summary") as HTMLElement;
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getAllByText("未提供").length).toBeGreaterThan(0);
    expect(screen.getAllByText("不適用").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/bbbbbbbbbbbbbbbb/u).length).toBeGreaterThan(0);
  });

  it("requires recent AAL2 before exposing document selection fields", () => {
    render(<DocumentPrintJobForm canManage hasRecentAal2={false}
      snapshot={formalSnapshot} />);
    expect(screen.getByRole("heading", { name: "產生文件前需重新驗證" }))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("核准範本版本")).not.toBeInTheDocument();
  });

  it("shows only governed short-lived preview and download links", () => {
    renderWorkspace(formalSnapshot, { recent: true });
    const previews = screen.getAllByRole("link", { name: "預覽 PDF" });
    const downloads = screen.getAllByRole("link", { name: "下載 PDF" });
    expect(previews[0]).toHaveAttribute("href", expect.stringContaining("mode=preview"));
    expect(downloads[0]).toHaveAttribute("href", expect.stringContaining("mode=download"));
    expect(previews[0]?.getAttribute("href")).not.toContain("private-doc-fonts");
  });

  it("reuses an unknown-result key and rotates it only after selection changes", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<DocumentPrintJobForm canManage hasRecentAal2 snapshot={formalSnapshot} />);
    fireEvent.click(screen.getByText("建立不可變文件工作"));
    const submit = screen.getByRole("button", { name: "建立文件工作" });
    fireEvent.click(submit);
    await screen.findByText(/尚未確認完成/u);
    const first = submitted(fetchMock.mock.calls[0]!);

    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = submitted(fetchMock.mock.calls[1]!);
    expect(second.headers["idempotency-key"])
      .toBe(first.headers["idempotency-key"]);
    expect(second.body).toEqual(first.body);
    expect(second.headers["x-document-print-operation"]).toBe("create_job");

    fireEvent.change(screen.getByLabelText("文件日期"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const third = submitted(fetchMock.mock.calls[2]!);
    expect(third.headers["idempotency-key"])
      .not.toBe(first.headers["idempotency-key"]);
    expect(third.body.documentDate).toBe("2026-09-01");
  });

  it("does not invent a PDF URL when signing is unconfigured", () => {
    const unsigned: DocumentPrintingSnapshot = { ...formalSnapshot,
      shortLivedUrlStatus: "not_configured",
      jobs: formalSnapshot.jobs.map((job) => ({ ...job,
        previewUrl: null, downloadUrl: null })),
    };
    renderWorkspace(unsigned, { recent: true });
    expect(screen.getByText(/短效下載簽章尚未設定，因此現有文件可核對內容/u))
      .toBeInTheDocument();
    expect(screen.getAllByText("短效下載簽章尚未設定").length)
      .toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "下載 PDF" }))
      .not.toBeInTheDocument();
  });
});
