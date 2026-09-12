// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AttendanceComposer } from "./attendance-composer";
import { VitalSignComposer } from "./vital-sign-composer";
import { CareDiaryComposer } from "./care-diary-composer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const clients = [
  { id: "a1111111-1111-4111-8111-111111111111", name: "合成個案甲", code: "SYN-01", attendance: null },
  { id: "a2222222-2222-4222-8222-222222222222", name: "合成個案乙", code: "SYN-02", attendance: null },
];
const selectedClientId = clients[1]!.id;
const date = "2026-09-10";
const specs = [
  { kind: "attendance", trigger: "登錄出勤", field: /補登理由/u, value: "合成補登原因", time: "事件日期與時間 *", endpoint: "/api/attendance" },
  { kind: "vitals", trigger: "新增量測", field: "脈搏 bpm", value: "75", time: "量測日期與時間 *", endpoint: "/api/measurements" },
  { kind: "diary", trigger: "新增日誌草稿", field: "照顧項目 *", value: "合成活動觀察", time: "發生日期與時間 *", endpoint: "/api/records" },
] as const;

function mount(kind: string, selected: string | undefined = selectedClientId) {
  const props = { clients, serviceDate: date, enabled: true, demo: false, selectedClientId: selected };
  render(kind === "attendance" ? <AttendanceComposer {...props} /> : kind === "vitals" ? <VitalSignComposer {...props} /> : <CareDiaryComposer {...props} />);
}
function open(spec: typeof specs[number]) {
  fireEvent.click(screen.getByRole("button", { name: spec.trigger }));
  const dialog = screen.getByRole("dialog");
  const form = dialog.querySelector("form")!;
  const field = within(dialog).getByLabelText(spec.field);
  fireEvent.change(field, { target: { value: spec.value } });
  fireEvent.change(within(dialog).getByLabelText(spec.time), { target: { value: `${date}T09:10` } });
  return { dialog, form, field };
}
function successfulResponse(spec: typeof specs[number], init: RequestInit) {
  const body = JSON.parse(String(init.body)) as { client_id: string; occurred_at: string; event_kind: string };
  if (spec.kind !== "attendance") return new Response(JSON.stringify({
    requestId: "d1111111-1111-4111-8111-111111111111", status: "ok", errors: [],
    data: { demo: false, persisted: true, replayed: false,
      ...(spec.kind === "vitals" ? { recordCount: 1, measurementKinds: ["pulse"] }
        : { record: { id: "synthetic-diary", version: 1, status: "draft" }, page: { slug: "staff/daily-care/care-diary" } }),
    },
  }), { status: 201 });
  return new Response(JSON.stringify({
    requestId: "d1111111-1111-4111-8111-111111111111", status: "ok", errors: [],
    data: { replayed: false, persisted: true, demo: false, operation: {
      id: "d2222222-2222-4222-8222-222222222222", attendanceId: "d3333333-3333-4333-8333-333333333333",
      clientId: body.client_id, eventKind: body.event_kind, occurredAt: body.occurred_at,
      serviceDate: date, status: "present", checkedInAt: body.occurred_at, checkedOutAt: null, source: "staff_backfill",
    } },
  }), { status: 201 });
}

