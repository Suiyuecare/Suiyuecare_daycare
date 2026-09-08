// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDemoActivitySnapshot } from "@/lib/activities/demo";

import { ActivityScheduleForm, ActivityTransitionForm } from "./activity-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const snapshot = buildDemoActivitySnapshot("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fillCreate(container: HTMLElement) {
  fireEvent.change(within(container).getByRole("textbox", { name: "活動類型" }), { target: { value: "健康促進" } });
  fireEvent.change(within(container).getByRole("textbox", { name: "活動標題" }), { target: { value: "測試活動" } });
  fireEvent.change(within(container).getByRole("textbox", { name: /活動內容摘要/u }), { target: { value: "機構活動內容" } });
  fireEvent.change(within(container).getByRole("textbox", { name: "地點" }), { target: { value: "一樓" } });
  fireEvent.change(within(container).getByRole("combobox", { name: "負責人" }), { target: { value: snapshot.staffOptions[0]!.userId } });
}

describe("activity action browser boundary", () => {
  it("keeps synthetic demo schedule fields disabled", () => {
    render(<ActivityScheduleForm canManage={false} clients={snapshot.clientOptions} quickClientId={null} referenceTime={snapshot.generatedAt} staff={snapshot.staffOptions} />);
    expect(document.querySelector("fieldset")).toHaveProperty("disabled", true);
    expect(screen.getByText(/目前為唯讀/u)).toBeDefined();
  });

  it("locks every editable field while a create request is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const { container } = render(<ActivityScheduleForm canManage clients={snapshot.clientOptions} quickClientId={snapshot.clientOptions[0]!.clientId} referenceTime={snapshot.generatedAt} staff={snapshot.staffOptions} />);
    fillCreate(container);
    fireEvent.click(screen.getByRole("button", { name: "建立活動" }));
    await screen.findByRole("button", { name: "送出中…" });
    expect(container.querySelector("form > fieldset")).toHaveProperty("disabled", true);
  });

  it("reuses an idempotency key for unchanged unknown outcomes and rotates after edit", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<ActivityScheduleForm canManage clients={snapshot.clientOptions} quickClientId={snapshot.clientOptions[0]!.clientId} referenceTime={snapshot.generatedAt} staff={snapshot.staffOptions} />);
    fillCreate(container); fireEvent.click(screen.getByRole("button", { name: "建立活動" }));
    await screen.findByText(/完成狀態未知/u);
    fireEvent.click(screen.getByRole("button", { name: "建立活動" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(second["idempotency-key"]).toBe(first["idempotency-key"]);
    fireEvent.change(within(container).getByRole("textbox", { name: "地點" }), { target: { value: "二樓" } });
    fireEvent.click(screen.getByRole("button", { name: "建立活動" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const third = (fetchMock.mock.calls[2]![1] as RequestInit).headers as Record<string, string>;
    expect(third["idempotency-key"]).not.toBe(first["idempotency-key"]);
  });

  it("requires recent AAL2 before enabling cancellation", () => {
    render(<ActivityTransitionForm action="cancel" activity={snapshot.items[1]!} canAct hasRecentAal2={false} />);
    expect(screen.getByRole("button", { name: "取消活動" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/最近 15 分鐘/u)).toBeDefined();
  });
});
