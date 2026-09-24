// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { DailyExpectedState } from "@/lib/client-weekly/daily-projection";
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/app/navigation-link", () => ({ NavigationLink: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
import { DailyExpectedPanel } from "./daily-expected-panel";
const state: Extract<DailyExpectedState, { status: "ready" }> = { status: "ready", serviceDate: "2026-09-14", generatedAt: new Date().toISOString(), expectedCount: 2, transportClientCount: 1, outboundCount: 1, inboundCount: 0,
  dispatch: { status: "forbidden" },
  clients: [{ clientId: "b0000000-0000-4000-8000-000000000001", displayName: "合成甲", startsAt: "09:00", endsAt: "16:00", outbound: true, inbound: false },
    { clientId: "b0000000-0000-4000-8000-000000000002", displayName: "合成乙", startsAt: "10:00", endsAt: "16:00", outbound: false, inbound: false }] };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
describe("expected attendance is separate from actual", () => {
  it("labels planned evidence and links only authorized destinations", () => {
    render(<DailyExpectedPanel state={state} mode="all" canOpenIntake={true} canOpenTransport={true} />);
    expect(screen.getByText(/不是簽到結果/)).toBeTruthy(); expect(screen.getByText(/不能據此判定已派車/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "查看每週安排" })[0]?.getAttribute("href")).toContain("step=weekly");
    expect(screen.getByRole("link", { name: "開啟交通趟次計畫" }).getAttribute("href")).toContain("date=2026-09-14");
    fireEvent.click(screen.getByRole("button", { name: "重新讀取" })); expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("shows transport demand people only in transport mode", () => {
    render(<DailyExpectedPanel state={state} mode="transport" canOpenIntake={false} canOpenTransport={false} />);
    expect(screen.getByText("合成甲")).toBeTruthy(); expect(screen.queryByText("合成乙")).toBeNull(); expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
  it("never prints false zero when loading failed", () => {
    render(<DailyExpectedPanel state={{ status: "unavailable", serviceDate: "2026-09-14" }} mode="all" canOpenIntake={false} canOpenTransport={false} />);
    expect(screen.getByRole("alert").textContent).toContain("尚不能確認人數"); expect(screen.queryByRole("definition")).toBeNull();
  });
  it("shows a clear reason for a truly empty roster", () => {
    render(<DailyExpectedPanel state={{ ...state, clients: [], expectedCount: 0, transportClientCount: 0, outboundCount: 0 }} mode="all" canOpenIntake={false} canOpenTransport={false} />);
    expect(screen.getByText(/尚未收案、請假、停用/)).toBeTruthy();
  });
  it("keeps long rosters bounded until the user asks for more", () => {
    const clients = Array.from({ length: 12 }, (_, index) => ({ ...state.clients[0]!, clientId: `client-${index}`, displayName: `合成第${index + 1}位` }));
    render(<DailyExpectedPanel state={{ ...state, clients, expectedCount: 12 }} mode="all" canOpenIntake={false} canOpenTransport={false} />);
    expect(screen.queryByText("合成第11位")).toBeNull(); fireEvent.click(screen.getByRole("button", { name: /再顯示 10 位/ })); expect(screen.getByText("合成第11位")).toBeTruthy();
  });
  it("clears stale warning when server refresh supplies a fresh snapshot", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-14T01:00:00Z"));
    const current = { ...state, generatedAt: new Date().toISOString() };
    const { rerender } = render(<DailyExpectedPanel state={current} mode="all" canOpenIntake={false} canOpenTransport={false} />);
    act(() => { vi.advanceTimersByTime(60_001); });
    expect(screen.getByText(/資料已超過一分鐘/)).toBeTruthy();
    rerender(<DailyExpectedPanel state={{ ...current, generatedAt: new Date().toISOString() }} mode="all" canOpenIntake={false} canOpenTransport={false} />);
    expect(screen.queryByText(/資料已超過一分鐘/)).toBeNull();
  });
  it("shows exact direction states and filters people without merging two rides", () => {
    const ready: typeof state = { ...state, inboundCount: 1, clients: [{ ...state.clients[0]!, inbound: true }, state.clients[1]!], dispatch: { status: "ready", pendingCount: 1, assignedCount: 1, conflictCount: 0, restrictedCount: 0,
      rows: [{ clientId: state.clients[0]!.clientId, direction: "pickup", status: "pending", tripVersionIds: [] }, { clientId: state.clients[0]!.clientId, direction: "dropoff", status: "assigned", tripVersionIds: ["d0000000-0000-4000-8000-000000000001"] }] } };
    render(<DailyExpectedPanel state={ready} mode="all" canOpenIntake canOpenTransport />);
    expect(screen.getByText("到站去程：待派車")).toBeTruthy(); expect(screen.getByText("返家回程：已派車")).toBeTruthy();
    expect(screen.getByRole("link", { name: "核對當日去程" }).getAttribute("href")).toContain("date=2026-09-14&direction=pickup");
    expect(screen.getByRole("link", { name: "核對當日回程" }).getAttribute("href")).toContain("direction=dropoff");
    fireEvent.click(screen.getByRole("button", { name: "待派車 1 人次" }));
    expect(screen.queryByText("合成乙")).toBeNull(); expect(screen.getByText("返家回程：已派車")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重複待核對 0 人次" }));
    expect(screen.getByText(/沒有符合此派車核對狀態/)).toBeTruthy();
  });
  it("does not turn restricted matching into a pending trip or a trip link", () => {
    render(<DailyExpectedPanel state={{ ...state, dispatch: { status: "ready", pendingCount: 0, assignedCount: 0, conflictCount: 0, restrictedCount: 1, rows: [{ clientId: state.clients[0]!.clientId, direction: "pickup", status: "restricted", tripVersionIds: [] }] } }} mode="transport" canOpenIntake={false} canOpenTransport />);
    expect(screen.getByText("到站去程：派車資料無查閱權限")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "核對當日去程" })).toBeNull();
  });
});
