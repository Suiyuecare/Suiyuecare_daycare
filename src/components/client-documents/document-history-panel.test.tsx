// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentHistoryPage, DocumentLifecycleHistoryRow } from "@/lib/client-documents/lifecycle";
import { DocumentHistoryPanel } from "./document-history-panel";

const clientId = "c1600000-0000-4000-8000-000000000001";
const cursor = "f1600000-0000-4000-8000-000000000001";
const snapshotId = "e1600000-0000-4000-8000-000000000001";
const uuid = (number: number) => `d1600000-0000-4000-8000-${String(number).padStart(12, "0")}`;
function row(number = 1, changes: Partial<DocumentLifecycleHistoryRow> = {}): DocumentLifecycleHistoryRow {
  return { id: uuid(number), category: "medication_bag", version: number, scanStatus: "clean", documentLabel: `合成藥袋${number}`,
    provider: null, documentDate: null, validUntil: null, periodFrom: null, periodTo: null, createdAt: "2026-09-15T00:00:00Z",
    reviewRevision: 1, disposition: "reviewed", reviewReason: "合成前次覆核", reviewedAt: "2026-09-15T00:00:00Z",
    canDownload: true, canManage: true, historicalOnly: false, ...changes };
}
function page(rows = [row()], changes: Partial<DocumentHistoryPage> = {}): DocumentHistoryPage {
  return { organizationId: "a1600000-0000-4000-8000-000000000001", branchId: "b1600000-0000-4000-8000-000000000001",
    clientId, category: "medication_bag", snapshotId, generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString(),
    rows, nextCursor: null, pageSize: 50, ...changes };
}
const props = () => ({ clientId, canManage: true, demo: false, disabled: false, today: "2026-09-15",
  onDirty: vi.fn(), onBusy: vi.fn(), onChanged: vi.fn().mockResolvedValue(undefined) });
