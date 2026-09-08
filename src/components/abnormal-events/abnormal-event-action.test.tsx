// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildDemoAbnormalEventSnapshot } from "@/lib/abnormal-events/demo";

import { AbnormalEventAction } from "./abnormal-event-action";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true,
    value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true,
    value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => { cleanup(); navigation.refresh.mockClear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup(kind: "report" | "manual_notification" | "improvement" | "follow_up" | "close",
  options: { demo?: boolean; canManage?: boolean; canClose?: boolean; recent?: boolean } = {}) {
  const snapshot = buildDemoAbnormalEventSnapshot();
  const incident = kind === "report" ? undefined : snapshot.items[1];
  render(<AbnormalEventAction canClose={options.canClose ?? true}
    canManage={options.canManage ?? true} clients={snapshot.clientOptions}
    responsibles={snapshot.responsibleOptions} demo={options.demo ?? false}
    hasRecentAal2={options.recent ?? true} incident={incident}
    instance={`test-${kind}`} kind={kind} />);
  return { snapshot, incident };
}

function success(action: "follow_up" | "close", incident: NonNullable<ReturnType<typeof setup>["incident"]>,
  overrides: Record<string, unknown> = {}) {
  return { requestId: "27000000-0000-4000-8000-000000000090", status: "ok",
    data: { operationId: "27000000-0000-4000-8000-000000000091", incidentId: incident.id,
      entryId: "27000000-0000-4000-8000-000000000092", operationKind: action,
      affectedTargetKind: incident.affectedTargetKind,
      affectedClientId: incident.affectedClientId, chainVersion: incident.chainVersion + 1,
      handlingStatus: action === "close" ? "closed" : "in_progress",
      responsibleMembershipId: incident.currentResponsibleMembershipId,
      effectiveDueDate: incident.currentImprovementDueDate,
      committedAt: "2026-09-01T02:00:00Z", replayed: false,
      persisted: true, demo: false, ...overrides }, errors: [] };
}

describe("abnormal event action browser boundary", () => {
  it("keeps demo and missing-recent-AAL2 actions honestly disabled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setup("report", { demo: true });
    expect(screen.getByRole("button", { name: /新增事件：展示模式/u })).toHaveProperty("disabled", true);
    cleanup();
    setup("close", { recent: false });
    expect(screen.getByRole("button", { name: /完成結案：結案前須/u })).toHaveProperty("disabled", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("locks fields, dismiss paths and duplicate submit while pending", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    setup("follow_up");
    fireEvent.click(screen.getByRole("button", { name: "新增追蹤" }));
    const dialog = screen.getByRole("dialog", { name: "新增追蹤" });
    fireEvent.change(within(dialog).getByLabelText(/追蹤內容/u), { target: { value: "人工追蹤" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "新增追蹤" }));
    await within(dialog).findByRole("button", { name: "確認中…" });
    expect(dialog.querySelector("fieldset")).toHaveProperty("disabled", true);
    fireEvent.click(within(dialog).getByRole("button", { name: "確認中…" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const cancel = new Event("cancel", { cancelable: true });
    expect(dialog.dispatchEvent(cancel)).toBe(false);
    expect(within(dialog).getByRole("button", { name: "關閉" })).toHaveProperty("disabled", true);
  });

  it("keeps content and the same key for an unknown-outcome exact retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    setup("follow_up");
    fireEvent.click(screen.getByRole("button", { name: "新增追蹤" }));
    const dialog = screen.getByRole("dialog", { name: "新增追蹤" });
    const field = within(dialog).getByLabelText(/追蹤內容/u) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "必須完整保留" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "新增追蹤" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/操作結果未知/u));
    expect(field.value).toBe("必須完整保留");
    expect(dialog.querySelector("fieldset")).toHaveProperty("disabled", true);
    fireEvent.click(within(dialog).getByRole("button", { name: "使用原操作重試" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    const second = fetchMock.mock.calls[1]![1]!.headers as Record<string, string>;
    expect(second["Idempotency-Key"]).toBe(first["Idempotency-Key"]);
    expect(fetchMock.mock.calls[1]![1]!.body).toBe(fetchMock.mock.calls[0]![1]!.body);
  });

  it("keeps a malicious 2xx receipt open and surfaces its request id", async () => {
    const { incident } = setup("follow_up");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(success(
      "follow_up", incident!, { effectiveDueDate: "2026-09-30" },
    )), { status: 200, headers: { "Content-Type": "application/json" } })));
    fireEvent.click(screen.getByRole("button", { name: "新增追蹤" }));
    const dialog = screen.getByRole("dialog", { name: "新增追蹤" });
    fireEvent.change(within(dialog).getByLabelText(/追蹤內容/u), { target: { value: "追蹤" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "新增追蹤" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/操作結果未知/u));
    expect(screen.getByRole("alert").textContent).toContain("27000000-0000-4000-8000-000000000090");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("accepts only a correlated 2xx, closes, refreshes and restores trigger focus", async () => {
    const { incident } = setup("follow_up");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(success(
      "follow_up", incident!,
    )), { status: 200, headers: { "Content-Type": "application/json" } })));
    const trigger = screen.getByRole("button", { name: "新增追蹤" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "新增追蹤" });
    fireEvent.change(within(dialog).getByLabelText(/追蹤內容/u), { target: { value: "人工追蹤" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "新增追蹤" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });

  it("fails closed on an impossible Taipei local date before fetch", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setup("report");
    fireEvent.click(screen.getByRole("button", { name: "新增事件" }));
    const dialog = screen.getByRole("dialog", { name: "新增事件" });
    fireEvent.change(within(dialog).getByLabelText(/事件時間/u),
      { target: { value: "2026-02-30T10:00" } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
