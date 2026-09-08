// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { BloodGlucoseComposer } from "./blood-glucose-composer";

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

describe("blood glucose composer receipt boundary", () => {
  it("does not claim success for an invalid 2xx receipt and keeps the retry key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ forged: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<BloodGlucoseComposer clients={[{
      id: "04000000-0000-4000-8000-000000000001", name: "合成個案", code: "D001",
    }]} demo={false} enabled serviceDate="2026-09-01" />);
    fireEvent.click(screen.getByRole("button", { name: "新增血糖" }));
    const dialog = screen.getByRole("dialog", { name: "新增血糖量測" });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: /血糖數值/u }), { target: { value: "105" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存血糖" }));
    await within(dialog).findByRole("alert");
    expect(dialog.hasAttribute("open")).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存血糖" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(second["Idempotency-Key"]).toBe(first["Idempotency-Key"]);
  });
});
