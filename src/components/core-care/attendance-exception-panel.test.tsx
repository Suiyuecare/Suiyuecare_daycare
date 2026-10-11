// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type Link from "next/link";

import { taipeiToday } from "@/lib/core-care/date";

import { AttendanceExceptionPanel } from "./attendance-exception-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<typeof Link>) =>
    <a href={String(href)} aria-current={props["aria-current"]}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const clientA = "51000000-0000-4000-8000-000000000001";
const clientB = "51000000-0000-4000-8000-000000000002";
const requestA = "52000000-0000-4000-8000-000000000001";
const worker = "53000000-0000-4000-8000-000000000001";
const director = "53000000-0000-4000-8000-000000000002";
const measuredAt = new Date(Date.now() - 60_000).toISOString();
function item(overrides: Record<string, unknown> = {}) {
  return {
    id: requestA, client_id: clientA, client_name: "合成個案甲", client_code: "A001",
    requester_user_id: worker, requester_name: "合成照服員",
    service_date: taipeiToday(), requested_at: new Date().toISOString(),
    reason_code: "measurement_preexisting", reason_note: "已量測但未簽到", status: "pending",
    measurement_at: measuredAt, measurement_source: "device", resolved_arrival_at: null,
    decision_note: null, resolved_at: null, ...overrides,
  };
}
function snapshot(requests: ReturnType<typeof item>[] = []) {
  return { data: { service_date: taipeiToday(), requests, reviewer: true } };
}
function props(overrides: Partial<ComponentProps<typeof AttendanceExceptionPanel>> = {}) {
  return {
    serviceDate: taipeiToday(), selectedClientId: clientA, selectedClientName: "合成個案甲",
    hasAttendance: false, hasVital: false, caregiverMode: true, directorMode: false,
    canWrite: true, canApproveException: false, hasRecentExceptionAal2: false,
    userId: worker, ...overrides,
  };
}

describe("case-attendance exception UI", () => {
  it("fails closed when the scoped status cannot load", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AttendanceExceptionPanel {...props()} />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "送主任覆核" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the selected Taipei service date with a no-vital request", async () => {
    const fetchMock = vi.fn().mockImplementation((_input: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ data: {
        persisted: true, request: { id: requestA, client_id: clientA, service_date: taipeiToday(),
          status: "pending", replayed: false, attendance_id: null },
      } }), { status: 201 }));
      return Promise.resolve(new Response(JSON.stringify(snapshot()), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AttendanceExceptionPanel {...props()} />);
    fireEvent.click(await screen.findByRole("button", { name: "送主任覆核" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({
      client_id: clientA, service_date: taipeiToday(), reason_code: "refused",
    });
  });

  it("keeps approval disabled until scoped director reauthentication and a confirmed arrival", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot([item()])), { status: 200 })));
    render(<AttendanceExceptionPanel {...props({ caregiverMode: false, directorMode: true,
      canWrite: false, canApproveException: true, userId: director })} />);
    expect(await screen.findByText(/首筆有效量測/)).toHaveTextContent("設備量測");
    expect(screen.getByRole("button", { name: "核准簽到" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "駁回" })).toBeDisabled();
    const link = screen.getByRole("link", { name: "前往驗證" });
    expect(link.getAttribute("href")).toContain("/mfa?audience=staff&purpose=sensitive-action&next=");
    expect(decodeURIComponent(link.getAttribute("href") ?? "")).toContain(`client=${clientA}`);
  });

  it("requires director rationale and explicit first-measurement arrival confirmation", async () => {
    const fetchMock = vi.fn().mockImplementation((_input: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ data: {
        persisted: true, request: { id: requestA, client_id: clientA, service_date: taipeiToday(),
          status: "approved", replayed: false, attendance_id: "54000000-0000-4000-8000-000000000001" },
      } }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify(snapshot([item()])), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AttendanceExceptionPanel {...props({ caregiverMode: false, directorMode: true,
      canWrite: false, canApproveException: true, hasRecentExceptionAal2: true, userId: director })} />);
    fireEvent.click(await screen.findByRole("button", { name: "核准簽到" }));
    const confirm = screen.getByRole("button", { name: "確認核准" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "核對依據／理由 *" }), { target: { value: "已核對門口登記與量測時間" } });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /我已核對這是個案實際到場時間/ }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({
      request_id: requestA, decision: "approve", confirmed_arrival_at: measuredAt,
      decision_note: "已核對門口登記與量測時間",
    });
  });

  it("never retries case A's uncertain director decision while viewing case B", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ forged: true }), { status: 200 }));
      const url = String(input);
      return Promise.resolve(new Response(JSON.stringify(snapshot(url.includes(clientB) ? [] : [item({
        reason_code: "refused", measurement_at: null, measurement_source: null,
      })])), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const initial = props({ caregiverMode: false, directorMode: true, canWrite: false,
      canApproveException: true, hasRecentExceptionAal2: true, userId: director });
    const view = render(<AttendanceExceptionPanel {...initial} />);
    fireEvent.click(await screen.findByRole("button", { name: "核准簽到" }));
    fireEvent.change(screen.getByLabelText("實際到場時間（臺北）*"),
      { target: { value: `${taipeiToday()}T00:01` } });
    fireEvent.change(screen.getByRole("textbox", { name: "核對依據／理由 *" }),
      { target: { value: "核對門口登記" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /我已核對這是個案實際到場時間/ }));
    fireEvent.click(screen.getByRole("button", { name: "確認核准" }));
    await screen.findByText(/上一筆 合成個案甲.*結果待確認/);
    view.rerender(<AttendanceExceptionPanel {...initial} selectedClientId={undefined} selectedClientName={undefined} />);
    await screen.findByText(/先回到 合成個案甲/);
    expect(screen.getByRole("button", { name: "重試同一次" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "送主任覆核" })).not.toBeInTheDocument();
    view.rerender(<AttendanceExceptionPanel {...initial} selectedClientId={clientB} selectedClientName="合成個案乙" />);
    await screen.findByText(/先回到 合成個案甲/);
    expect(screen.getByRole("button", { name: "重試同一次" })).toBeDisabled();
    expect(fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "POST")).toHaveLength(1);
    view.rerender(<AttendanceExceptionPanel {...initial} />);
    const retry = screen.getByRole("button", { name: "重試同一次" });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "POST")).toHaveLength(2));
    const posts = fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "POST");
    expect((posts[1][1] as RequestInit).body).toBe((posts[0][1] as RequestInit).body);
    expect((posts[1][1] as RequestInit).headers).toEqual((posts[0][1] as RequestInit).headers);
  });
});
