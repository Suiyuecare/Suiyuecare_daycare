// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Link from "next/link";
import { AttendanceComposer } from "./attendance-composer";
import { VitalSignComposer } from "./vital-sign-composer";
import { CareDiaryComposer } from "./care-diary-composer";
import { clearUnsavedChangesOnLogout, requestUnsavedExit } from "@/lib/navigation/unsaved-changes";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() {
    if (document.querySelector("dialog[open]")) throw new Error("A second modal opened before the editor closed");
    this.setAttribute("open", "");
  } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const clients = [
  { id: "a1111111-1111-4111-8111-111111111111", name: "合成個案甲", code: "SYN-01", attendance: null },
  { id: "a2222222-2222-4222-8222-222222222222", name: "合成個案乙", code: "SYN-02", attendance: null },
];
const selectedClientId = clients[1]!.id;
const date = "2026-09-10";

describe("care diary shift continuation", () => {
  it.each(["morning", "afternoon", "full_day"] as const)("uses selected %s in the actual draft payload", async (shift) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 503 })); vi.stubGlobal("fetch", fetchMock);
    render(<CareDiaryComposer clients={clients} serviceDate={date} selectedClientId={selectedClientId} selectedShift={shift} enabled demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "新增日誌草稿" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("班別 *")).toHaveValue(shift);
    fireEvent.change(within(dialog).getByLabelText("發生日期與時間 *"), { target: { value: `${date}T${shift === "afternoon" ? "13:00" : "09:00"}` } });
    fireEvent.change(within(dialog).getByLabelText("照顧項目 *"), { target: { value: "合成班別觀察" } });
    fireEvent.submit(dialog.querySelector("form")!); await within(dialog).findByRole("alert");
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).data.shift).toBe(shift);
  });
  it("does not silently replace an invalid shift with a full day", () => {
    render(<CareDiaryComposer clients={clients} serviceDate={date} selectedClientId={selectedClientId} selectedShift={"night" as "morning"} enabled demo={false} />);
    expect(screen.getByRole("button", { name: "新增日誌草稿" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("不會自動改成全日");
  });
  it("requires a deliberate shift when the page has no confirmed shift", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 503 })); vi.stubGlobal("fetch", fetchMock);
    render(<CareDiaryComposer clients={clients} serviceDate={date} selectedClientId={selectedClientId} enabled demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "新增日誌草稿" }));
    const dialog = screen.getByRole("dialog");
    const shift = within(dialog).getByLabelText("班別 *");
    expect(shift).toHaveValue("");
    fireEvent.change(within(dialog).getByLabelText("照顧項目 *"), { target: { value: "合成全日觀察" } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(shift).toHaveFocus();
    expect(shift).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(shift, { target: { value: "full_day" } });
    fireEvent.change(within(dialog).getByLabelText("發生日期與時間 *"), { target: { value: `${date}T09:00` } });
    fireEvent.submit(dialog.querySelector("form")!);
    await within(dialog).findByRole("alert");
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).data.shift).toBe("full_day");
  });
  it("does not invent a time for a past service day or the opposite shift", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-02T05:00:00Z"));
    render(<CareDiaryComposer clients={clients} serviceDate={date} selectedClientId={selectedClientId} selectedShift="morning" enabled demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "新增日誌草稿" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("發生日期與時間 *")).toHaveValue("");
  });
  it("keeps an opposite-shift event local until the actual time is corrected", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 503 })); vi.stubGlobal("fetch", fetchMock);
    render(<CareDiaryComposer clients={clients} serviceDate={date} selectedClientId={selectedClientId} selectedShift="morning" enabled demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "新增日誌草稿" }));
    const dialog = screen.getByRole("dialog"); const form = dialog.querySelector("form")!;
    const time = within(dialog).getByLabelText("發生日期與時間 *");
    fireEvent.change(time, { target: { value: `${date}T13:00` } });
    fireEvent.change(within(dialog).getByLabelText("照顧項目 *"), { target: { value: "合成班別觀察" } });
    fireEvent.submit(form);
    expect(time).toHaveFocus(); expect(time).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("上午班請填 12:00 前");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(time, { target: { value: `${date}T11:00` } });
    fireEvent.submit(form); await within(dialog).findByRole("alert");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("does not reset the diary shift or fields when confirmation is cancelled", () => {
    const spec = specs[2]; mount(spec.kind); const { dialog, field } = open(spec);
    fireEvent.change(within(dialog).getByLabelText("班別 *"), { target: { value: "afternoon" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    expect(within(dialog).getByLabelText("班別 *")).toHaveValue("afternoon"); expect(field).toHaveValue(spec.value);
  });
});
const specs = [
  { kind: "attendance", trigger: "登錄出勤", field: /補登理由/u, value: "合成補登原因", time: "事件日期與時間 *", endpoint: "/api/attendance" },
  { kind: "vitals", trigger: "新增量測", field: "脈搏 bpm", value: "75", time: "量測日期與時間 *", endpoint: "/api/measurements" },
  { kind: "diary", trigger: "新增日誌草稿", field: "照顧項目 *", value: "合成活動觀察", time: "發生日期與時間 *", endpoint: "/api/records" },
] as const;

function mount(kind: string, selected: string | undefined = selectedClientId) {
  const props = { clients, serviceDate: date, enabled: true, demo: false, selectedClientId: selected };
  return render(<>{kind === "attendance" ? <AttendanceComposer {...props} /> : kind === "vitals" ? <VitalSignComposer {...props} /> : <CareDiaryComposer {...props} />}
    <Link href="/app/dashboard" prefetch={false} onClick={(event) => event.preventDefault()}>離開工作頁</Link>
    <form noValidate method="get" onSubmit={(event) => event.preventDefault()}><button>切換服務日</button></form></>);
}
function open(spec: typeof specs[number]) {
  fireEvent.click(screen.getByRole("button", { name: spec.trigger }));
  const dialog = screen.getByRole("dialog");
  const form = dialog.querySelector("form")!;
  const field = within(dialog).getByLabelText(spec.field);
  fireEvent.change(field, { target: { value: spec.value } });
  if (spec.kind === "diary") fireEvent.change(within(dialog).getByLabelText("班別 *"), { target: { value: "full_day" } });
  fireEvent.change(within(dialog).getByLabelText(spec.time), { target: { value: `${date}T09:10` } });
  return { dialog, form, field };
}
function selectedClientControl(dialog: HTMLElement, kind: typeof specs[number]["kind"]): HTMLInputElement | HTMLSelectElement {
  if (kind !== "diary") return within(dialog).getByLabelText("個案 *") as HTMLSelectElement;
  const control = dialog.querySelector<HTMLInputElement>('input[name="client_id"]');
  if (!control) throw new Error("Selected diary client is missing from the form");
  return control;
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
    expect(selectedClientControl(dialog, spec.kind)).toHaveValue(selectedClientId);
    if (spec.kind === "diary") {
      expect(within(dialog).getByRole("group", { name: "已選定個案" })).toHaveTextContent("合成個案乙");
      expect(within(dialog).queryByRole("combobox", { name: "個案 *" })).not.toBeInTheDocument();
    }
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
  it("suspends the editor for Cancel, Escape and backdrop confirmation without losing input", () => {
    const confirm = vi.spyOn(window, "confirm");
    mount(spec.kind);
    const { dialog, field, form } = open(spec);
    for (const method of ["cancel", "escape", "backdrop"]) {
      if (method === "cancel") fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
      else if (method === "escape") fireEvent(dialog, new Event("cancel", { cancelable: true }));
      else fireEvent.click(dialog);
      const confirmation = screen.getByRole("dialog", { name: "尚有未保存內容" });
      expect(dialog).not.toHaveAttribute("open"); expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
      expect(form.isConnected).toBe(true); expect(field).toHaveValue(spec.kind === "vitals" ? 75 : spec.value);
      expect(document.activeElement).toBe(within(confirmation).getByRole("button", { name: "繼續填寫" }));
      if (method === "cancel") fireEvent.click(within(confirmation).getByRole("button", { name: "繼續填寫" }));
      else if (method === "escape") fireEvent.keyDown(confirmation, { key: "Escape" });
      else fireEvent.click(confirmation);
      expect(dialog).toHaveAttribute("open"); expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
      expect(dialog.querySelector("form")).toBe(form);
      expect(within(dialog).getByLabelText(spec.time)).toHaveValue(`${date}T09:10`);
      expect(field).toHaveValue(spec.kind === "vitals" ? 75 : spec.value);
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "取消" }));
    }
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "捨棄填寫並繼續" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: spec.trigger }));
    expect(selectedClientControl(dialog, spec.kind)).toHaveValue(selectedClientId);
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
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
  it("does not discard an unknown operation after hiding its editor or through GET/header navigation", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("", { status: 503 })));
    vi.stubGlobal("fetch", fetchMock); mount(spec.kind);
    const { dialog, form } = open(spec); fireEvent.submit(form); await within(dialog).findByRole("alert");
    fireEvent.click(within(dialog).getByRole("button", { name: "稍後處理" }));
    const linkClick = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    act(() => screen.getByRole("link", { name: "離開工作頁" }).dispatchEvent(linkClick));
    expect(linkClick.defaultPrevented).toBe(true); expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "切換服務日" }));
    const refresh = vi.fn(); act(() => expect(requestUnsavedExit(refresh)).toBe(true));
    expect(refresh).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "捨棄填寫並繼續" })).toBeNull();
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: spec.trigger })); fireEvent.submit(form); await within(dialog).findByRole("alert");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ body: (fetchMock.mock.calls[0]![1] as RequestInit).body,
      headers: (fetchMock.mock.calls[0]![1] as RequestInit).headers });
  });
  it("unconditional logout clears the unsent owner and queued modal without confirmation", () => {
    const confirm = vi.spyOn(window, "confirm"); mount(spec.kind);
    const { dialog } = open(spec); fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    const oldConfirm = screen.getByRole("button", { name: "捨棄填寫並繼續" });
    act(() => clearUnsavedChangesOnLogout());
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(0); fireEvent.click(oldConfirm);
    expect(confirm).not.toHaveBeenCalled(); expect(requestUnsavedExit(vi.fn())).toBe(false);
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
    const control = selectedClientControl(dialog, spec.kind);
    const unauthorized = "a9999999-9999-4999-8999-999999999999";
    if (control instanceof HTMLSelectElement) control.add(new Option("合成未授權個案", unauthorized));
    control.value = unauthorized;
    fireEvent.submit(form);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("請重新選擇目前授權的個案");
  });
});

it("does not let a fixed diary selection be silently replaced by another authorized client", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mount("diary");
  const { dialog, form } = open(specs[2]);
  const control = selectedClientControl(dialog, "diary");
  control.value = clients[0]!.id;
  fireEvent.submit(form);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(within(dialog).getByRole("alert")).toHaveTextContent("請重新選擇目前授權的個案");
});
