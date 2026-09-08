// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildDemoFallEventSnapshot } from "@/lib/fall-events/demo";

import { FallEventAction } from "./fall-event-action";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(kind: "report" | "treatment" | "follow_up" | "close", demo = false) {
  const snapshot = buildDemoFallEventSnapshot();
  const incident = kind === "report" ? undefined : snapshot.items[1]!;
  render(
    <FallEventAction
      canClose
      canManage
      clients={snapshot.clientOptions}
      demo={demo}
      hasRecentAal2
      incident={incident}
      instance={`test-${kind}`}
      kind={kind}
    />,
  );
  return { snapshot, incident };
}

function successEnvelope({
  action,
  clientId,
  incidentId,
  chainVersion,
}: {
  action: "report" | "treatment" | "follow_up" | "close";
  clientId: string;
  incidentId: string;
  chainVersion: number;
}) {
  return {
    requestId: "24000000-0000-4000-8000-000000000090",
    status: "ok",
    data: {
      operationId: "24000000-0000-4000-8000-000000000091",
      incidentId,
      clientId,
      entryId: action === "report" ? null : "24000000-0000-4000-8000-000000000092",
      chainVersion,
      handlingStatus: action === "report" ? "reported" : action === "close" ? "closed" : "in_progress",
      committedAt: "2026-09-01T02:00:00.000Z",
      replayed: false,
      persisted: true,
      demo: false,
    },
    errors: [],
  };
}

describe("fall event action browser boundary", () => {
  it("keeps demo writes visibly disabled and never calls fetch", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setup("report", true);
    const button = screen.getByRole("button", { name: /新增事件：展示模式/u });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("conservatively requires a late-entry reason at the exact 24-hour minute boundary", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T02:00:00.000Z"));
    setup("report");
    fireEvent.click(screen.getByRole("button", { name: "新增事件" }));
    const dialog = screen.getByRole("dialog", { name: "新增事件" });
    fireEvent.change(within(dialog).getByLabelText(/事件時間/u), {
      target: { value: "2026-08-31T10:00" },
    });
    expect(within(dialog).getByLabelText(/逾 24 小時補登理由/u)).toHaveProperty("required", true);
  });

  it("uses the terminal timeline time as the next-entry minimum", () => {
    const { incident } = setup("follow_up");
    fireEvent.click(screen.getByRole("button", { name: "新增追蹤" }));
    const input = within(screen.getByRole("dialog", { name: "新增追蹤" }))
      .getByLabelText(/紀錄發生時間/u) as HTMLInputElement;
    const terminal = incident!.timeline.at(-1)!.occurredAt;
    const expected = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(terminal));
    const part = (type: Intl.DateTimeFormatPartTypes) => expected.find((item) => item.type === type)?.value;
    expect(input.min).toBe(`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`);
  });

  it("locks all form fields and close paths while a request is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    setup("follow_up");
    fireEvent.click(screen.getByRole("button", { name: "新增追蹤" }));
    const dialog = screen.getByRole("dialog", { name: "新增追蹤" });
    fireEvent.change(within(dialog).getByLabelText(/追蹤內容/u), { target: { value: "追蹤內容" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "新增追蹤" }));
    await within(dialog).findByRole("button", { name: "確認中…" });
    expect(dialog.querySelector("fieldset")).toHaveProperty("disabled", true);
    const cancel = new Event("cancel", { cancelable: true });
    expect(dialog.dispatchEvent(cancel)).toBe(false);
    expect(within(dialog).getByRole("button", { name: "關閉" })).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveProperty("disabled", true);
  });

  it("retries unknown network state with the same key and rotates only after content changes", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    setup("report");
    fireEvent.click(screen.getByRole("button", { name: "新增事件" }));
    const dialog = screen.getByRole("dialog", { name: "新增事件" });
    fireEvent.change(within(dialog).getByLabelText(/地點/u), { target: { value: "活動區" } });
    fireEvent.change(within(dialog).getByLabelText(/事件內容/u), { target: { value: "事件內容" } });
    const submit = within(dialog).getByRole("button", { name: "新增事件" });
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/網路狀態不明/u));
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const firstHeaders = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1]![1]!.headers as Record<string, string>;
    expect(secondHeaders["Idempotency-Key"]).toBe(firstHeaders["Idempotency-Key"]);
    fireEvent.change(within(dialog).getByLabelText(/地點/u), { target: { value: "走廊" } });
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const thirdHeaders = fetchMock.mock.calls[2]![1]!.headers as Record<string, string>;
    expect(thirdHeaders["Idempotency-Key"]).not.toBe(firstHeaders["Idempotency-Key"]);
  });

  it("keeps a forged client receipt open instead of accepting a 2xx response", async () => {
    const { incident } = setup("follow_up");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(successEnvelope({
      action: "follow_up",
      clientId: "24000000-0000-4000-8000-000000000099",
      incidentId: incident!.id,
      chainVersion: incident!.chainVersion + 1,
    })), { status: 200, headers: { "Content-Type": "application/json" } })));
    fireEvent.click(screen.getByRole("button", { name: "新增追蹤" }));
    const dialog = screen.getByRole("dialog", { name: "新增追蹤" });
    fireEvent.change(within(dialog).getByLabelText(/追蹤內容/u), { target: { value: "追蹤內容" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "新增追蹤" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/伺服器回覆不完整/u));
    expect(dialog.hasAttribute("open")).toBe(true);
  });
});
