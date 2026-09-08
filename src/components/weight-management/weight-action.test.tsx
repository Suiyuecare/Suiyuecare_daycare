// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildDemoWeightSnapshot } from "@/lib/weight-management/demo";

import { WeightAction, WeightFreshness } from "./weight-action";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const snapshot = buildDemoWeightSnapshot("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "2026-09-01");

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fillRecord(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByRole("spinbutton", { name: /體重/u }), { target: { value: "65.00" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: /來源/u }), { target: { value: "人工量測" } });
}

describe("weight action browser boundary", () => {
  it("keeps demo mutation visibly disabled", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<WeightAction canManage clients={snapshot.clientOptions} demo hasRecentAal2 instance="demo" kind="record" />);
    expect(screen.getByRole("button", { name: /新增體重：展示模式唯讀/u })).toHaveProperty("disabled", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables acknowledgement unless current, prior, and rule evidence are all present", () => {
    const incomplete = {
      ...snapshot.items[0]!,
      priorObservationId: null,
      ruleVersionId: null,
    };
    render(<WeightAction canManage clients={snapshot.clientOptions} demo={false} hasRecentAal2 instance="incomplete" item={incomplete} kind="acknowledge" />);
    expect(screen.getByRole("button", { name: /確認警示：目前資料不允許此操作/u })).toHaveProperty("disabled", true);
  });

  it("locks every field and close path while the request is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<WeightAction canManage clients={snapshot.clientOptions} demo={false} hasRecentAal2 instance="pending" kind="record" />);
    fireEvent.click(screen.getByRole("button", { name: "新增體重" }));
    const dialog = screen.getByRole("dialog", { name: "新增體重" }); fillRecord(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "新增體重" }));
    await within(dialog).findByRole("button", { name: "確認中…" });
    expect(dialog.querySelector("fieldset")).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("button", { name: "關閉" })).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveProperty("disabled", true);
    const cancel = new Event("cancel", { cancelable: true });
    expect(dialog.dispatchEvent(cancel)).toBe(false);
  });

  it("reuses the same idempotency key after unknown network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetchMock);
    render(<WeightAction canManage clients={snapshot.clientOptions} demo={false} hasRecentAal2 instance="retry" kind="record" />);
    fireEvent.click(screen.getByRole("button", { name: "新增體重" }));
    const dialog = screen.getByRole("dialog", { name: "新增體重" }); fillRecord(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "新增體重" }));
    await screen.findByRole("alert");
    fireEvent.click(within(dialog).getByRole("button", { name: "新增體重" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(second["Idempotency-Key"]).toBe(first["Idempotency-Key"]);
  });

  it("rotates the idempotency key only after editing failed content", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetchMock);
    render(<WeightAction canManage clients={snapshot.clientOptions} demo={false} hasRecentAal2 instance="change" kind="record" />);
    fireEvent.click(screen.getByRole("button", { name: "新增體重" }));
    const dialog = screen.getByRole("dialog", { name: "新增體重" }); fillRecord(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "新增體重" }));
    await screen.findByRole("alert");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /來源/u }), { target: { value: "設備匯入" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "新增體重" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(second["Idempotency-Key"]).not.toBe(first["Idempotency-Key"]);
  });

  it("announces staleness and resets against a newer boundary", async () => {
    const { rerender } = render(<WeightFreshness demo={false} staleAfter={new Date(Date.now() - 1000).toISOString()} />);
    await screen.findByRole("status");
    rerender(<WeightFreshness demo={false} staleAfter={new Date(Date.now() + 60000).toISOString()} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("資料在時效內")).toBeDefined();
  });
});
