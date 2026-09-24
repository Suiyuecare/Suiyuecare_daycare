// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CareDiaryLifecycle } from "./care-diary-lifecycle";
import type { DiaryRecord } from "@/lib/care-diary/schema";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const id = "b0100000-0000-4000-8000-000000000001";
const nextId = "b0100000-0000-4000-8000-000000000002";
const record: DiaryRecord = { id, record_key: id, version: 1, client_id: id, status: "draft", occurred_at: "2026-09-12T01:00:00Z", fields: { shift: "morning", care_item: "本次照顧", note: "合成觀察", abnormal: false }, previous_version_id: null, correction_reason: null, signed_at: null, signed_by: null, content_hash: null, created_by: id, created_at: "2026-09-12T01:05:00Z", correction_source_id: null };
function snapshot(row = record) { return new Response(JSON.stringify({ requestId: id, status: "ok", errors: [], data: { records: [row], history: [], persisted: true, demo: false } })); }
function response(row: unknown) { return new Response(JSON.stringify({ requestId: id, status: "ok", errors: [], data: { record: row, persisted: true, demo: false, replayed: false } }), { status: 201 }); }
function mount() { return render(<CareDiaryLifecycle clientId={id} enabled canSign demo={false} />); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => { refresh.mockReset(); vi.spyOn(window, "confirm").mockReturnValue(true); });
describe("care diary completion UI", () => {
  it("shows read-mode guidance without fetching protected operations", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<CareDiaryLifecycle clientId={id} readEnabled={false} enabled={false} canSign={false} demo={false} />);
    expect(screen.getByRole("heading", { name: "日誌操作目前為查看模式" })).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("unmounts loaded observations when operational access is lost", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()); vi.stubGlobal("fetch", fetch);
    const view = mount(); await screen.findByText("合成觀察");
    view.rerender(<CareDiaryLifecycle clientId={id} readEnabled={false} enabled={false} canSign={false} demo={false} />);
    expect(screen.queryByText("合成觀察")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "日誌操作目前為查看模式" })).toBeVisible();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("rejects a valid-looking snapshot for another client before displaying its observations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(snapshot({ ...record, client_id: nextId }))); mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("目前無法載入日誌");
    expect(screen.queryByText("合成觀察")).not.toBeInTheDocument();
  });
  it("rejects mismatched status even for 2xx next-version receipt", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(response({ ...record, id: nextId, version: 2, previous_version_id: id }));
    vi.stubGlobal("fetch", fetch); mount();
    fireEvent.click(await screen.findByRole("button", { name: "提交已儲存版本" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("回覆版本或簽署狀態不一致");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("does not claim a signature if signer or timestamp is missing", async () => {
    const submitted: DiaryRecord = { ...record, status: "submitted" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(snapshot(submitted)).mockResolvedValueOnce(response({ ...submitted, id: nextId, version: 2, previous_version_id: id, status: "signed" })));
    mount(); fireEvent.click(await screen.findByRole("button", { name: "確認內容並簽署" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("回覆不完整");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("keeps invalid edit values and permits confirmed cancellation", async () => {
    const fetch = vi.fn().mockResolvedValue(snapshot()); vi.stubGlobal("fetch", fetch); mount();
    fireEvent.click(await screen.findByRole("button", { name: "繼續編輯草稿" }));
    const input = screen.getByLabelText("照顧項目"); fireEvent.change(input, { target: { value: " " } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("請確認照顧項目");
    expect(fetch).toHaveBeenCalledOnce(); expect(input).toHaveValue(" ");
    fireEvent.click(screen.getByRole("button", { name: "取消編輯" }));
    expect(window.confirm).toHaveBeenCalled(); expect(screen.queryByLabelText("照顧項目")).not.toBeInTheDocument();
  });
  it("offers returning submitted records to draft without signing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(snapshot({ ...record, status: "submitted" }))); mount();
    expect(await screen.findByRole("button", { name: "退回草稿修訂" })).toBeEnabled();
    expect(screen.getByLabelText("退回理由")).toBeRequired();
  });
  it("does not display previous client's records after changing selection", async () => {
    let resolveSecond!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; })));
    const view = mount(); await screen.findByText("合成觀察");
    view.rerender(<CareDiaryLifecycle clientId={nextId} enabled canSign demo={false} />);
    expect(screen.queryByText("合成觀察")).not.toBeInTheDocument();
    resolveSecond(new Response(JSON.stringify({ requestId: id, status: "ok", errors: [], data: { records: [], history: [], demo: false, persisted: true } })));
    await waitFor(() => expect(screen.getByText(/目前沒有日誌/)).toBeVisible());
  });
  it("locks an uncertain edit and retries the original content/key even after a forged field change", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new TypeError("Lost response after commit"))
      .mockImplementation(() => Promise.reject(new TypeError("Still unavailable")));
    vi.stubGlobal("fetch", fetch); mount();
    fireEvent.click(await screen.findByRole("button", { name: "繼續編輯草稿" }));
    const input = screen.getByLabelText("照顧項目");
    fireEvent.change(input, { target: { value: "需要保留的合成內容" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByRole("button", { name: "重試原操作" });
    expect(input).toHaveValue("需要保留的合成內容"); expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消編輯" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重新讀取" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "不得另送的內容" } });
    fireEvent.click(screen.getByRole("button", { name: "重試原操作" }));
    await screen.findByRole("button", { name: "重試原操作" });
    expect(fetch).toHaveBeenCalledTimes(3);
    const first = fetch.mock.calls[1]![1] as RequestInit;
    const second = fetch.mock.calls[2]![1] as RequestInit;
    expect(second.body).toBe(first.body); expect(second.headers).toEqual(first.headers);
    expect(JSON.parse(String(second.body)).data.care_item).toBe("需要保留的合成內容");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("does not let an uncertain reopen become a signature or a changed reason", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(snapshot({ ...record, status: "submitted" })).mockRejectedValue(new TypeError("Lost response"));
    vi.stubGlobal("fetch", fetch); mount();
    const reason = await screen.findByLabelText("退回理由");
    fireEvent.change(reason, { target: { value: "補充觀察" } }); fireEvent.submit(reason.closest("form")!);
    await screen.findByRole("button", { name: "重試原操作" });
    expect(reason).toBeDisabled(); expect(reason).toHaveValue("補充觀察");
    expect(screen.getByRole("button", { name: "確認內容並簽署" })).toBeDisabled();
    fireEvent.change(reason, { target: { value: "不能變更原操作" } }); fireEvent.submit(reason.closest("form")!);
    await screen.findByRole("button", { name: "重試原操作" });
    expect((fetch.mock.calls[2]![1] as RequestInit).body).toBe((fetch.mock.calls[1]![1] as RequestInit).body);
  });
  it("first structured validation rejection allows correction, but not after an earlier unknown result", async () => {
    const reject = () => new Response(JSON.stringify({ requestId: id, status: "error", data: null, errors: [{ code: "INVALID_DIARY_ACTION", message: "請補齊觀察" }] }), { status: 422 });
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockImplementationOnce(() => Promise.resolve(reject()))
      .mockRejectedValueOnce(new TypeError("Lost response")).mockImplementationOnce(() => Promise.resolve(reject()));
    vi.stubGlobal("fetch", fetch); mount();
    fireEvent.click(await screen.findByRole("button", { name: "繼續編輯草稿" }));
    const input = screen.getByLabelText("照顧項目"); fireEvent.change(input, { target: { value: "合成修訂" } });
    fireEvent.submit(input.closest("form")!); await screen.findByRole("alert");
    expect(input).toBeEnabled(); expect(screen.queryByRole("button", { name: "重試原操作" })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "合成修訂二" } }); fireEvent.submit(input.closest("form")!);
    fireEvent.click(await screen.findByRole("button", { name: "重試原操作" }));
    await screen.findByRole("button", { name: "重試原操作" }); expect(input).toBeDisabled();
  });
  it("requires readback after a valid receipt and never turns a failed read into completed success", async () => {
    const submitted: DiaryRecord = { ...record, id: nextId, version: 2, previous_version_id: id, status: "submitted" };
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(response(submitted))
      .mockRejectedValueOnce(new TypeError("Read unavailable")).mockResolvedValueOnce(snapshot(submitted));
    vi.stubGlobal("fetch", fetch); mount();
    fireEvent.click(await screen.findByRole("button", { name: "提交已儲存版本" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("尚未重新讀回這個版本");
    expect(screen.queryByText("已重新讀回提交版本，仍待簽署，不會計為正式完成。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新讀取" }));
    expect(await screen.findByText("已重新讀回提交版本，仍待簽署，不會計為正式完成。")).toBeVisible();
    expect(fetch.mock.calls.filter((call) => (call[1] as RequestInit)?.method === "POST")).toHaveLength(1);
  });
  it("does not accept an older snapshot as readback of the new version", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(response({ ...record, id: nextId, version: 2, previous_version_id: id, status: "submitted" }))
      .mockResolvedValueOnce(snapshot());
    vi.stubGlobal("fetch", fetch); mount(); fireEvent.click(await screen.findByRole("button", { name: "提交已儲存版本" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("尚未重新讀回這個版本");
    expect(screen.queryByRole("button", { name: "提交已儲存版本" })).not.toBeInTheDocument();
  });
  it.each(["fields", "time"])("rejects a next-version receipt that silently changes %s", async (mismatch) => {
    const returned = { ...record, id: nextId, version: 2, previous_version_id: id, status: "submitted",
      ...(mismatch === "fields" ? { fields: { ...record.fields, shift: "afternoon" } } : { occurred_at: "2026-09-13T01:00:00Z" }) };
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(response(returned));
    vi.stubGlobal("fetch", fetch); mount(); fireEvent.click(await screen.findByRole("button", { name: "提交已儲存版本" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("回覆內容或發生時間與原操作不一致");
    expect(screen.getByRole("button", { name: "重試原操作" })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("blocks duplicate pending mutations and accepts only one exact replay after a lost response", async () => {
    const committed = new Map<string, string>();
    const submitted: DiaryRecord = { ...record, id: nextId, version: 2, previous_version_id: id, status: "submitted" };
    let resolveFirst!: () => void;
    const fetch = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      if (init.method !== "POST") return snapshot(committed.size ? submitted : record);
      const key = (init.headers as Record<string, string>)["Idempotency-Key"]!;
      const body = String(init.body);
      if (!committed.size) {
        committed.set(key, body);
        await new Promise<void>((resolve) => { resolveFirst = resolve; });
        throw new TypeError("Lost after commit");
      }
      expect(committed.get(key)).toBe(body);
      return new Response(JSON.stringify({ requestId: id, status: "ok", errors: [], data: { record: submitted, persisted: true, demo: false, replayed: true } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch); mount();
    const button = await screen.findByRole("button", { name: "提交已儲存版本" });
    fireEvent.click(button); fireEvent.click(button); expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => resolveFirst()); fireEvent.click(await screen.findByRole("button", { name: "重試原操作" }));
    await screen.findByText("已重新讀回提交版本，仍待簽署，不會計為正式完成。");
    expect(committed.size).toBe(1); expect(window.confirm).toHaveBeenCalledOnce();
  });
  it("does not grant high-risk revisions just because routine writes are allowed", async () => {
    const fetch = vi.fn().mockResolvedValue(snapshot({ ...record, status: "submitted" })); vi.stubGlobal("fetch", fetch);
    render(<CareDiaryLifecycle clientId={id} enabled canSign={false} canRevise={false} demo={false} />);
    expect(await screen.findByRole("button", { name: "退回草稿修訂" })).toBeDisabled();
    const reason = screen.getByLabelText("退回理由"); fireEvent.submit(reason.closest("form")!);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
