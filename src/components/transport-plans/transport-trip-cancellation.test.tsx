// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDemoTransportPlanSnapshot } from "@/lib/transport-plans/demo";
import { TransportTripCancellation } from "./transport-plan-actions";
const stubs = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: stubs.refresh }) }));
vi.mock("@/lib/api/client-fetch", () => ({ fetchWithTimeout: stubs.fetch, isClientFetchTimeoutError: () => false }));
const demo = buildDemoTransportPlanSnapshot({ serviceDate: "2026-09-07", direction: "all", vehicleQuery: "", driverQuery: "", status: "all" });
const snapshot = { ...demo, demo: false };
const trip = snapshot.trips.find((item) => item.status === "published")!;
describe("published transport cancellation", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);
  it("freezes unknown-result payload and retries with the same key before refreshing", async () => {
    stubs.fetch.mockRejectedValueOnce(new TypeError("network"));
    stubs.fetch.mockResolvedValueOnce(Response.json({ data: { operationId: crypto.randomUUID(), action: "cancel_trip", decision: null,
      tripVersionId: trip.tripVersionId, tripKey: trip.tripKey, version: trip.version, status: "cancelled",
      conflictCount: trip.conflicts.length, contentHash: trip.contentHash, ruleVersionId: trip.ruleVersionId,
      committedAt: "2026-09-22T06:30:00Z", replayed: true, persisted: true, demo: false } }));
    render(<TransportTripCancellation canApprove hasRecentAal2 snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("取消理由（至少 8 字）"), { target: { value: "車輛故障取消並安排替代接送" } });
    fireEvent.submit(screen.getByRole("button", { name: "確認取消趟次" }).closest("form")!);
    await screen.findByText(/連線中斷或逾時/);
    expect(screen.getByLabelText("取消理由（至少 8 字）")).toBeDisabled();
    expect(stubs.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "以原內容重試取消" }));
    await waitFor(() => expect(stubs.refresh).toHaveBeenCalledOnce());
    expect(stubs.fetch.mock.calls[0][1]).toEqual(stubs.fetch.mock.calls[1][1]);
    expect(screen.getByRole("status")).toHaveTextContent("接送需求將重新列為待派");
  });
  it("does not offer cancellation to demo or unapproved staff", () => {
    const { container, rerender } = render(<TransportTripCancellation canApprove={false} hasRecentAal2 snapshot={snapshot} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<TransportTripCancellation canApprove hasRecentAal2 snapshot={demo} />);
    expect(container).toBeEmptyDOMElement();
  });
});
