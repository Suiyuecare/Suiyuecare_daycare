// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
function confirm(name = "確認提交") { fireEvent.click(screen.getByRole("button", { name })); }
const dialogMethods = ["showModal", "close"] as const;
const originalDialogMethods = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  dialogMethods.forEach((name, index) => { const descriptor = originalDialogMethods[index]; if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, name); });
});
beforeEach(() => {
  refresh.mockReset(); vi.spyOn(window, "confirm").mockReturnValue(true);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
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
    confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent("回覆版本或簽署狀態不一致");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("does not claim a signature if signer or timestamp is missing", async () => {
    const submitted: DiaryRecord = { ...record, status: "submitted" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(snapshot(submitted)).mockResolvedValueOnce(response({ ...submitted, id: nextId, version: 2, previous_version_id: id, status: "signed" })));
    mount(); fireEvent.click(await screen.findByRole("button", { name: "確認內容並簽署" }));
    confirm("以本人身分簽署");
    expect(await screen.findByRole("alert")).toHaveTextContent("回覆不完整");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("keeps invalid edit values and permits confirmed cancellation", async () => {
    const fetch = vi.fn().mockResolvedValue(snapshot()); vi.stubGlobal("fetch", fetch); mount();
    fireEvent.click(await screen.findByRole("button", { name: "繼續編輯草稿" }));
    const input = screen.getByLabelText("照顧項目"); fireEvent.change(input, { target: { value: " " } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("請填寫照顧項目");
    expect(fetch).toHaveBeenCalledOnce(); expect(input).toHaveValue(" ");
    fireEvent.click(screen.getByRole("button", { name: "取消編輯" }));
    expect(input).toHaveValue(" ");
    confirm("捨棄填寫並繼續");
    expect(window.confirm).not.toHaveBeenCalled(); expect(screen.queryByLabelText("照顧項目")).not.toBeInTheDocument();
  });
  it("keeps a wrong-shift revision unsent and allows full-day for the original event time", async () => {
    let revised: DiaryRecord | null = null;
    const fetch = vi.fn().mockResolvedValueOnce(snapshot())
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { data: DiaryRecord["fields"] };
        revised = { ...record, id: nextId, version: 2, previous_version_id: id, fields: body.data };
        return response(revised);
      })
      .mockImplementationOnce(async () => snapshot(revised!));
    vi.stubGlobal("fetch", fetch); mount();
    fireEvent.click(await screen.findByRole("button", { name: "繼續編輯草稿" }));
    const shift = screen.getByLabelText("班別");
    fireEvent.change(shift, { target: { value: "afternoon" } });
    fireEvent.submit(shift.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("這筆紀錄發生在上午，請選上午或全日");
    expect(shift).toHaveAttribute("aria-invalid", "true");
    expect(shift).toHaveFocus();
    expect(shift).toHaveValue("afternoon");
    expect(fetch).toHaveBeenCalledOnce();
    fireEvent.change(shift, { target: { value: "full_day" } });
    fireEvent.submit(shift.closest("form")!);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const submitted = JSON.parse(String((fetch.mock.calls[1]![1] as RequestInit).body)) as { data: DiaryRecord["fields"] };
    expect(submitted.data.shift).toBe("full_day");
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
    confirm("確認退回草稿");
    await screen.findByRole("button", { name: "重試原操作" });
    expect(reason).toBeDisabled(); expect(reason).toHaveValue("補充觀察");
    expect(screen.getByRole("button", { name: "確認內容並簽署" })).toBeDisabled();
    fireEvent.change(reason, { target: { value: "不能變更原操作" } }); fireEvent.submit(reason.closest("form")!);
    expect(fetch).toHaveBeenCalledTimes(2);
    confirm("重試原操作");
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
    confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent("尚未重新讀回這個版本");
    expect(screen.queryByText("已重新讀回提交版本，仍待簽署，不會計為正式完成。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新讀取" }));
    expect(await screen.findByText("已重新讀回提交版本，仍待簽署，不會計為正式完成。")).toBeVisible();
    expect(fetch.mock.calls.filter((call) => (call[1] as RequestInit)?.method === "POST")).toHaveLength(1);
  });
  it("does not accept an older snapshot as readback of the new version", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(response({ ...record, id: nextId, version: 2, previous_version_id: id, status: "submitted" }))
      .mockResolvedValueOnce(snapshot());
    vi.stubGlobal("fetch", fetch); mount(); fireEvent.click(await screen.findByRole("button", { name: "提交已儲存版本" })); confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent("尚未重新讀回這個版本");
    expect(screen.queryByRole("button", { name: "提交已儲存版本" })).not.toBeInTheDocument();
  });
  it.each(["fields", "time"])("rejects a next-version receipt that silently changes %s", async (mismatch) => {
    const returned = { ...record, id: nextId, version: 2, previous_version_id: id, status: "submitted",
      ...(mismatch === "fields" ? { fields: { ...record.fields, shift: "afternoon" } } : { occurred_at: "2026-09-13T01:00:00Z" }) };
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(response(returned));
    vi.stubGlobal("fetch", fetch); mount(); fireEvent.click(await screen.findByRole("button", { name: "提交已儲存版本" })); confirm();
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
    fireEvent.click(button); fireEvent.click(button); expect(fetch).toHaveBeenCalledOnce();
    const confirmation = screen.getByRole("button", { name: "確認提交" });
    fireEvent.click(confirmation); fireEvent.click(confirmation); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await act(async () => resolveFirst()); fireEvent.click(await screen.findByRole("button", { name: "重試原操作" }));
    await screen.findByText("已重新讀回提交版本，仍待簽署，不會計為正式完成。");
    expect(committed.size).toBe(1); expect(window.confirm).not.toHaveBeenCalled();
  });
  it("does not grant high-risk revisions just because routine writes are allowed", async () => {
    const fetch = vi.fn().mockResolvedValue(snapshot({ ...record, status: "submitted" })); vi.stubGlobal("fetch", fetch);
    render(<CareDiaryLifecycle clientId={id} enabled canSign={false} canRevise={false} demo={false} />);
    expect(await screen.findByRole("button", { name: "退回草稿修訂" })).toBeDisabled();
    const reason = screen.getByLabelText("退回理由"); fireEvent.submit(reason.closest("form")!);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["submit", "sign", "reopen", "correct"] as const)("%s only opens confirmation; cancel/Escape/backdrop preserve zero writes", async (kind) => {
    const row: DiaryRecord = kind === "correct" ? { ...record, status: "signed", signed_at: record.created_at, signed_by: id, content_hash: "a".repeat(64) }
      : kind === "sign" || kind === "reopen" ? { ...record, status: "submitted" } : record;
    const fetch = vi.fn().mockResolvedValue(snapshot(row)); vi.stubGlobal("fetch", fetch); mount();
    const enter = async () => {
      if (kind === "correct" || kind === "reopen") {
        const input = await screen.findByLabelText(kind === "correct" ? "更正理由" : "退回理由");
        fireEvent.change(input, { target: { value: "保留這次核對理由" } }); fireEvent.submit(input.closest("form")!);
      } else fireEvent.click(await screen.findByRole("button", { name: kind === "sign" ? "確認內容並簽署" : "提交已儲存版本" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(/第 1 版/)).toBeVisible();
      expect(within(dialog).getByText(/本次照顧/)).toBeVisible();
      expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();
      expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
      expect(fetch).toHaveBeenCalledOnce(); return dialog;
    };
    const first = await enter(); fireEvent.click(within(first).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const second = await enter(); fireEvent.keyDown(second, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const third = await enter(); fireEvent.click(third, { clientX: 1, clientY: 1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    if (kind === "correct" || kind === "reopen") expect(screen.getByLabelText(kind === "correct" ? "更正理由" : "退回理由")).toHaveValue("保留這次核對理由");
    expect(fetch).toHaveBeenCalledOnce(); expect(window.confirm).not.toHaveBeenCalled();
  });
  it("cancel and Escape of shared unsaved confirmation retain edit fields and key-independent draft", async () => {
    const fetch = vi.fn().mockResolvedValue(snapshot()); vi.stubGlobal("fetch", fetch); mount();
    fireEvent.click(await screen.findByRole("button", { name: "繼續編輯草稿" }));
    const input = screen.getByLabelText("照顧項目"); fireEvent.change(input, { target: { value: "保留尚未送出的修訂" } });
    input.focus();
    fireEvent.click(screen.getByRole("button", { name: "取消編輯" }));
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    expect(input).toHaveValue("保留尚未送出的修訂"); expect(input).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "取消編輯" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(input).toHaveValue("保留尚未送出的修訂"); expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["reopen", "correct"] as const)("%s validates empty reason without native bubbles or writes", async (kind) => {
    const row: DiaryRecord = kind === "correct" ? { ...record, status: "signed", signed_at: record.created_at, signed_by: id, content_hash: "a".repeat(64) } : { ...record, status: "submitted" };
    const fetch = vi.fn().mockResolvedValue(snapshot(row)); vi.stubGlobal("fetch", fetch); mount();
    const input = await screen.findByLabelText(kind === "correct" ? "更正理由" : "退回理由");
    const form = input.closest("form")!; expect(form).toHaveAttribute("novalidate");
    fireEvent.submit(form); expect(input).toHaveFocus(); expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("請填寫"); expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not submit an edit or create reason confirmation during Chinese composition", async () => {
    const fetch = vi.fn().mockResolvedValue(snapshot()); vi.stubGlobal("fetch", fetch); mount();
    fireEvent.click(await screen.findByRole("button", { name: "繼續編輯草稿" }));
    const input = screen.getByLabelText("照顧項目"); const form = input.closest("form")!;
    fireEvent.compositionStart(input); fireEvent.submit(form); expect(fetch).toHaveBeenCalledOnce();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, keyCode: 229 });
    fireEvent(input, enter); expect(enter.defaultPrevented).toBe(true);
    fireEvent.compositionEnd(input); expect(form).toHaveAttribute("novalidate");
  });
  it("forged reason change invalidates the original unsent confirmation instead of posting new content", async () => {
    const fetch = vi.fn().mockResolvedValue(snapshot({ ...record, status: "submitted" })); vi.stubGlobal("fetch", fetch); mount();
    const input = await screen.findByLabelText("退回理由"); fireEvent.change(input, { target: { value: "原核對理由" } });
    fireEvent.submit(input.closest("form")!); fireEvent.change(input, { target: { value: "確認後被換掉" } });
    confirm("確認退回草稿"); expect(fetch).toHaveBeenCalledOnce(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("原內容或權限已變更");
  });
  it("permission ABA cancels an unsent confirmation and stale confirmation cannot POST", async () => {
    const fetch = vi.fn().mockResolvedValue(snapshot()); vi.stubGlobal("fetch", fetch); const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: "提交已儲存版本" }));
    const stale = screen.getByRole("button", { name: "確認提交" });
    view.rerender(<CareDiaryLifecycle clientId={id} enabled={false} canSign demo={false} />);
    view.rerender(<CareDiaryLifecycle clientId={id} enabled canSign demo={false} />);
    fireEvent.click(stale); expect(fetch).toHaveBeenCalledOnce(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("permission ABA aborts pending transport and refuses the old late successful receipt", async () => {
    let resolveWrite!: (value: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveWrite = resolve; }));
    vi.stubGlobal("fetch", fetch); const view = mount(); fireEvent.click(await screen.findByRole("button", { name: "提交已儲存版本" })); confirm();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const signal = (fetch.mock.calls[1]![1] as RequestInit).signal!;
    view.rerender(<CareDiaryLifecycle clientId={id} enabled={false} canSign demo={false} />);
    view.rerender(<CareDiaryLifecycle clientId={id} enabled canSign demo={false} />);
    await act(async () => {}); expect(signal.aborted).toBe(true);
    const late = response({ ...record, id: nextId, version: 2, previous_version_id: id, status: "submitted" }); const decode = vi.spyOn(late, "json");
    await act(async () => resolveWrite(late));
    expect(decode).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "重試原操作" })).toBeEnabled();
  });
  it("new daily source cancels an unsent confirmation without inventing authority or writing", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot()); vi.stubGlobal("fetch", fetch);
    const view = render(<CareDiaryLifecycle clientId={id} clientName="合成個案甲" sourceRevision="source-one" enabled canSign demo={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "提交已儲存版本" }));
    expect(within(screen.getByRole("dialog")).getByText(/合成個案甲的/)).toBeVisible();
    const stale = screen.getByRole("button", { name: "確認提交" });
    view.rerender(<CareDiaryLifecycle clientId={id} clientName="合成個案甲" sourceRevision="source-two" enabled canSign demo={false} />);
    fireEvent.click(stale); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetch.mock.calls.every((call) => (call[1] as RequestInit).method === "GET")).toBe(true); expect(refresh).not.toHaveBeenCalled();
  });
  it("source update preserves an unsent edit's fields and original version instead of silently rebasing", async () => {
    const newVersion: DiaryRecord = { ...record, id: nextId, version: 2, previous_version_id: id, fields: { ...record.fields, care_item: "新來源第二版" } };
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot(newVersion)); vi.stubGlobal("fetch", fetch);
    const view = render(<CareDiaryLifecycle clientId={id} sourceRevision="source-one" enabled canSign demo={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "繼續編輯草稿" }));
    const input = screen.getByLabelText("照顧項目"); fireEvent.change(input, { target: { value: "尚未送出的原版本修訂" } });
    fireEvent.click(screen.getByRole("button", { name: "取消編輯" })); expect(screen.getByRole("dialog")).toBeVisible();
    view.rerender(<CareDiaryLifecycle clientId={id} sourceRevision="source-two" enabled canSign demo={false} />);
    await screen.findByRole("heading", { name: "新來源第二版" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(input).toHaveValue("尚未送出的原版本修訂");
    fireEvent.submit(input.closest("form")!); expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("原內容或權限已變更");
    expect(screen.queryByRole("button", { name: "重試原操作" })).not.toBeInTheDocument();
  });
  it("source update does not clear an already unknown attempt or change its explicit retry body/key", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new TypeError("Lost receipt"))
      .mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new TypeError("Still unknown")); vi.stubGlobal("fetch", fetch);
    const view = render(<CareDiaryLifecycle clientId={id} sourceRevision="source-one" enabled canSign demo={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "提交已儲存版本" })); confirm();
    await screen.findByRole("button", { name: "重試原操作" });
    view.rerender(<CareDiaryLifecycle clientId={id} sourceRevision="source-two" enabled canSign demo={false} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("button", { name: "重試原操作" })); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect((fetch.mock.calls[3]![1] as RequestInit).body).toBe((fetch.mock.calls[1]![1] as RequestInit).body);
    expect((fetch.mock.calls[3]![1] as RequestInit).headers).toEqual((fetch.mock.calls[1]![1] as RequestInit).headers);
    expect(refresh).not.toHaveBeenCalled();
  });
  it("unmount aborts pending transport and a late provider reply cannot refresh", async () => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetch); const view = mount(); fireEvent.click(await screen.findByRole("button", { name: "提交已儲存版本" })); confirm();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); view.unmount();
    expect((fetch.mock.calls[1]![1] as RequestInit).signal?.aborted).toBe(true);
    const late = response({ ...record, id: nextId, version: 2, previous_version_id: id, status: "submitted" }); const json = vi.spyOn(late, "json");
    await act(async () => resolve(late)); expect(json).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
  });
  it.each([401, 403])("explicit %s read denial hides old clinical rows/editor and allows only a fresh manual read", async (status) => {
    const denied = new Response("not a patient payload", { status }); const decode = vi.spyOn(denied, "json");
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(denied).mockResolvedValueOnce(snapshot()); vi.stubGlobal("fetch", fetch);
    const view = render(<CareDiaryLifecycle clientId={id} sourceRevision="before" enabled canSign demo={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "繼續編輯草稿" }));
    const input = screen.getByLabelText("照顧項目"); fireEvent.change(input, { target: { value: "不應在撤权後繼續顯示" } });
    fireEvent.click(screen.getByRole("button", { name: "取消編輯" }));
    view.rerender(<CareDiaryLifecycle clientId={id} sourceRevision="after" enabled canSign demo={false} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("舊內容已隱藏"));
    expect(screen.queryByText("合成觀察")).not.toBeInTheDocument(); expect(screen.queryByLabelText("照顧項目")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "提交已儲存版本" })).not.toBeInTheDocument();
    expect(decode).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "重新讀取" }));
    await screen.findByText("合成觀察"); expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.every((call) => (call[1] as RequestInit).method === "GET")).toBe(true);
    expect(screen.getByRole("button", { name: "提交已儲存版本" })).toBeEnabled();
  });
  it("read denial keeps unknown payload private; successful GET does not resend or replace its key/body", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new TypeError("Unknown write"))
      .mockResolvedValueOnce(new Response(null, { status: 403 })).mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new TypeError("Still unknown")); vi.stubGlobal("fetch", fetch);
    const view = render(<CareDiaryLifecycle clientId={id} sourceRevision="before" enabled canSign demo={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "提交已儲存版本" })); confirm(); await screen.findByRole("button", { name: "重試原操作" });
    view.rerender(<CareDiaryLifecycle clientId={id} sourceRevision="after" enabled canSign demo={false} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("舊內容已隱藏"));
    expect(screen.queryByText("合成觀察")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "重試原操作" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新讀取" })); await screen.findByText("合成觀察");
    expect(fetch).toHaveBeenCalledTimes(4); expect((fetch.mock.calls[3]![1] as RequestInit).method).toBe("GET");
    fireEvent.click(screen.getByRole("button", { name: "重試原操作" })); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
    expect((fetch.mock.calls[4]![1] as RequestInit).body).toBe((fetch.mock.calls[1]![1] as RequestInit).body);
    expect((fetch.mock.calls[4]![1] as RequestInit).headers).toEqual((fetch.mock.calls[1]![1] as RequestInit).headers);
    expect(refresh).not.toHaveBeenCalled();
  });
  it("a pure transport failure retains stale unsent fields readonly and GET recovery does not silently discard them", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new TypeError("Network unavailable")).mockResolvedValueOnce(snapshot()); vi.stubGlobal("fetch", fetch);
    const view = render(<CareDiaryLifecycle clientId={id} sourceRevision="before" enabled canSign demo={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "繼續編輯草稿" }));
    const input = screen.getByLabelText("照顧項目"); fireEvent.change(input, { target: { value: "仍須保留的未送出修訂" } });
    view.rerender(<CareDiaryLifecycle clientId={id} sourceRevision="after" enabled canSign demo={false} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("目前無法載入日誌"));
    expect(input).toHaveValue("仍須保留的未送出修訂"); expect(input).toBeDisabled(); expect(screen.getByText("合成觀察", { selector: "article > p" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("尚未核對最新來源");
    expect(screen.getByRole("button", { name: "儲存草稿修訂" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新讀取" }));
    await waitFor(() => expect(input).toBeEnabled()); expect(input).toHaveValue("仍須保留的未送出修訂");
    expect(fetch).toHaveBeenCalledTimes(3); expect(fetch.mock.calls.every((call) => (call[1] as RequestInit).method === "GET")).toBe(true);
  });
  it.each(["fetch", "json"] as const)("GET %s stalls are bounded; late data cannot populate the old view", async (stage) => {
    vi.useFakeTimers(); let resolve!: (value: unknown) => void;
    const latePayload = { requestId: id, status: "ok", data: { records: [record], history: [], persisted: true, demo: false } };
    const stalled = new Promise((done) => { resolve = done; });
    const late = snapshot(); if (stage === "json") vi.spyOn(late, "json").mockReturnValue(stalled);
    const fetch = vi.fn().mockReturnValue(stage === "fetch" ? stalled : Promise.resolve(late)); vi.stubGlobal("fetch", fetch); mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("目前無法載入日誌"); expect(screen.queryByText("合成觀察")).not.toBeInTheDocument();
    expect((fetch.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
    await act(async () => resolve(stage === "fetch" ? late : latePayload));
    expect(screen.queryByText("合成觀察")).not.toBeInTheDocument(); expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["fetch", "json", "rejection-json"] as const)("POST %s stalls retain original attempt, bound pending, and fence late provider work", async (stage) => {
    let resolve!: (value: unknown) => void; const stalled = new Promise((done) => { resolve = done; });
    const submitted: DiaryRecord = { ...record, id: nextId, version: 2, previous_version_id: id, status: "submitted" };
    const late = response(submitted); const originalJson = vi.spyOn(late, "json");
    if (stage === "json") originalJson.mockReturnValue(stalled);
    if (stage === "rejection-json") {
      Object.defineProperty(late, "status", { value: 422 }); Object.defineProperty(late, "ok", { value: false });
      vi.spyOn(late, "clone").mockReturnValue({ json: () => stalled } as Response);
    }
    const fetch = vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(stage === "fetch" ? stalled : Promise.resolve(late)).mockRejectedValue(new TypeError("Still unavailable"));
    vi.stubGlobal("fetch", fetch); mount(); fireEvent.click(await screen.findByRole("button", { name: "提交已儲存版本" }));
    vi.useFakeTimers(); confirm(); await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("逾時"); expect(screen.getByRole("button", { name: "重試原操作" })).toBeEnabled();
    expect((fetch.mock.calls[1]![1] as RequestInit).signal?.aborted).toBe(true);
    await act(async () => resolve(stage === "fetch" ? late : stage === "json" ? { requestId: id, status: "ok", errors: [], data: { record: submitted, persisted: true, demo: false, replayed: false } } : { requestId: id, status: "error", data: null, errors: [{ code: "INVALID_DIARY_ACTION" }] }));
    if (stage !== "json") expect(originalJson).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => confirm("重試原操作"));
    const first = fetch.mock.calls[1]![1] as RequestInit; const second = fetch.mock.calls[2]![1] as RequestInit;
    expect(second.body).toBe(first.body); expect(second.headers).toEqual(first.headers);
    expect(screen.getByRole("button", { name: "重試原操作" })).toBeEnabled();
  });
});
