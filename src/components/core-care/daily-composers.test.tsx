// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AttendanceComposer } from "./attendance-composer";
import { VitalSignComposer } from "./vital-sign-composer";
import { CareDiaryComposer } from "./care-diary-composer";
import { CoreDraftGuardHost } from "@/components/app/core-draft-guard";
import { taipeiServiceDateOf } from "@/lib/core-care/date";

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

describe("care diary shift continuation", () => {
  it("lets a caregiver record observations without repeating the same item in free text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 503 })); vi.stubGlobal("fetch", fetchMock);
    render(<CareDiaryComposer clients={clients} serviceDate={date} selectedClientId={selectedClientId} selectedShift="morning" enabled demo={false} caregiverMode />);
    fireEvent.click(screen.getByRole("button", { name: "新增照顧紀錄" }));
    const dialog = screen.getByRole("dialog", { name: "記錄照顧" });
    const form = dialog.querySelector("form")!;
    expect(within(dialog).getByText("先存草稿，確認並簽署後才完成；異常標記僅供人工確認。")).toBeVisible();
    const observation = within(dialog).getByRole("group", { name: "本次觀察（選填）" });
    expect(within(dialog).queryByLabelText("照顧項目 *")).not.toBeInTheDocument();
    expect((form.elements.namedItem("care_item") as HTMLInputElement).value).toBe("日常照顧觀察");
    expect(within(dialog).getByText("本次照顧個案")).toBeVisible();
    expect(within(dialog).getByText("合成個案乙（SYN-02）")).toBeVisible();
    expect((form.elements.namedItem("client_id") as HTMLSelectElement).value).toBe(selectedClientId);
    expect(within(dialog).getByLabelText("班別 *")).toHaveValue("morning");
    expect(within(dialog).getByLabelText("發生日期與時間 *")).toBeRequired();
    fireEvent.change(within(observation).getByRole("spinbutton"), { target: { value: "120" } });
    fireEvent.submit(form); await within(dialog).findByRole("alert");
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.data).toMatchObject({ shift: "morning", care_item: "日常照顧觀察", observations: {
      water: { state: "observed", value: 120 }, toileting: { state: "unknown" },
      activity: { state: "unknown" }, meal: { state: "unknown" },
    } });
  });
  it("keeps a selected caregiver case locked even if another authorized option is injected locally", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<CareDiaryComposer clients={clients} serviceDate={date} selectedClientId={selectedClientId} selectedShift="morning" enabled demo={false} caregiverMode />);
    fireEvent.click(screen.getByRole("button", { name: "新增照顧紀錄" }));
    const dialog = screen.getByRole("dialog", { name: "記錄照顧" });
    const form = dialog.querySelector("form")!;
    const hiddenClient = form.elements.namedItem("client_id") as HTMLSelectElement;
    hiddenClient.add(new Option("合成個案甲", clients[0]!.id));
    hiddenClient.value = clients[0]!.id;
    fireEvent.submit(form);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("請重新選擇目前授權的個案");
  });
  it("does not create an empty caregiver diary draft", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<CareDiaryComposer clients={clients} serviceDate={date} selectedClientId={selectedClientId} selectedShift="morning" enabled demo={false} caregiverMode />);
    fireEvent.click(screen.getByRole("button", { name: "新增照顧紀錄" }));
    const dialog = screen.getByRole("dialog", { name: "記錄照顧" });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("請選一項觀察");
  });
  it.each(["morning", "afternoon", "full_day"] as const)("uses selected %s in the actual draft payload", async (shift) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 503 })); vi.stubGlobal("fetch", fetchMock);
    render(<CareDiaryComposer clients={clients} serviceDate={date} selectedClientId={selectedClientId} selectedShift={shift} enabled demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "新增日誌草稿" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("班別 *")).toHaveValue(shift);
    fireEvent.change(within(dialog).getByLabelText("照顧項目 *"), { target: { value: "合成班別觀察" } });
    fireEvent.submit(dialog.querySelector("form")!); await within(dialog).findByRole("alert");
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).data.shift).toBe(shift);
  });
  it("does not silently replace an invalid shift with a full day", () => {
    render(<CareDiaryComposer clients={clients} serviceDate={date} selectedClientId={selectedClientId} selectedShift={"night" as "morning"} enabled demo={false} />);
    expect(screen.getByRole("button", { name: "新增日誌草稿" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("不會自動改成全日");
  });
  it("requires an explicit shift when the entry did not carry one, without sending a draft", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 503 })); vi.stubGlobal("fetch", fetchMock);
    render(<CareDiaryComposer clients={clients} serviceDate={date} selectedClientId={selectedClientId} enabled demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "新增日誌草稿" }));
    const dialog = screen.getByRole("dialog");
    const shift = within(dialog).getByRole("combobox", { name: "班別 *" });
    expect(shift).toHaveValue("");
    fireEvent.submit(dialog.querySelector("form")!);
    expect(shift).toHaveFocus();
    expect(shift).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("請先選擇上午、下午或全日");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(shift, { target: { value: "full_day" } });
    expect(shift).not.toHaveAttribute("aria-invalid");
    fireEvent.change(within(dialog).getByLabelText("照顧項目 *"), { target: { value: "合成全日觀察" } });
    fireEvent.submit(dialog.querySelector("form")!);
    await within(dialog).findByRole("alert");
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).data.shift).toBe("full_day");
  });
});
const specs = [
  { kind: "attendance", trigger: "登錄出勤", field: /補登理由/u, value: "合成補登原因", time: "事件日期與時間 *", endpoint: "/api/attendance" },
  { kind: "vitals", trigger: "新增量測", field: "脈搏 bpm", value: "75", time: "量測日期與時間 *", endpoint: "/api/measurements" },
  { kind: "diary", trigger: "新增日誌草稿", field: "照顧項目 *", value: "合成活動觀察", time: "發生日期與時間 *", endpoint: "/api/records" },
] as const;

