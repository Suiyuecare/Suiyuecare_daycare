// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildDemoInfectionEventSnapshot } from "@/lib/infection-events/demo";

import { InfectionEventAction } from "./infection-event-action";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
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
  navigation.refresh.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(
  kind: "report" | "treatment" | "follow_up" | "cluster_link" | "cluster_unlink" | "close",
  demo = false,
  options: { canManage?: boolean; canClose?: boolean; hasRecentAal2?: boolean } = {},
) {
  const snapshot = buildDemoInfectionEventSnapshot();
  const incident = kind === "report" ? undefined
    : kind === "cluster_link" ? snapshot.items[0] : snapshot.items[1];
  render(
    <InfectionEventAction
      canClose={options.canClose ?? true}
      canManage={options.canManage ?? true}
      clients={snapshot.clientOptions}
      clusters={snapshot.clusterOptions}
      demo={demo}
      hasRecentAal2={options.hasRecentAal2 ?? true}
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
  action: "report" | "treatment" | "follow_up" | "cluster_link" | "cluster_unlink" | "close";
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
      operationKind: action,
      chainVersion,
      handlingStatus: action === "report" ? "reported" : action === "close" ? "closed" : "in_progress",
      clusterId: null,
      clusterLabel: null,
      committedAt: "2026-09-01T02:00:00.000Z",
      replayed: false,
      persisted: true,
      demo: false,
    },
    errors: [],
  };
}

describe("infection event action browser boundary", () => {
  it("keeps demo writes visibly disabled and never calls fetch", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setup("report", true);
    const button = screen.getByRole("button", { name: /新增事件：展示模式/u });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes an honest disabled reason when closure lacks recent same-session AAL2", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setup("close", false, { hasRecentAal2: false });
    const button = screen.getByRole("button", {
      name: /完成結案：結案前須於同一工作階段完成最近 15 分鐘 AAL2/u,
    });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
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
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    setup("follow_up");
    fireEvent.click(screen.getByRole("button", { name: "新增追蹤" }));
    const dialog = screen.getByRole("dialog", { name: "新增追蹤" });
    fireEvent.change(within(dialog).getByLabelText(/追蹤內容/u), { target: { value: "追蹤內容" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "新增追蹤" }));
    await within(dialog).findByRole("button", { name: "確認中…" });
    expect(dialog.querySelector("fieldset")).toHaveProperty("disabled", true);
    fireEvent.click(within(dialog).getByRole("button", { name: "確認中…" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    fireEvent.change(within(dialog).getByLabelText(/發生位置/u), { target: { value: "活動區" } });
    fireEvent.change(within(dialog).getByLabelText(/事件描述/u), { target: { value: "事件內容" } });
    const submit = within(dialog).getByRole("button", { name: "新增事件" });
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/網路狀態不明/u));
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const firstHeaders = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1]![1]!.headers as Record<string, string>;
    expect(secondHeaders["Idempotency-Key"]).toBe(firstHeaders["Idempotency-Key"]);
    fireEvent.change(within(dialog).getByLabelText(/發生位置/u), { target: { value: "走廊" } });
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
    expect(screen.getByRole("alert").textContent).toContain("24000000-0000-4000-8000-000000000090");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("closes after an exactly correlated 2xx receipt, refreshes, and restores trigger focus", async () => {
    const { incident } = setup("follow_up");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(successEnvelope({
      action: "follow_up",
      clientId: incident!.clientId,
      incidentId: incident!.id,
      chainVersion: incident!.chainVersion + 1,
    })), { status: 200, headers: { "Content-Type": "application/json" } })));
    const trigger = screen.getByRole("button", { name: "新增追蹤" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "新增追蹤" });
    fireEvent.change(within(dialog).getByLabelText(/追蹤內容/u), { target: { value: "人工追蹤" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "新增追蹤" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });

  it("fails closed on an impossible Taipei local date before any request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setup("report");
    fireEvent.click(screen.getByRole("button", { name: "新增事件" }));
    const dialog = screen.getByRole("dialog", { name: "新增事件" });
    const occurredAt = within(dialog).getByLabelText(/事件時間/u) as HTMLInputElement;
    fireEvent.change(occurredAt, { target: { value: "2026-02-30T10:00" } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
