// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientDocumentsWorkspace } from "./client-documents-workspace";
import { DOCUMENT_CATEGORIES } from "@/lib/client-documents/schema";
const props = { clientId: "c1600000-0000-4000-8000-000000000001", today: "2026-09-14", canManage: true };
function expandForms() { for (const element of document.querySelectorAll("details")) element.open = true; }
function liveRead() { return { status: "ok", data: { uploadConfigured: true, snapshot: { clientId: props.clientId, generatedAt: "2026-09-14T00:00:00Z", rows: DOCUMENT_CATEGORIES.map((category) => ({ category, accessible: true, canManage: true, documentId: null, documentVersion: 0, reviewVersion: 0, status: "missing", scanStatus: null, canDownload: false, mimeType: null, fileSizeBytes: null, reservedAt: null, reviewReason: null })), history: [], historyTruncated: false } } }; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("private document intake UI", () => {
  it("shows six independent categories, no synthetic persistence or fake downloads", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<ClientDocumentsWorkspace {...props} demo />);
    expandForms();
    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(screen.getAllByText("待補件")).toHaveLength(6);
    expect(screen.getAllByRole("button", { name: "上傳附件" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(screen.getAllByRole("button", { name: "取得安全下載連結" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(screen.getByText(/藥袋與歷史文件不會自動變成有效醫囑/)).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not mistake a backend failure for all six files missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "error" }, { status: 503 })));
    render(<ClientDocumentsWorkspace {...props} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("不能判定是否缺件");
    expect(screen.queryAllByText("待補件")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "重新載入附件清單" })).toBeEnabled();
  });
  it("notifies parent immediately about metadata draft and pending upload; failure preserves the draft", async () => {
    const onDirty = vi.fn(); const onBusy = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(liveRead())).mockResolvedValueOnce(Response.json({ status: "error", errors: [{ message: "測試用上傳中斷" }] }, { status: 503 })));
    render(<ClientDocumentsWorkspace {...props} onDirty={onDirty} onBusy={onBusy} />);
    await waitFor(() => expect(screen.getByLabelText("身分證正面文件名稱")).toBeEnabled());
    expandForms();
    fireEvent.change(screen.getByLabelText("身分證正面院所／開立單位"), { target: { value: "合成開立單位" } });
    expect(onDirty).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByLabelText("身分證正面檔案（上限 4MB）"), { target: { files: [new File(["synthetic"], "synthetic.png", { type: "image/png" })] } });
    fireEvent.click(screen.getAllByRole("button", { name: "上傳附件" })[0]);
    expect(onBusy).toHaveBeenCalledWith(true);
    expect(await screen.findByRole("alert")).toHaveTextContent("測試用上傳中斷");
    expect(onBusy).toHaveBeenLastCalledWith(false);
    expect(screen.getByLabelText("身分證正面院所／開立單位")).toHaveValue("合成開立單位");
    expect(onDirty).toHaveBeenLastCalledWith(true);
  });
  it("clears parent dirty and busy flags on component unmount", () => {
    const onDirty = vi.fn(); const onBusy = vi.fn();
    const { unmount } = render(<ClientDocumentsWorkspace {...props} demo onDirty={onDirty} onBusy={onBusy} />);
    unmount(); expect(onDirty).toHaveBeenLastCalledWith(false); expect(onBusy).toHaveBeenLastCalledWith(false);
  });
  it("does not let a late response from unmounted case A clear case B busy state", async () => {
    const onBusy = vi.fn(); let resolve: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(liveRead())).mockImplementationOnce(() => new Promise<Response>((complete) => { resolve = complete; })));
    const { unmount } = render(<ClientDocumentsWorkspace {...props} onBusy={onBusy} />);
    await waitFor(() => expect(screen.getByLabelText("身分證正面文件名稱")).toBeEnabled());
    expandForms();
    fireEvent.change(screen.getByLabelText("身分證正面檔案（上限 4MB）"), { target: { files: [new File(["synthetic"], "synthetic.png", { type: "image/png" })] } });
    fireEvent.click(screen.getAllByRole("button", { name: "上傳附件" })[0]);
    expect(onBusy).toHaveBeenLastCalledWith(true);
    unmount(); expect(onBusy).toHaveBeenLastCalledWith(false); const callsAfterUnmount = onBusy.mock.calls.length;
    await act(async () => { resolve(Response.json({ status: "error" }, { status: 503 })); });
    expect(onBusy.mock.calls).toHaveLength(callsAfterUnmount);
  });
  it("retries an unverified upload with its original version and key without clearing another category draft", async () => {
    const documentId = "c1600000-0000-4000-8000-000000000007";
    const receipt = { id: documentId, clientId: props.clientId, category: "identity_front", version: 1, scanStatus: "clean", persisted: true };
    const readWithVersion = (version: number) => { const result = liveRead(); return { ...result, data: { ...result.data, snapshot: { ...result.data.snapshot, rows: result.data.snapshot.rows.map((row) => row.category === "identity_front" ? { ...row, documentId, documentVersion: version, status: "needs_review", scanStatus: "clean", canDownload: true } : row) } } }; };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(liveRead()))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { receipt } }))
      .mockResolvedValueOnce(Response.json(readWithVersion(2)))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { receipt } }))
      .mockResolvedValueOnce(Response.json(readWithVersion(1)));
    vi.stubGlobal("fetch", fetch); const onDirty = vi.fn();
    render(<ClientDocumentsWorkspace {...props} onDirty={onDirty} />);
    await waitFor(() => expect(screen.getByLabelText("身分證正面文件名稱")).toBeEnabled());
    expandForms();
    fireEvent.change(screen.getByLabelText("體檢資料院所／開立單位"), { target: { value: "合成醫院留待補件" } });
    fireEvent.change(screen.getByLabelText("體檢資料檔案（上限 4MB）"), { target: { files: [new File(["synthetic-health"], "synthetic-health.png", { type: "image/png" })] } });
    fireEvent.change(screen.getByLabelText("身分證正面檔案（上限 4MB）"), { target: { files: [new File(["synthetic-id"], "synthetic-id.png", { type: "image/png" })] } });
    const identity = within(screen.getByRole("article", { name: "身分證正面" }));
    fireEvent.click(identity.getByRole("button", { name: "上傳附件" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("讀回狀態有差異");
    expect(identity.getByText("文件第 0 版／覆核第 0 版")).toBeVisible();
    expect(screen.queryByText(/附件已儲存、通過安全檢查並重新讀回/)).not.toBeInTheDocument();
    fireEvent.click(identity.getByRole("button", { name: "上傳附件" }));
    await screen.findByText(/附件已儲存、通過安全檢查並重新讀回/);
    const first = fetch.mock.calls[1][1].body as FormData;
    const retry = fetch.mock.calls[3][1].body as FormData;
    expect(retry.get("idempotency_key")).toBe(first.get("idempotency_key"));
    expect(retry.get("expectedDocumentVersion")).toBe("0");
    expect(screen.getByLabelText("體檢資料院所／開立單位")).toHaveValue("合成醫院留待補件");
    expect(within(screen.getByRole("article", { name: "體檢資料" })).getByRole("button", { name: "上傳附件" })).toBeEnabled();
    expect(onDirty).toHaveBeenLastCalledWith(true);
  });
  it("verifies a category receipt against its own decision, not the per-file effective state", async () => {
    const initial = liveRead();
    const verified = liveRead();
    const row = verified.data.snapshot.rows.find((item) => item.category === "medication_bag")!;
    Object.assign(row, { reviewVersion: 1, status: "reviewed", categoryReviewDecision: "not_applicable", documentDisposition: "reviewed", documentReviewRevision: 1,
      reviewReason: "類別獨立註記", documentReviewReason: "逐份獨立理由" });
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(initial))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { receipt: { clientId: props.clientId, category: "medication_bag", reviewVersion: 1, decision: "not_applicable", persisted: true, replayed: false } } }))
      .mockResolvedValueOnce(Response.json(verified));
    vi.stubGlobal("fetch", fetch);
    render(<ClientDocumentsWorkspace {...props} />);
    await waitFor(() => expect(screen.getByLabelText("藥袋處置")).toBeEnabled()); expandForms();
    fireEvent.change(screen.getByLabelText("藥袋處置"), { target: { value: "not_applicable" } });
    fireEvent.change(screen.getByLabelText("藥袋覆核／不適用理由"), { target: { value: "類別獨立註記" } });
    fireEvent.click(within(screen.getByRole("article", { name: "藥袋" })).getByRole("button", { name: "儲存文件處置" }));
    expect(await screen.findByText(/文件處置已儲存並重新讀回/)).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("此份文件處置理由：逐份獨立理由")).toBeVisible();
    expect(screen.getByText("類別覆核／不適用註記：類別獨立註記")).toBeVisible();
  });
  it("hides a stale category summary after a committed per-file change until explicit successful refresh", async () => {
    const documentId = "c1600000-0000-4000-8000-000000000007";
    const history = { organizationId: "c1600000-0000-4000-8000-000000000002", branchId: "c1600000-0000-4000-8000-000000000003", clientId: props.clientId,
      category: "medication_bag", snapshotId: "c1600000-0000-4000-8000-000000000004", generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString(), nextCursor: null, pageSize: 50,
      rows: [{ id: documentId, category: "medication_bag", version: 1, scanStatus: "clean", documentLabel: "合成藥袋", provider: null, documentDate: null, validUntil: null, periodFrom: null, periodTo: null,
        createdAt: new Date(Date.now() - 10000).toISOString(), reviewRevision: 0, disposition: "unreviewed", reviewReason: null, reviewedAt: null, canDownload: true, canManage: true, historicalOnly: false }] };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(liveRead()))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { snapshot: history } }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { receipt: { clientId: props.clientId, documentId, category: "medication_bag", reviewRevision: 1, disposition: "reviewed", persisted: true, replayed: false } } }))
      .mockResolvedValueOnce(Response.json({ status: "error" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json(liveRead()));
    vi.stubGlobal("fetch", fetch);
    render(<ClientDocumentsWorkspace {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "查看逐份文件與歷史" }));
    fireEvent.click(await screen.findByRole("button", { name: "處理第 1 份藥袋" }));
    fireEvent.change(screen.getByLabelText("逐份處置理由"), { target: { value: "合成測試已核對" } });
    fireEvent.click(screen.getByLabelText("我已確認文件、目前版本與處置；此操作不會變更醫囑。"));
    fireEvent.click(screen.getByRole("button", { name: "確認儲存這份處置" }));
    await screen.findByText(/補件摘要待更新/);
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "重試確認原次文件處置" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "重新載入附件清單" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "重新載入附件清單" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(6));
    expect(fetch.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });
});
