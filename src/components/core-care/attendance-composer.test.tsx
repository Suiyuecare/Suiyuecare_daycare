// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AttendanceComposer } from "./attendance-composer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true, value() { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); },
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("attendance composer receipt boundary", () => {
  it("keeps the dialog and idempotency key after an invalid 2xx receipt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ forged: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    render(<AttendanceComposer clients={[{
      id: "46000000-0000-4000-8000-000000000001", name: "合成個案", code: "D001", attendance: null,
    }]} demo={false} enabled serviceDate={today} selectedClientId="46000000-0000-4000-8000-000000000001" />);
    fireEvent.click(screen.getByRole("button", { name: "登錄出勤" }));
    const dialog = screen.getByRole("dialog", { name: "簽到、簽退或登記未到" });
    fireEvent.click(within(dialog).getByRole("button", { name: "確認簽到" }));
    await within(dialog).findByRole("alert");
    expect(dialog.hasAttribute("open")).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "重試原出勤" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(second["Idempotency-Key"]).toBe(first["Idempotency-Key"]);
  });
});