const ok = (data: unknown) => Response.json({ status: "ok", data });
const error = (status: number, code = "SYNTHETIC_FAILURE") => Response.json({ status: "error", data: null, errors: [{ code }] }, { status });
type FetchCall = (url: string, options?: RequestInit) => Promise<Response>;
function queued(...responses: (Response | Error)[]) {
  const fetch = vi.fn<FetchCall>();
  for (const response of responses) {
    if (response instanceof Error) fetch.mockRejectedValueOnce(response); else fetch.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetch); return fetch;
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "查看逐份文件與歷史" }));
  await screen.findByRole("button", { name: "處理第 1 份藥袋" });
}
function edit(reason = "這份合成藥袋已核對") {
  fireEvent.click(screen.getByRole("button", { name: "處理第 1 份藥袋" }));
  fireEvent.change(screen.getByRole("textbox", { name: "逐份處置理由" }), { target: { value: reason } });
  fireEvent.click(screen.getByRole("checkbox", { name: /我已確認文件/ }));
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "確認儲存這份處置" }));
function mutationCalls(fetch: ReturnType<typeof queued>) {
  return fetch.mock.calls.filter(([url]) => url === "/api/client-documents/lifecycle");
}
function saved(input: Record<string, unknown>, changes: Record<string, unknown> = {}) {
  return ok({ receipt: { clientId: input.clientId, documentId: input.documentId, category: input.category,
    reviewRevision: Number(input.expectedReviewRevision) + 1, disposition: input.disposition, persisted: true, replayed: false, ...changes } });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("per-document history and lifecycle UI", () => {
  it("is lazy and never contacts document services in demo", async () => {
    const fetch = queued(ok({ snapshot: page() })); const first = render(<DocumentHistoryPanel {...props()} />);
    expect(fetch).not.toHaveBeenCalled(); await open(); expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toContain(`client=${clientId}`); expect(fetch.mock.calls[0][0]).toContain("category=medication_bag");
    first.unmount(); fetch.mockClear(); render(<DocumentHistoryPanel {...props()} demo />);
    fireEvent.click(screen.getByRole("button", { name: "查看逐份文件與歷史" }));
    expect(screen.getByText(/合成展示不讀取文件/)).toBeVisible(); expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "從最新資料查詢" })).toBeDisabled();
  });
  it("pages within one snapshot and uses the opaque cursor, caching only the same queried pages", async () => {
    const first = page(Array.from({ length: 50 }, (_, index) => row(50 - index)), { nextCursor: cursor });
    const second = { ...first, rows: [row(51, { createdAt: "2026-09-14T00:00:00Z" })], nextCursor: null };
    const fetch = queued(ok({ snapshot: first }), ok({ snapshot: second })); render(<DocumentHistoryPanel {...props()} />); await open();
    expect(screen.getAllByRole("listitem")).toHaveLength(50); fireEvent.click(screen.getByRole("button", { name: "下一頁" }));
    await screen.findByText("合成藥袋51・第 51 份／版");
    expect(screen.getAllByRole("listitem")).toHaveLength(1); expect(fetch.mock.calls[1][0]).toContain(`cursor=${cursor}`);
    fireEvent.click(screen.getByRole("button", { name: "上一頁" })); expect(screen.getAllByRole("listitem")).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "下一頁" })); expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2); expect(screen.getByRole("button", { name: "下一頁" })).toBeDisabled();
  });
  it.each(["snapshot", "client", "branch", "category", "duplicate"] as const)("rejects unsafe %s continuation and hides both pages", async (kind) => {
    const first = page(Array.from({ length: 50 }, (_, index) => row(50 - index)), { nextCursor: cursor });
    const second: DocumentHistoryPage = { ...first, rows: [row(51, { createdAt: "2026-09-14T00:00:00Z" })], nextCursor: null };
    if (kind === "snapshot") second.snapshotId = uuid(900);
    if (kind === "client") second.clientId = uuid(901);
    if (kind === "branch") second.branchId = uuid(902);
    if (kind === "category") { second.category = "health_exam"; second.rows = [row(51, { category: "health_exam" })]; }
    if (kind === "duplicate") second.rows = [row(1)];
    queued(ok({ snapshot: first }), ok({ snapshot: second })); render(<DocumentHistoryPanel {...props()} />); await open();
    fireEvent.click(screen.getByRole("button", { name: "下一頁" })); expect(await screen.findByRole("alert")).toHaveTextContent("暫時無法確認");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0); expect(screen.getByRole("button", { name: "從最新資料查詢" })).toBeEnabled();
  });
  it("keeps exact body, key and base revision after uncertain write then 409", async () => {
    const fetch = queued(ok({ snapshot: page() }), error(503), error(409, "DOCUMENT_LIFECYCLE_CONFLICT"), error(503));
    const callbacks = props(); render(<DocumentHistoryPanel {...callbacks} />); await open(); edit(); save();
    expect(await screen.findByRole("alert")).toHaveTextContent("原次儲存尚未確認");
    expect(screen.getByRole("textbox", { name: "逐份處置理由" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "這份文件的新處置" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "逐份處置理由" })).toHaveValue("這份合成藥袋已核對");
    fireEvent.click(screen.getByRole("button", { name: "重試確認原次文件處置" }));
    await waitFor(() => expect(mutationCalls(fetch)).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "重試確認原次文件處置" })).toBeEnabled());
    expect(screen.getByRole("alert")).toHaveTextContent("原次儲存尚未確認");
    expect(screen.queryByRole("button", { name: "保留理由，重新查詢後逐份比對" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重試確認原次文件處置" }));
    await waitFor(() => expect(mutationCalls(fetch)).toHaveLength(3));
    const bodies = mutationCalls(fetch).map(([, options]) => options?.body);
    expect(bodies[1]).toBe(bodies[0]); expect(bodies[2]).toBe(bodies[0]);
    expect(JSON.parse(String(bodies[0]))).toMatchObject({ clientId, documentId: uuid(1), category: "medication_bag", expectedReviewRevision: 1, reason: "這份合成藥袋已核對" });
    expect(callbacks.onDirty).toHaveBeenLastCalledWith(true);
  });
  it("first definitive 409 requires explicit reload, comparison and reconfirmation", async () => {
    const fetch = queued(ok({ snapshot: page() }), error(409, "DOCUMENT_LIFECYCLE_CONFLICT"), ok({ snapshot: page([row(1, { reviewRevision: 2, disposition: "needs_replacement" })]) }));
    render(<DocumentHistoryPanel {...props()} />); await open(); edit("保留的合成處置理由"); save();
    expect(await screen.findByRole("alert")).toHaveTextContent("這次處置未套用");
    fireEvent.click(screen.getByRole("button", { name: "保留理由，重新查詢後逐份比對" }));
    expect(mutationCalls(fetch)).toHaveLength(1); expect(screen.queryByRole("textbox", { name: "逐份處置理由" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "從最新資料查詢" })); await screen.findByRole("button", { name: "處理第 1 份藥袋" });
    expect(mutationCalls(fetch)).toHaveLength(1); fireEvent.click(screen.getByRole("button", { name: "處理第 1 份藥袋" }));
    expect(screen.getByRole("textbox", { name: "逐份處置理由" })).toHaveValue("保留的合成處置理由");
    expect(screen.getByRole("checkbox", { name: /我已確認文件/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "確認儲存這份處置" })).toBeDisabled(); expect(mutationCalls(fetch)).toHaveLength(1);
  });
  it("verified write followed by read failure cannot accidentally re-submit mutation", async () => {
    const fetch = queued(ok({ snapshot: page() }));
    fetch.mockImplementationOnce(async (_url, options) => saved(JSON.parse(String(options?.body)))).mockResolvedValueOnce(error(503));
    render(<DocumentHistoryPanel {...props()} />); await open(); edit(); save();
    expect(await screen.findByRole("alert")).toHaveTextContent("已有成功回條");
    expect(screen.getByText(/這份文件的處置已儲存/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "重試確認原次文件處置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "確認儲存這份處置" })).not.toBeInTheDocument();
    expect(mutationCalls(fetch)).toHaveLength(1); expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
  it("wrong target or version receipt stays uncertain, never shows success", async () => {
    const fetch = queued(ok({ snapshot: page() }));
    fetch.mockImplementationOnce(async (_url, options) => saved(JSON.parse(String(options?.body)), { documentId: uuid(2) }));
    render(<DocumentHistoryPanel {...props()} />); await open(); edit(); save();
    expect(await screen.findByRole("alert")).toHaveTextContent("原次儲存尚未確認");
    expect(screen.queryByText(/這份文件的處置已儲存/)).not.toBeInTheDocument(); expect(mutationCalls(fetch)).toHaveLength(1);
  });
  it("downloads clean inactive evidence with exact document identity and explicit historical labeling", async () => {
    const signedUrl = "https://synthetic.supabase.co/storage/v1/object/sign/client-intake-documents/synthetic";
    const fetch = queued(ok({ snapshot: page([row(1, { disposition: "inactive", historicalOnly: true })]) }),
      ok({ url: signedUrl, documentId: uuid(1), version: 1, expiresSeconds: 60, disposition: "inactive", historicalOnly: true }));
    render(<DocumentHistoryPanel {...props()} />); await open();
    expect(screen.getByText(/僅供歷史查考/)).toBeVisible(); fireEvent.click(screen.getByRole("button", { name: "下載歷史文件" }));
    expect(await screen.findByRole("link", { name: /下載此文件/ })).toHaveAttribute("href", signedUrl);
    expect(fetch.mock.calls[1][0]).toBe("/api/client-documents"); expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toMatchObject({ clientId, documentId: uuid(1) });
    expect(mutationCalls(fetch)).toHaveLength(0);
  });
  it("does not expose a download link for a mismatched receipt", async () => {
    queued(ok({ snapshot: page() }), ok({ url: "https://synthetic.supabase.co/storage/v1/object/sign/client-intake-documents/synthetic", documentId: uuid(2), version: 1, expiresSeconds: 60 }));
    render(<DocumentHistoryPanel {...props()} />); await open(); fireEvent.click(screen.getByRole("button", { name: "取得此文件下載連結" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("無法取得"); expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
  it.each(["page", "row"] as const)("honors %s read-only authority", async (mode) => {
    const fetch = queued(ok({ snapshot: page([row(1, { canManage: mode !== "row" })]) }));
    render(<DocumentHistoryPanel {...props()} canManage={mode !== "page"} />); await open();
    expect(screen.getByRole("button", { name: "處理第 1 份藥袋" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "處理第 1 份藥袋" }));
    expect(screen.queryByRole("textbox", { name: "逐份處置理由" })).not.toBeInTheDocument(); expect(mutationCalls(fetch)).toHaveLength(0);
  });
  it("clears expired page metadata and offers a fresh query", async () => {
    vi.useFakeTimers(); const fetch = queued(ok({ snapshot: page([], { expiresAt: new Date(Date.now() + 1000).toISOString() }) }));
    render(<DocumentHistoryPanel {...props()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "查看逐份文件與歷史" })); });
    expect(screen.getByText(/這個範圍目前沒有文件/)).toBeVisible();
    act(() => { vi.advanceTimersByTime(1001); });
    expect(screen.getByText(/已收起舊資料/)).toBeVisible(); expect(screen.queryByText(/這個範圍目前沒有文件/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "從最新資料查詢" })).toBeEnabled(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not let a late unmounted read change parent state", async () => {
    let resolve: (value: Response) => void = () => {};
    const fetch = vi.fn<FetchCall>().mockImplementation(() => new Promise<Response>((complete) => { resolve = complete; })); vi.stubGlobal("fetch", fetch);
    const callbacks = props(); const { unmount } = render(<DocumentHistoryPanel {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "查看逐份文件與歷史" })); unmount();
    const busyCount = callbacks.onBusy.mock.calls.length; const dirtyCount = callbacks.onDirty.mock.calls.length;
    await act(async () => { resolve(ok({ snapshot: page() })); });
    expect(callbacks.onBusy).toHaveBeenCalledWith(false); expect(callbacks.onBusy).toHaveBeenCalledTimes(busyCount); expect(callbacks.onDirty).toHaveBeenCalledTimes(dirtyCount);
  });
});
