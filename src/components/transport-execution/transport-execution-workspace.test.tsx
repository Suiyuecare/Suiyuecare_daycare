// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoTransportExecutionSnapshot } from "@/lib/transport-execution/demo";
import type { TransportExecutionSnapshot } from "@/lib/transport-execution/types";

import { TransportExecutionWorkspace } from "./transport-execution-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const filters = { serviceDate: "2026-09-07", vehicleQuery: "", driverQuery: "",
  completionStatus: "all" as const, exceptionStatus: "all" as const };
const demo = buildDemoTransportExecutionSnapshot(filters);
const formal: TransportExecutionSnapshot = { ...demo, demo: false };
const page = staffPages.find(({ number }) => number === 48)!;

function workspace(snapshot: TransportExecutionSnapshot | null, options: {
  loadError?: boolean; canRecord?: boolean; canException?: boolean;
  canComplete?: boolean; canManageAny?: boolean; recent?: boolean; userId?: string;
} = {}) {
  return render(<TransportExecutionWorkspace canComplete={options.canComplete ?? false}
    canManageAny={options.canManageAny ?? false} canRecord={options.canRecord ?? false}
    canRecordException={options.canException ?? false}
    currentUserId={options.userId ?? "48990000-0000-4000-8000-000000000099"}
    filters={filters} hasRecentAal2={options.recent ?? false}
    loadError={options.loadError ?? false} page={page} snapshot={snapshot} />);
}

