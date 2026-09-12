// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CareDiaryLifecycle } from "./care-diary-lifecycle";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const id = "b0100000-0000-4000-8000-000000000001";
const nextId = "b0100000-0000-4000-8000-000000000002";
const record = { id, record_key: id, version: 1, client_id: id, status: "draft", occurred_at: "2026-09-12T01:00:00Z", fields: { shift: "morning", care_item: "本次照顧", note: "合成觀察", abnormal: false }, previous_version_id: null, correction_reason: null, signed_at: null, signed_by: null, content_hash: null, created_by: id, created_at: "2026-09-12T01:05:00Z", correction_source_id: null };
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
    const submitted = { ...record, status: "submitted" };
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
});
