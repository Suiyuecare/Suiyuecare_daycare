// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { buildDemoHandHygieneSnapshot } from "@/lib/hand-hygiene/demo";

import { HandHygieneMatchAction } from "./hand-hygiene-action";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const ORG = "66000000-0000-4000-8000-000000000001";
const BRANCH = "66000000-0000-4000-8000-000000000002";
const snapshot = { ...buildDemoHandHygieneSnapshot({
  organizationId: ORG, branchId: BRANCH,
  filters: { dateFrom: null, dateTo: null, staffMembershipId: null,
    deviceCode: null, matchStatus: "all", eventKind: "all" },
  now: new Date("2026-09-02T04:00:00.000Z"),
}), demo: false as const };
const event = snapshot.events[1]!;

function headerKey(call: unknown[]) {
  return ((call[1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
}

function fillReason(value = "確認設備事件未能辨識員工") {
  fireEvent.change(screen.getByLabelText("修正理由"), { target: { value } });
}

describe("hand hygiene matching correction", () => {
  beforeEach(() => {
    refresh.mockReset(); let sequence = 20;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `66000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("keeps an unchanged unknown-result key and rotates it after editing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<HandHygieneMatchAction canManage event={event} snapshot={snapshot} />);
    fillReason();
    fireEvent.click(screen.getByRole("button", { name: "追加配對修正" }));
    await screen.findByText("網路中斷，結果未知；內容未修改時請使用相同操作鍵重試。");
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加配對修正" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
    fillReason("已查核紙本當班表，維持未配對狀態");
    fireEvent.click(screen.getByRole("button", { name: "追加配對修正" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(headerKey(fetchMock.mock.calls[2]!)).not.toBe(first);
  });

  it("labels a bounded timeout as unknown and preserves the operation key", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new ClientFetchTimeoutError(20_000));
    vi.stubGlobal("fetch", fetchMock);
    render(<HandHygieneMatchAction canManage event={event} snapshot={snapshot} />);
    fillReason();
    fireEvent.click(screen.getByRole("button", { name: "追加配對修正" }));
    await screen.findByText("連線逾時，操作結果未知；請保留內容並以相同操作重試。");
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加配對修正" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
  });

  it("locks all fields while persistence is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<HandHygieneMatchAction canManage event={event} snapshot={snapshot} />);
    fillReason();
    fireEvent.click(screen.getByRole("button", { name: "追加配對修正" }));
    const fieldset = screen.getByLabelText("修正理由").closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
  });

  it("does not refresh for a forged successful status", async () => {
    const payload = { requestId: "66000000-0000-4000-8000-000000000099",
      status: "ok", data: { action: "correct_match", organizationId: ORG,
        branchId: BRANCH, operationId: "66000000-0000-4000-8000-000000000030",
        eventId: event.eventId,
        correctionId: "66000000-0000-4000-8000-000000000031",
        correctionSequence: event.correctionSequence + 1,
        matchStatus: "unmatched", staffMembershipId: null,
        correctedAt: "2026-09-02T04:00:00.000Z", replayed: false,
        persisted: true, demo: false }, errors: [] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200, headers: { "content-type": "application/json" },
    })));
    render(<HandHygieneMatchAction canManage event={event} snapshot={snapshot} />);
    fillReason();
    fireEvent.click(screen.getByRole("button", { name: "追加配對修正" }));
    await screen.findByText("修正結果未確認；請重新檢查，內容未修改時可使用相同操作鍵重試。");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("never renders mutation controls in demo or without manage permission", () => {
    const { rerender } = render(<HandHygieneMatchAction canManage={false}
      event={event} snapshot={snapshot} />);
    expect(screen.queryByText("修正配對")).toBeNull();
    rerender(<HandHygieneMatchAction canManage event={event}
      snapshot={{ ...snapshot, demo: true }} />);
    expect(screen.queryByText("修正配對")).toBeNull();
  });
});