describe("Page 48 transport-execution workspace", () => {
  beforeEach(() => {
    refresh.mockReset();
    let sequence = 900;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `48890000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("freezes page permissions, pairing, driver and offline boundaries", () => {
    expect(page.requiredPermissions).toEqual(["clients.read", "transport_execution.read"]);
    expect(page.acceptance.join(" ")).toMatch(/精確已發布原計畫版本.*不可變順序鏈/u);
    expect(page.acceptance.join(" ")).toMatch(/manage_any.*15 分鐘/u);
    expect(page.offline.mode).toBe("draft-sync-24h");
    expect(page.offline.note).toMatch(/尚未配置/u);
  });

  it("renders reconciled synthetic metrics and honest unconfigured states", () => {
    workspace(demo);
    expect(screen.getByRole("heading", { level: 1, name: "接送執行紀錄" }))
      .toBeInTheDocument();
    const metrics = within(screen.getByRole("region", { name: "接送執行摘要" }));
    for (const label of ["待執行", "進行中", "已完成", "遲到", "未配對"]) {
      const node = metrics.getByText(label);
      expect(within(node.closest("article")!).getByText("1")).toBeInTheDocument();
    }
    expect(screen.getByText(/實際開始晚於原計畫開始/u)).toBeInTheDocument();
    expect(screen.getByText(/離線草稿同步、外部通知與匯出尚未配置/u))
      .toBeInTheDocument();
    expect(screen.getByText(/均為合成資料/u)).toBeInTheDocument();
  });

  it("exposes exact plan, passenger pairing and immutable events in details", () => {
    const { container } = workspace(demo);
    const summaries = [...container.querySelectorAll("summary")];
    fireEvent.click(summaries[1]!);
    expect(screen.getAllByText(/上下車已配對/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/尚未配對/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/#1 開始趟次/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/原計畫版本/u).length).toBeGreaterThan(0);
  });

  it("fails closed without substituting synthetic execution data", () => {
    workspace(null, { loadError: true });
    expect(screen.getByRole("alert")).toHaveTextContent("接送執行紀錄暫時無法載入");
    expect(screen.getByRole("alert")).toHaveTextContent("沒有改用展示資料");
    expect(screen.queryByText("合成駕駛甲")).not.toBeInTheDocument();
  });

  it("lets the assigned driver start only their own exact plan", () => {
    const assigned = formal.trips[0]!;
    workspace(formal, { canRecord: true, userId: assigned.driverUserId });
    fireEvent.click(screen.getByText("開始、記錄上下車、登記例外或完成趟次"));
    expect(screen.getByRole("option", { name: "開始趟次" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "原計畫趟次" }))
      .toHaveTextContent(assigned.vehicleName);
    expect(screen.queryByText(/例外處置與完成簽署需重新驗證/u)).not.toBeInTheDocument();
  });

  it("requires recent AAL2 before exposing exception or completion choices", () => {
    const assigned = formal.trips[1]!;
    workspace(formal, { canException: true, canComplete: true,
      userId: assigned.driverUserId, recent: false });
    expect(screen.getByRole("heading", { name: "例外處置與完成簽署需重新驗證" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByText("開始、記錄上下車、登記例外或完成趟次"));
    expect(screen.queryByRole("option", { name: "登記人工例外" })).not.toBeInTheDocument();
  });

  it("exposes an explained exception only to a recent authorized actor", () => {
    const assigned = formal.trips[1]!;
    workspace(formal, { canException: true, userId: assigned.driverUserId, recent: true });
    fireEvent.click(screen.getByText("開始、記錄上下車、登記例外或完成趟次"));
    expect(screen.getByRole("option", { name: "登記人工例外" })).toBeInTheDocument();
  });

  it("lets manage_any act across drivers while read-only actors see no form", () => {
    workspace(formal, { canRecord: true, canManageAny: true });
    expect(screen.getByText("開始、記錄上下車、登記例外或完成趟次"))
      .toBeInTheDocument();
    cleanup();
    workspace(formal);
    expect(screen.queryByText("開始、記錄上下車、登記例外或完成趟次"))
      .not.toBeInTheDocument();
  });

  it("keeps the same operation key for an unknown result and rotates only after edits", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network interrupted"));
    vi.stubGlobal("fetch", fetchMock);
    const assigned = formal.trips[0]!;
    workspace(formal, { canRecord: true, userId: assigned.driverUserId });
    fireEvent.click(screen.getByText("開始、記錄上下車、登記例外或完成趟次"));
    fireEvent.click(screen.getByRole("button", { name: "鎖內重驗並寫入事件" }));
    await screen.findByText(/結果未知.*相同操作鍵重試/u);
    const first = new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers)
      .get("idempotency-key");
    fireEvent.click(screen.getByRole("button", { name: "鎖內重驗並寫入事件" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = new Headers((fetchMock.mock.calls[1]![1] as RequestInit).headers)
      .get("idempotency-key");
    expect(second).toBe(first);

    fireEvent.input(screen.getByLabelText("實際時間（台北）"), {
      target: { value: "2026-09-07T08:01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "鎖內重驗並寫入事件" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const third = new Headers((fetchMock.mock.calls[2]![1] as RequestInit).headers)
      .get("idempotency-key");
    expect(third).not.toBe(first);
  });

  it("accepts only an exact persisted receipt before declaring an event written", async () => {
    const assigned = formal.trips[0]!;
    const eventId = "48870000-0000-4000-8000-000000000701";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      return Response.json({ requestId: "48880000-0000-4000-8000-000000000701",
        status: "ok", data: {
          operation_id: headers.get("idempotency-key"), event_id: eventId,
          event_type: "trip_started", plan_version_id: assigned.planVersionId,
          trip_key: assigned.tripKey, client_id: null, sequence: 1,
          status: "in_progress", actual_started_at: "2026-09-07T00:00:00.000Z",
          actual_completed_at: null, exception_count: 0,
          unmatched_passenger_count: assigned.passengers.length, late_seconds: 0,
          resolves_pairing: false, event_content_hash: "e".repeat(64),
          plan_content_hash: assigned.planContentHash,
          committed_at: "2026-09-07T00:00:01.000Z", replayed: false,
        }, errors: [] }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    workspace(formal, { canRecord: true, userId: assigned.driverUserId });
    fireEvent.click(screen.getByText("開始、記錄上下車、登記例外或完成趟次"));
    fireEvent.click(screen.getByRole("button", { name: "鎖內重驗並寫入事件" }));
    expect(await screen.findByText(/事件 #1 已寫入/u)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not declare success for a malformed 2xx envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      requestId: "48880000-0000-4000-8000-000000000702",
      status: "ok", data: {}, errors: [],
    }, { status: 201 })));
    const assigned = formal.trips[0]!;
    workspace(formal, { canRecord: true, userId: assigned.driverUserId });
    fireEvent.click(screen.getByText("開始、記錄上下車、登記例外或完成趟次"));
    fireEvent.click(screen.getByRole("button", { name: "鎖內重驗並寫入事件" }));
    expect(await screen.findByText(/回執不完整.*相同操作鍵/u)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
