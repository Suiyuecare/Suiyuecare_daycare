// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDemoReassuranceCalendarSnapshot } from "@/lib/reassurance-calendar/demo";
import type { ReassuranceCalendarFilters } from "@/lib/reassurance-calendar/types";

import {
  ReassuranceCalendarCancelForm,
  ReassuranceCalendarEventForm,
} from "./reassurance-calendar-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const organizationId = "44000000-0000-4000-8000-000000000030";
const branchId = "44000000-0000-4000-8000-000000000031";
const filters: ReassuranceCalendarFilters = {
  month: "2026-09", organizationId, category: null,
  status: "all", todayOnly: false, query: "",
};
const snapshot = buildDemoReassuranceCalendarSnapshot({ organizationId, branchId, filters });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fillCreate(container: HTMLElement) {
  fireEvent.change(within(container).getByRole("textbox", { name: "標題" }), {
    target: { value: "合成安心行程" },
  });
  fireEvent.change(within(container).getByRole("textbox", { name: "內容摘要" }), {
    target: { value: "合成行程內容摘要" },
  });
  fireEvent.change(within(container).getByRole("textbox", { name: "地點" }), {
    target: { value: "合成活動室" },
  });
  fireEvent.change(within(container).getByRole("combobox", { name: "負責人" }), {
    target: { value: snapshot.staffOptions[0]!.userId },
  });
}

describe("Page 44 reassurance calendar actions", () => {
  it("keeps every synthetic demo write disabled", () => {
    const { container } = render(<ReassuranceCalendarEventForm canManage={false}
      clients={snapshot.clientOptions} referenceTime={snapshot.generatedAt}
      staff={snapshot.staffOptions} />);
    expect(container.querySelector("form > fieldset")).toHaveProperty("disabled", true);
    expect(screen.getByText(/所有正式發布都需要近期 AAL2/u)).toBeDefined();
  });

  it("requires recent AAL2 before cancellation", () => {
    render(<ReassuranceCalendarCancelForm canCancel event={snapshot.items[0]!}
      hasRecentAal2={false} />);
    expect(screen.getByRole("button", { name: "確認建立取消版本" })
      .closest("fieldset")).toHaveProperty("disabled", true);
    expect(screen.getByText(/最近 15 分鐘/u)).toBeDefined();
  });

  it("sends cancellation as a strict narrow payload without hidden event fields", async () => {
    const event = snapshot.items[0]!;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: "44800000-0000-4000-8000-000000000099", status: "ok", errors: [],
      data: {
        operationId: "44700000-0000-4000-8000-000000000099",
        operationKind: "cancel", eventKey: event.eventKey,
        versionId: "44900000-0000-4000-8000-000000000099",
        eventVersion: event.version + 1, previousVersionId: event.versionId,
        recordKind: "cancellation", eventStatus: "cancelled",
        eventCategory: event.category, audienceCount: event.audience.length,
        publicationState: "published", signatureStatus: "not_configured",
        notificationStatus: "not_configured", notificationDelivery: "none_not_sent",
        committedAt: "2026-09-02T02:00:00.000Z", replayed: false,
        persisted: true, demo: false,
      },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReassuranceCalendarCancelForm canCancel event={event} hasRecentAal2 />);
    fireEvent.change(screen.getByRole("textbox", { name: /取消原因/u }), {
      target: { value: "家屬另約時間" },
    });
    fireEvent.click(screen.getByRole("button", { name: "確認建立取消版本" }));
    await screen.findByText(/已保存不可變版本/u);
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(Object.keys(body).sort()).toEqual([
      "action", "eventKey", "expectedVersion", "previousVersionId", "reason",
    ]);
  });

  it("reuses the actor operation key for an unchanged unknown result", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<ReassuranceCalendarEventForm canManage
      clients={snapshot.clientOptions} referenceTime={snapshot.generatedAt}
      staff={snapshot.staffOptions} />);
    fillCreate(container);
    fireEvent.click(screen.getByRole("button", { name: "發布行程" }));
    await screen.findByText(/完成狀態未知/u);
    fireEvent.click(screen.getByRole("button", { name: "發布行程" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(second["idempotency-key"]).toBe(first["idempotency-key"]);
  });
});
