// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AttendanceComposer } from "./attendance-composer";
import { VitalSignComposer } from "./vital-sign-composer";
import { CareDiaryComposer } from "./care-diary-composer";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); refresh.mockClear(); });
const clientId = "a1111111-1111-4111-8111-111111111111";
const props = { clients: [{ id: clientId, name: "合成個案", code: "SYN-01", attendance: null }],
  serviceDate: "2026-09-10", selectedClientId: clientId, enabled: true, demo: false };
const specs = [
  { kind: "attendance", trigger: "登錄出勤", field: /補登理由/u, value: "合成補登原因", retry: "重試原出勤", Component: AttendanceComposer },
  { kind: "vitals", trigger: "新增量測", field: "脈搏 bpm", value: "75", retry: "重試原量測", Component: VitalSignComposer },
  { kind: "diary", trigger: "新增日誌草稿", field: "照顧項目 *", value: "合成觀察", retry: "重試原草稿", Component: CareDiaryComposer },
] as const;
function open(spec: typeof specs[number]) {
  fireEvent.click(screen.getByRole("button", { name: spec.trigger }));
  const dialog = screen.getByRole("dialog");
  const field = within(dialog).getByLabelText(spec.field);
  fireEvent.change(field, { target: { value: spec.value } });
  if (spec.kind === "diary") {
    fireEvent.change(within(dialog).getByLabelText("班別 *"), { target: { value: "full_day" } });
    fireEvent.change(within(dialog).getByLabelText("發生日期與時間 *"), { target: { value: "2026-09-10T09:00" } });
  }
  return { dialog, field, form: dialog.querySelector("form")! };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function validPayload(kind: string, init: RequestInit) {
  const body = JSON.parse(String(init.body));
  return { requestId: "d1111111-1111-4111-8111-111111111111", status: "ok", errors: [],
    data: { persisted: true, demo: false, replayed: false,
      ...(kind === "attendance" ? { operation: {
        id: "d2222222-2222-4222-8222-222222222222", attendanceId: "d3333333-3333-4333-8333-333333333333",
        clientId: body.client_id, eventKind: body.event_kind, occurredAt: body.occurred_at,
        serviceDate: props.serviceDate, status: "present", checkedInAt: body.occurred_at, checkedOutAt: null, source: "staff_backfill",
      } } : kind === "vitals" ? { recordCount: 1, measurementKinds: ["pulse"] }
        : { record: { id: "synthetic-diary", version: 1, status: "draft" }, page: { slug: "staff/daily-care/care-diary" } }),
    } };
}

describe.each(specs)("$kind full request/decode deadline", (spec) => {
  it.each(["success-body", "rejection-clone"])("bounds hanging %s, rejects late completion and retries the original body/key", async (mode) => {
    vi.useFakeTimers();
    const decode = deferred<unknown>();
    const fetchMock = vi.fn().mockResolvedValue(mode === "success-body"
      ? { ok: true, status: 201, json: () => decode.promise }
      : { ok: false, status: 422, clone: () => ({ json: () => decode.promise }), json: () => decode.promise });
    vi.stubGlobal("fetch", fetchMock);
    render(<spec.Component {...props} />);
    const { dialog, form, field } = open(spec);
    await act(async () => { fireEvent.submit(form); });
    const first = fetchMock.mock.calls[0]![1] as RequestInit;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_001); });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("操作結果未知");
    expect(within(dialog).getByRole("button", { name: spec.retry })).toBeEnabled();
    expect(field).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { decode.resolve(mode === "success-body" ? validPayload(spec.kind, first)
      : { requestId: "synthetic-rejection", status: "error", data: null, errors: [{ code: "INVALID" }] }); });
    expect(dialog).toHaveAttribute("open");
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: spec.retry })); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(second.body).toBe(first.body);
    expect(second.headers).toEqual(first.headers);
  });
  it("cannot accept a late valid receipt after visible permission ABA", async () => {
    const decode = deferred<unknown>();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => decode.promise });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<spec.Component {...props} />);
    const { form } = open(spec);
    await act(async () => { fireEvent.submit(form); });
    const first = fetchMock.mock.calls[0]![1] as RequestInit;
    view.rerender(<spec.Component {...props} enabled={false} />);
    view.rerender(<spec.Component {...props} />);
    await act(async () => { decode.resolve(validPayload(spec.kind, first)); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: spec.trigger }));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: spec.retry })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("aborts on unmount and never refreshes from a late decoded receipt", async () => {
    const decode = deferred<unknown>();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => decode.promise });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<spec.Component {...props} />);
    const { form } = open(spec);
    await act(async () => { fireEvent.submit(form); });
    const first = fetchMock.mock.calls[0]![1] as RequestInit;
    view.unmount();
    expect(first.signal?.aborted).toBe(true);
    await act(async () => { decode.resolve(validPayload(spec.kind, first)); });
    expect(refresh).not.toHaveBeenCalled();
  });
});