function mount(kind: string, selected: string | undefined = selectedClientId) {
  const props = { clients, serviceDate: date, enabled: true, demo: false, selectedClientId: selected };
  render(<><CoreDraftGuardHost />{kind === "attendance" ? <AttendanceComposer {...props} /> : kind === "vitals" ? <VitalSignComposer {...props} /> : <CareDiaryComposer {...props} />}</>);
}
function open(spec: typeof specs[number]) {
  fireEvent.click(screen.getByRole("button", { name: spec.trigger }));
  const dialog = screen.getByRole("dialog");
  const form = dialog.querySelector("form")!;
  const field = within(dialog).getByLabelText(spec.field);
  if (spec.kind === "diary") fireEvent.change(within(dialog).getByRole("combobox", { name: "班別 *" }), { target: { value: "full_day" } });
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
      serviceDate: taipeiServiceDateOf(body.occurred_at), status: "present", checkedInAt: body.occurred_at, checkedOutAt: null, source: "staff_backfill",
    } },
  }), { status: 201 });
}

describe.each(specs.filter((spec) => spec.kind !== "diary"))("$kind next action", (spec) => {
  it("appears only after a confirmed persisted receipt and keeps the person, day and shift", async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => Promise.resolve(successfulResponse(spec, init)));
    vi.stubGlobal("fetch", fetchMock);
    const props = { clients, serviceDate: date, enabled: true, demo: false, selectedClientId, selectedShift: "morning" as const, canContinueToNext: true };
    render(spec.kind === "attendance" ? <AttendanceComposer {...props} /> : <VitalSignComposer {...props} />);
    expect(screen.queryByRole("link", { name: /接著/u })).not.toBeInTheDocument();
    const { form } = open(spec); fireEvent.submit(form);
    const next = await screen.findByRole("link", { name: spec.kind === "attendance" ? "接著量測" : "接著寫日誌" });
    expect(next).toHaveAttribute("href", expect.stringContaining(`client=${selectedClientId}`));
    expect(next).toHaveAttribute("href", expect.stringContaining(`date=${date}`));
    expect(next).toHaveAttribute("href", expect.stringContaining("shift=morning"));
    expect(next).toHaveAttribute("href", expect.stringContaining(spec.kind === "attendance" ? "/vital-signs" : "/care-diary"));
  });

  it("keeps a confirmed write but omits the shortcut when the following step is unavailable", async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => Promise.resolve(successfulResponse(spec, init)));
    vi.stubGlobal("fetch", fetchMock);
    const props = { clients, serviceDate: date, enabled: true, demo: false, selectedClientId, canContinueToNext: false };
    render(spec.kind === "attendance" ? <AttendanceComposer {...props} /> : <VitalSignComposer {...props} />);
    const { dialog, form } = open(spec); fireEvent.submit(form);
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: /接著/u })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已儲存");
  });

  it("does not offer the next action for an unconfirmed write", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    mount(spec.kind);
    const { dialog, form } = open(spec); fireEvent.submit(form);
    await within(dialog).findByRole("alert");
    expect(screen.queryByRole("link", { name: /接著/u })).not.toBeInTheDocument();
  });

  it("does not carry a backdated write into the currently selected service day", async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => Promise.resolve(successfulResponse(spec, init)));
    vi.stubGlobal("fetch", fetchMock);
    const props = { clients, serviceDate: date, enabled: true, demo: false, selectedClientId, selectedShift: "morning" as const };
    render(spec.kind === "attendance" ? <AttendanceComposer {...props} /> : <VitalSignComposer {...props} />);
    const { dialog, form } = open(spec);
    fireEvent.change(within(dialog).getByLabelText(spec.time), { target: { value: "2026-09-11T09:10" } });
    fireEvent.submit(form);
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    expect(screen.getByRole("status")).toHaveTextContent("2026-09-11");
    expect(screen.queryByRole("link", { name: /接著/u })).not.toBeInTheDocument();
  });
});

describe.each(specs)("$kind selected-client composer safeguards", (spec) => {
  it("preserves the exact selected person and date in the API payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    mount(spec.kind);
    const { dialog, form } = open(spec);
    expect((form.elements.namedItem("client_id") as HTMLInputElement | HTMLSelectElement).value).toBe(selectedClientId);
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
    const confirm = vi.spyOn(window, "confirm");
    mount(spec.kind);
    const { dialog, field } = open(spec);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "繼續填寫" }));
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "繼續填寫" }));
    fireEvent.click(dialog);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "繼續填寫" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute("open");
    expect(field).toHaveValue(spec.kind === "vitals" ? 75 : spec.value);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "放棄本次輸入" }));
    expect(dialog).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: spec.trigger }));
    expect((dialog.querySelector("form")!.elements.namedItem("client_id") as HTMLInputElement | HTMLSelectElement).value).toBe(selectedClientId);
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
    const field = form.elements.namedItem("client_id") as HTMLInputElement | HTMLSelectElement;
    const forgedClient = "a9999999-9999-4999-8999-999999999999";
    if (field instanceof HTMLSelectElement) {
      field.add(new Option("合成未授權個案", forgedClient));
    }
    field.value = forgedClient;
    fireEvent.submit(form);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("請重新選擇目前授權的個案");
  });
});
