// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { VitalSignComposer } from "./vital-sign-composer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const clientId = "46000000-0000-4000-8000-000000000001";
function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function view(canOfferArrival: boolean, arrivalRequired = false) {
  render(<VitalSignComposer clients={[{ id: clientId, name: "合成個案", code: "D001" }]}
    demo={false} enabled serviceDate={today()} selectedClientId={clientId}
    canOfferArrival={canOfferArrival} arrivalRequired={arrivalRequired} />);
  fireEvent.click(screen.getByRole("button", { name: "新增量測" }));
  return screen.getByRole("dialog", { name: "新增生命徵象" });
}

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true, value() { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); },
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("first vital and case arrival form", () => {
  it("presents immediate measurement and sign-in without an editable time and sends no client time", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: "synthetic-request", status: "ok", errors: [],
      data: { demo: false, persisted: true, replayed: false, recordCount: 1, measurementKinds: ["pulse"],
        measuredAt: new Date().toISOString(), attendance: { operationId: clientId, attendanceId: clientId,
          checkedInAt: new Date().toISOString(), serviceDate: today() } } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const dialog = view(true);
    const form = dialog.querySelector("form")!;
    const submits = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'));
    expect(submits.map((button) => button.textContent)).toEqual(["儲存量測並簽到"]);
    const timeInput = within(dialog).getByLabelText("量測日期與時間 *") as HTMLInputElement;
    expect(timeInput.disabled).toBe(true);
    expect(timeInput.closest("[hidden]")).not.toBeNull();
    expect(within(dialog).getByText(/現在量測、現在為個案簽到/u)).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "脈搏 bpm" }), { target: { value: "75" } });
    fireEvent.click(submits[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ client_id: clientId, service_date: today(), values: { pulse: 75 }, arrival_check_in: true });
    expect(body).not.toHaveProperty("measured_at");
  });

  it("locks a case chosen from the daily card instead of allowing an accidental switch", () => {
    const dialog = view(true);
    expect(within(dialog).getByText("合成個案（D001）")).toBeTruthy();
    expect(within(dialog).queryByRole("combobox", { name: "個案 *" })).toBeNull();
    expect((dialog.querySelector('input[name="client_id"]') as HTMLInputElement).value).toBe(clientId);
  });

  it("reveals the editable time only after choosing measurement-only/backfill", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: "synthetic-request", status: "ok", errors: [],
      data: { demo: false, persisted: true, replayed: false, recordCount: 1, measurementKinds: ["pulse"] } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const dialog = view(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "改為僅存量測／補登" }));
    const timeInput = within(dialog).getByLabelText("量測日期與時間 *") as HTMLInputElement;
    expect(timeInput.disabled).toBe(false);
    expect(timeInput.closest("[hidden]")).toBeNull();
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "脈搏 bpm" }), { target: { value: "75" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存量測" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ client_id: clientId, values: { pulse: 75 } });
    expect(body.measured_at).toBeTypeOf("string");
    expect(body).not.toHaveProperty("arrival_check_in");
  });

  it("treats Enter-style submit without a submitter as the visible primary action", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const dialog = view(true);
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "脈搏 bpm" }), { target: { value: "75" } });
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.arrival_check_in).toBe(true);
  });

  it("does not expose case check-in when the server snapshot disallows it", () => {
    const dialog = view(false);
    expect(within(dialog).queryByRole("button", { name: "儲存量測並簽到" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "儲存量測" })).toBeTruthy();
  });

  it("keeps a care worker on the single combined first-vital action", () => {
    const dialog = view(true, true);
    expect(within(dialog).getByRole("button", { name: "儲存量測並簽到" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /改為僅存量測/u })).toBeNull();
    const timeInput = within(dialog).getByLabelText("量測日期與時間 *") as HTMLInputElement;
    expect(timeInput.disabled).toBe(true);
  });

  it("does not offer standalone recording to a care worker when arrival cannot be completed", () => {
    render(<VitalSignComposer clients={[{ id: clientId, name: "合成個案", code: "D001" }]}
      demo={false} enabled serviceDate={today()} selectedClientId={clientId}
      canOfferArrival={false} arrivalRequired />);
    expect((screen.getByRole("button", { name: "新增量測" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/請主任核對出勤或權限/u)).toBeTruthy();
  });
});