describe.each(specs)("$kind selected-client composer safeguards", (spec) => {
  it("preserves the exact selected person and date in the API payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    mount(spec.kind);
    const { dialog, form } = open(spec);
    expect(within(dialog).getByLabelText("個案 *")).toHaveValue(selectedClientId);
    fireEvent.submit(form);
    await within(dialog).findByRole("alert");
    expect(fetchMock.mock.calls[0]![0]).toBe(spec.endpoint);
    const payload = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(payload.client_id).toBe(selectedClientId);
    expect(payload.measured_at ?? payload.occurred_at).toBe("2026-09-10T01:10:00.000Z");
  });
  it("does not silently use the first person when no selection was provided", () => {
    const props = { clients, serviceDate: date, enabled: true, demo: false };
    render(spec.kind === "attendance" ? <AttendanceComposer {...props} /> : spec.kind === "vitals" ? <VitalSignComposer {...props} /> : <CareDiaryComposer {...props} />);
    fireEvent.click(screen.getByRole("button", { name: spec.trigger }));
    expect(within(screen.getByRole("dialog")).getByLabelText("個案 *")).toHaveValue("");
  });
  it("blocks an unavailable selected person instead of using another authorized person", () => {
    mount(spec.kind, "a9999999-9999-4999-8999-999999999999");
    expect(screen.getByRole("button", { name: spec.trigger })).toBeDisabled();
    expect(screen.getByText(/不會自動改為其他個案/u)).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("keeps values after rejecting Cancel, Escape and backdrop discard; accepting resets on reopen", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mount(spec.kind);
    const { dialog, field } = open(spec);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(dialog);
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(dialog).toHaveAttribute("open");
    expect(field).toHaveValue(spec.kind === "vitals" ? 75 : spec.value);
    confirm.mockReturnValue(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(dialog).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: spec.trigger }));
    expect(within(dialog).getByLabelText("個案 *")).toHaveValue(selectedClientId);
    expect(field).toHaveValue(spec.kind === "vitals" ? null : "");
  });
  it("freezes the same body and key after an uncertain result, even on attempted edits", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("", { status: 503 })));
    vi.stubGlobal("fetch", fetchMock);
    mount(spec.kind);
    const { dialog, form, field } = open(spec);
    fireEvent.submit(form);
    await within(dialog).findByRole("alert");
    fireEvent.submit(form);
    await within(dialog).findByRole("alert");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = () => fetchMock.mock.calls.map((call) => ((call[1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"]);
    expect(keys()[1]).toBe(keys()[0]);
    expect(field).toBeDisabled();
    fireEvent.change(field, { target: { value: spec.kind === "vitals" ? "76" : "更正合成內容" } });
    fireEvent.submit(form);
    await within(dialog).findByRole("alert");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(keys()[2]).toBe(keys()[1]);
    expect((fetchMock.mock.calls[2]![1] as RequestInit).body).toBe((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(dialog).toHaveAttribute("open");
  });
  it("blocks duplicate submit, edit and cancellation during a pending write, then releases the draft", async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    mount(spec.kind);
    const { dialog, form, field } = open(spec);
    fireEvent.submit(form);
    expect(field).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    fireEvent.submit(form);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute("open");
    await act(async () => resolve(successfulResponse(spec, fetchMock.mock.calls[0]![1] as RequestInit)));
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
  it("server commit then lost response, close/reopen and attempted edit still retries one exact operation", async () => {
    const committed = new Map<string, string>();
    let first = true;
    const fetchMock = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)["Idempotency-Key"]!;
      const body = String(init.body);
      if (committed.has(key)) expect(body).toBe(committed.get(key)); else committed.set(key, body);
      if (first) { first = false; throw new DOMException("Response lost after commit", "TimeoutError"); }
      const receipt = await successfulResponse(spec, init).json();
      receipt.data.replayed = true;
      return new Response(JSON.stringify(receipt), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock); mount(spec.kind);
    const { dialog, form, field } = open(spec);
    fireEvent.submit(form); await within(dialog).findByRole("alert");
    expect(field).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "稍後處理" }));
    expect(dialog).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: spec.trigger }));
    expect(field).toBeDisabled();
    fireEvent.change(field, { target: { value: spec.kind === "vitals" ? "99" : "不得另存" } });
    fireEvent.submit(form);
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(committed.size).toBe(1);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).body).toBe((fetchMock.mock.calls[0]![1] as RequestInit).body);
  });
  it("permits correcting the first definite validation rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: "synthetic-request", status: "error", data: null, errors: [{ code: "INVALID_FIELDS", message: "請檢查欄位" }] }), { status: 422 }))); mount(spec.kind);
    const { dialog, form, field } = open(spec); fireEvent.submit(form); await within(dialog).findByRole("alert");
    expect(field).toBeEnabled();
  });
  it("later validation rejection cannot unlock an earlier unknown attempt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("Network lost")).mockResolvedValueOnce(new Response(JSON.stringify({ requestId: "synthetic-request", status: "error", data: null, errors: [{ code: "INVALID_FIELDS", message: "請檢查欄位" }] }), { status: 422 }))); mount(spec.kind);
    const { dialog, form, field } = open(spec); fireEvent.submit(form); await within(dialog).findByRole("alert");
    fireEvent.submit(form); await within(dialog).findByRole("alert"); expect(field).toBeDisabled();
  });
  it("bare intermediary 400 cannot unlock a potentially committed operation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Bad request</html>", { status: 400 }))); mount(spec.kind);
    const { dialog, form, field } = open(spec); fireEvent.submit(form); await within(dialog).findByRole("alert"); expect(field).toBeDisabled();
  });
});

describe.each(specs.filter((spec) => spec.kind !== "attendance"))("$kind forged local selection", (spec) => {
  it.each(["missing-body", "invalid-json", "wrong-mode", "wrong-result"])("keeps the form and retry key for HTTP 200 %s", async (failure) => {
    const data = { demo: false, persisted: true, replayed: true,
      ...(spec.kind === "vitals" ? { recordCount: 1, measurementKinds: ["pulse"] }
        : { record: { id: "synthetic-diary", version: 1, status: "draft" }, page: { slug: "staff/daily-care/care-diary" } }),
    };
    if (failure === "wrong-mode") Object.assign(data, { demo: true, persisted: false, replayed: false });
    if (failure === "wrong-result") Object.assign(data, spec.kind === "vitals"
      ? { recordCount: 2 } : { record: { id: "", version: 1, status: "draft" } });
    const body = failure === "missing-body" ? "" : failure === "invalid-json" ? "{broken"
      : JSON.stringify({ requestId: "synthetic-request", status: "ok", errors: [], data });
    const responses: Response[] = [];
    const fetchMock = vi.fn().mockImplementation(() => {
      const response = new Response(body, { status: 200 });
      responses.push(response);
      return Promise.resolve(response);
    });
    vi.stubGlobal("fetch", fetchMock);
    mount(spec.kind);
    const { dialog, form, field } = open(spec);
    fireEvent.submit(form);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("結果未知");
    expect(dialog).toHaveAttribute("open");
    expect(field).toHaveValue(spec.kind === "vitals" ? 75 : spec.value);
    expect(responses[0]!.bodyUsed).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("結果尚未確認");
    fireEvent.submit(form);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("結果未知");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(second["Idempotency-Key"]).toBe(first["Idempotency-Key"]);
  });
  it("does not issue a request for a DOM-injected unauthorized client option", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mount(spec.kind);
    const { dialog, form } = open(spec);
    const select = within(dialog).getByLabelText("個案 *") as HTMLSelectElement;
    const option = new Option("合成未授權個案", "a9999999-9999-4999-8999-999999999999");
    select.add(option);
    select.value = option.value;
    fireEvent.submit(form);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("請重新選擇目前授權的個案");
  });
});
