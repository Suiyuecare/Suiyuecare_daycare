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
  it("names the upload and readback waits without reporting success before the verified snapshot", async () => {
    const documentId = "c1600000-0000-4000-8000-000000000007";
    const receipt = { id: documentId, clientId: props.clientId, category: "identity_front", version: 1, scanStatus: "clean", persisted: true };
    const verified = liveRead();
    Object.assign(verified.data.snapshot.rows[0], { documentId, documentVersion: 1, status: "needs_review", scanStatus: "clean", canDownload: true });
    let completeUpload: (response: Response) => void = () => {};
    let completeRead: (response: Response) => void = () => {};
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(liveRead()))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { completeUpload = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { completeRead = resolve; }));
    vi.stubGlobal("fetch", fetch);
    render(<ClientDocumentsWorkspace {...props} />);
    await waitFor(() => expect(screen.getByLabelText("身分證正面檔案（上限 4MB）")).toBeEnabled());
    expandForms();
    fireEvent.change(screen.getByLabelText("身分證正面檔案（上限 4MB）"), { target: { files: [new File(["synthetic"], "synthetic.png", { type: "image/png" })] } });
    const identity = within(screen.getByRole("article", { name: "身分證正面" }));
    fireEvent.click(identity.getByRole("button", { name: "上傳附件" }));
    expect(await identity.findByRole("status")).toHaveTextContent("正在上傳並安全檢查");
    expect(identity.queryByText(/附件已儲存、通過安全檢查/)).not.toBeInTheDocument();
    await act(async () => { completeUpload(Response.json({ status: "ok", data: { receipt } })); });
    expect(await identity.findByRole("status")).toHaveTextContent("正在核對已保存的附件狀態");
    expect(identity.queryByText(/附件已儲存、通過安全檢查/)).not.toBeInTheDocument();
    await act(async () => { completeRead(Response.json(verified)); });
    expect(await screen.findByText(/附件已儲存、通過安全檢查並重新讀回/)).toBeVisible();
    expect(identity.queryByRole("status")).not.toBeInTheDocument();
  });
  it("treats a timeout as uncertain, retains the selected file and reuses the original upload key", async () => {
    const documentId = "c1600000-0000-4000-8000-000000000007";
    const receipt = { id: documentId, clientId: props.clientId, category: "identity_front", version: 1, scanStatus: "clean", persisted: true };
    const verified = liveRead();
    Object.assign(verified.data.snapshot.rows[0], { documentId, documentVersion: 1, status: "needs_review", scanStatus: "clean", canDownload: true });
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(liveRead()))
      .mockRejectedValueOnce(new DOMException("The operation timed out", "TimeoutError"))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { receipt } }))
      .mockResolvedValueOnce(Response.json(verified));
    vi.stubGlobal("fetch", fetch);
    render(<ClientDocumentsWorkspace {...props} />);
    await waitFor(() => expect(screen.getByLabelText("身分證正面檔案（上限 4MB）")).toBeEnabled());
    expandForms();
    fireEvent.change(screen.getByLabelText("身分證正面院所／開立單位"), { target: { value: "合成開立單位" } });
    fireEvent.change(screen.getByLabelText("身分證正面檔案（上限 4MB）"), { target: { files: [new File(["synthetic"], "synthetic.png", { type: "image/png" })] } });
    const identity = within(screen.getByRole("article", { name: "身分證正面" }));
    fireEvent.click(identity.getByRole("button", { name: "上傳附件" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("本次上傳結果尚未確認");
    expect(screen.getByRole("alert")).not.toHaveTextContent("The operation timed out");
    expect(identity.getByText(/synthetic.png/)).toBeVisible();
    expect(screen.getByLabelText("身分證正面院所／開立單位")).toHaveValue("合成開立單位");
    expect(screen.getByLabelText("身分證正面院所／開立單位")).toBeDisabled();
    expect(screen.getByLabelText("身分證正面檔案（上限 4MB）")).toBeDisabled();
    fireEvent.click(identity.getByRole("button", { name: "重試確認原次上傳" }));
    expect(await screen.findByText(/附件已儲存、通過安全檢查並重新讀回/)).toBeVisible();
    const original = fetch.mock.calls[1][1].body as FormData;
    const retry = fetch.mock.calls[2][1].body as FormData;
    expect(retry.get("idempotency_key")).toBe(original.get("idempotency_key"));
    expect(retry.get("expectedDocumentVersion")).toBe(original.get("expectedDocumentVersion"));
    expect(retry.get("file")).toBe(original.get("file"));
  });
  it("requires a read after a version conflict and cannot reinterpret the same file as a new-version upload", async () => {
    const newer = liveRead();
    Object.assign(newer.data.snapshot.rows[0], { documentId: "c1600000-0000-4000-8000-000000000007", documentVersion: 1, status: "needs_review", scanStatus: "clean", canDownload: true });
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(liveRead()))
      .mockResolvedValueOnce(Response.json({ status: "error", errors: [{ message: "附件或覆核版本已變更" }] }, { status: 409 }))
      .mockResolvedValueOnce(Response.json(newer));
    vi.stubGlobal("fetch", fetch);
    render(<ClientDocumentsWorkspace {...props} />);
    await waitFor(() => expect(screen.getByLabelText("身分證正面檔案（上限 4MB）")).toBeEnabled());
    expandForms();
    fireEvent.change(screen.getByLabelText("身分證正面檔案（上限 4MB）"), { target: { files: [new File(["synthetic"], "synthetic.png", { type: "image/png" })] } });
    const identity = within(screen.getByRole("article", { name: "身分證正面" }));
    fireEvent.click(identity.getByRole("button", { name: "上傳附件" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("先重新載入附件清單核對");
    expect(screen.getByLabelText("身分證正面院所／開立單位")).toBeDisabled();
    expect(identity.getByRole("button", { name: "先重新載入核對" })).toBeDisabled();
    expect(identity.getByText(/synthetic.png/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重新載入附件清單" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("附件清單已有新版本");
    expect(identity.queryByText(/synthetic.png/)).not.toBeInTheDocument();
    expect(identity.getByRole("button", { name: "新增文件／新版本" })).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("shows file type and size problems on selection before sending any upload", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(liveRead())); vi.stubGlobal("fetch", fetch);
    render(<ClientDocumentsWorkspace {...props} />);
    await waitFor(() => expect(screen.getByLabelText("身分證正面檔案（上限 4MB）")).toBeEnabled());
    expandForms();
    const identity = within(screen.getByRole("article", { name: "身分證正面" }));
    fireEvent.change(screen.getByLabelText("身分證正面檔案（上限 4MB）"), { target: { files: [new File(["synthetic"], "wrong.svg", { type: "image/svg+xml" })] } });
    expect(identity.getByRole("alert")).toHaveTextContent("只接受 PDF、JPEG 或 PNG");
    expect(identity.getByRole("button", { name: "上傳附件" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("身分證正面檔案（上限 4MB）"), { target: { files: [new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })] } });
    expect(identity.getByRole("alert")).toHaveTextContent("不超過 4MB");
    expect(identity.getByRole("button", { name: "上傳附件" })).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps upload disabled when the scanner is unavailable and never sends demo files", async () => {
    const unavailable = liveRead(); unavailable.data.uploadConfigured = false;
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(unavailable)); vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<ClientDocumentsWorkspace {...props} />);
    expect(await screen.findByText(/附件安全檢查服務尚未完成設定/)).toBeVisible();
    expandForms();
    expect(screen.getAllByRole("button", { name: "上傳附件" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    rerender(<ClientDocumentsWorkspace {...props} clientId="c1600000-0000-4000-8000-000000000099" demo />);
    expect(screen.getAllByRole("button", { name: "上傳附件" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
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
    fireEvent.click(identity.getByRole("button", { name: "重試確認原次上傳" }));
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
  it("freezes an uncertain category review and retries the immutable original body and key", async () => {
    const verified = liveRead();
    Object.assign(verified.data.snapshot.rows.find((row) => row.category === "medication_bag")!, {
      reviewVersion: 1, status: "not_applicable", categoryReviewDecision: "not_applicable", reviewReason: "合成不適用原因",
    });
    const receipt = { clientId: props.clientId, category: "medication_bag", reviewVersion: 1, decision: "not_applicable", persisted: true, replayed: true };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(liveRead()))
      .mockRejectedValueOnce(new DOMException("The operation timed out", "TimeoutError"))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { receipt } }))
      .mockResolvedValueOnce(Response.json(verified));
    vi.stubGlobal("fetch", fetch); const onUnknown = vi.fn();
    render(<ClientDocumentsWorkspace {...props} onUnknown={onUnknown} />);
    await waitFor(() => expect(screen.getByLabelText("藥袋處置")).toBeEnabled()); expandForms();
    fireEvent.change(screen.getByLabelText("藥袋處置"), { target: { value: "not_applicable" } });
    fireEvent.change(screen.getByLabelText("藥袋覆核／不適用理由"), { target: { value: "合成不適用原因" } });
    const bag = within(screen.getByRole("article", { name: "藥袋" }));
    fireEvent.click(bag.getByRole("button", { name: "儲存文件處置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("原次文件處置結果尚未確認");
    expect(onUnknown).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText("藥袋處置")).toBeDisabled();
    expect(screen.getByLabelText("藥袋覆核／不適用理由")).toBeDisabled();
    expect(screen.getByLabelText("身分證正面院所／開立單位")).toBeDisabled();
    expect(within(screen.getByRole("article", { name: "身分證正面" })).getByRole("button", { name: "儲存文件處置" })).toBeDisabled();
    expect(bag.getByRole("button", { name: "重試確認原次文件處置" })).toBeEnabled();
    fireEvent.click(bag.getByRole("button", { name: "重試確認原次文件處置" }));
    expect(await screen.findByText(/文件處置已儲存並重新讀回/)).toBeVisible();
    const original = fetch.mock.calls[1][1].body as string;
    const retried = fetch.mock.calls[2][1].body as string;
    expect(retried).toBe(original);
    expect(JSON.parse(retried)).toMatchObject({ category: "medication_bag", expectedDocumentVersion: 0, expectedReviewVersion: 0,
      decision: "not_applicable", reason: "合成不適用原因", idempotency_key: JSON.parse(original).idempotency_key });
    await waitFor(() => expect(onUnknown).toHaveBeenLastCalledWith(false));
    expect(screen.getByLabelText("藥袋處置")).toBeEnabled();
  });
  it("resolves an uncertain category review from exact authoritative readback without another PATCH", async () => {
    const verified = liveRead();
    Object.assign(verified.data.snapshot.rows.find((row) => row.category === "medication_bag")!, {
      reviewVersion: 1, status: "reviewed", categoryReviewDecision: "not_applicable", reviewReason: "合成不適用原因",
    });
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(liveRead()))
      .mockRejectedValueOnce(new DOMException("The operation timed out", "TimeoutError"))
      .mockResolvedValueOnce(Response.json(verified));
    vi.stubGlobal("fetch", fetch); const onUnknown = vi.fn();
    render(<ClientDocumentsWorkspace {...props} onUnknown={onUnknown} />);
    await waitFor(() => expect(screen.getByLabelText("藥袋處置")).toBeEnabled()); expandForms();
    fireEvent.change(screen.getByLabelText("藥袋處置"), { target: { value: "not_applicable" } });
    fireEvent.change(screen.getByLabelText("藥袋覆核／不適用理由"), { target: { value: "合成不適用原因" } });
    fireEvent.click(within(screen.getByRole("article", { name: "藥袋" })).getByRole("button", { name: "儲存文件處置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("原次文件處置結果尚未確認");
    fireEvent.click(screen.getByRole("button", { name: "讀回核對原次處置" }));
    expect(await screen.findByText(/已重新讀回原次文件處置/)).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.filter((call) => call[1]?.method === "PATCH")).toHaveLength(1);
    await waitFor(() => expect(onUnknown).toHaveBeenLastCalledWith(false));
    expect(screen.getByLabelText("藥袋處置")).toBeEnabled();
  });
  it("does not release an earlier uncertain review after a later conflict or mismatched readback", async () => {
    const changedByAnother = liveRead();
    Object.assign(changedByAnother.data.snapshot.rows.find((row) => row.category === "medication_bag")!, {
      reviewVersion: 1, status: "reviewed", categoryReviewDecision: "reviewed", reviewReason: "不同的覆核內容",
    });
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(liveRead()))
      .mockRejectedValueOnce(new DOMException("The operation timed out", "TimeoutError"))
      .mockResolvedValueOnce(Response.json({ status: "error", errors: [{ message: "版本已變更" }] }, { status: 409 }))
      .mockResolvedValueOnce(Response.json(changedByAnother));
    vi.stubGlobal("fetch", fetch); const onUnknown = vi.fn();
    render(<ClientDocumentsWorkspace {...props} onUnknown={onUnknown} />);
    await waitFor(() => expect(screen.getByLabelText("藥袋處置")).toBeEnabled()); expandForms();
    fireEvent.change(screen.getByLabelText("藥袋處置"), { target: { value: "not_applicable" } });
    fireEvent.change(screen.getByLabelText("藥袋覆核／不適用理由"), { target: { value: "合成不適用原因" } });
    const bag = within(screen.getByRole("article", { name: "藥袋" }));
    fireEvent.click(bag.getByRole("button", { name: "儲存文件處置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("原次文件處置結果尚未確認");
    fireEvent.click(bag.getByRole("button", { name: "重試確認原次文件處置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("原次文件處置結果尚未確認");
    expect(fetch.mock.calls[2][1].body).toBe(fetch.mock.calls[1][1].body);
    fireEvent.click(screen.getByRole("button", { name: "讀回核對原次處置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("原次文件處置尚未核對一致");
    expect(screen.getByLabelText("藥袋處置")).toBeDisabled();
    expect(bag.getByRole("button", { name: "重試確認原次文件處置" })).toBeEnabled();
    expect(onUnknown).toHaveBeenLastCalledWith(true);
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
