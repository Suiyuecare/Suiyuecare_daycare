// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pageCatalog } from "@/lib/catalog";
import { caseCenterHref } from "@/lib/case-center/query";
import type { CaseCenterClient, CaseCenterFilters, CaseCenterSnapshot } from "@/lib/case-center/types";

import { CaseCenterWorkspace } from "./case-center-workspace";

const page = pageCatalog.find((entry) => entry.number === 2)!;
const clientId = "02000000-0000-4000-8000-000000000001";
const actorId = "02000000-0000-4000-8000-000000000002";
const otherActorId = "02000000-0000-4000-8000-000000000003";
const serviceDate = "2026-09-10";

function filters(overrides: Partial<CaseCenterFilters> = {}): CaseCenterFilters {
  return { date: serviceDate, query: "", lifecycle: "all", service: "all", responsible: "all", page: 1, ...overrides };
}

function client(overrides: Partial<CaseCenterClient> = {}): CaseCenterClient {
  return {
    id: clientId, clientCode: "SYN-001", displayName: "合成個案甲",
    lifecycleStatus: "active", lifecycleState: "active", serviceStatus: "serving",
    admittedOn: "2026-01-01", endedOn: null, updatedAt: "2026-09-10T01:00:00.000Z",
    responsibility: { state: "known", people: [{ userId: actorId, label: "我（合成人員）", currentUser: true }] },
    ...overrides,
  };
}

function snapshot(overrides: Partial<CaseCenterSnapshot> = {}): CaseCenterSnapshot {
  return {
    generatedAt: "2026-09-10T01:00:00.000Z", serviceDate,
    clients: [client()], total: 1, visibleTotal: 1, page: 1, pageSize: 24, pageCount: 1,
    summary: { serving: 1, paused: 0, pending: 0, ended: 0 },
    responsibleOptions: [{ userId: actorId, label: "我（合成人員）", currentUser: true }],
    access: { assignments: "full_for_visible_clients", profileLabels: "names", responsibleFilterRestricted: false },
    demo: false,
    ...overrides,
  };
}

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let stage: HTMLElement | null;

function renderInStage(element: ReactElement) {
  stage = document.createElement("main");
  stage.className = "main-stage";
  document.body.append(stage);
  return render(element, { container: stage });
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  stage = null;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  window.history.replaceState({ __NA: true }, "", caseCenterHref(filters()));
});

afterEach(() => {
  cleanup();
  stage?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function flushFrame() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
}

function workLinks(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/app/staff/service-management/attendance?"]')];
}

describe("case center front-line next step", () => {
  it("shows a clear next step without engineering copy or a fake add action", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()} allowedDailyPages={[46, 3, 6]} canViewSummary />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("個案中心");
    expect(screen.getByText("先選擇個案，再接續當日的出勤、量測與照顧日誌。")).toBeTruthy();
    expect(screen.getByText("服務日期：2026/09/10")).toBeTruthy();
    expect(container.textContent).not.toMatch(/穩定個案 ID|資料列權限|保存在網址|尚未接線/);
    expect(screen.queryByRole("button", { name: /新增個案/ })).toBeNull();
    expect(container.querySelector("button[disabled]")).toBeNull();
  });

  it("takes both desktop and mobile actions to attendance with only the same date and stable client ID", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()} allowedDailyPages={[46]} canViewSummary />);
    const links = workLinks(container);
    expect(links).toHaveLength(2);
    for (const link of links) {
      const url = new URL(link.href);
      expect(url.pathname).toBe("/app/staff/service-management/attendance");
      expect(Object.fromEntries(url.searchParams)).toEqual({ date: serviceDate, client: clientId });
      expect(link.dataset.caseClientId).toBe(clientId);
      expect(link.getAttribute("aria-label")).toBe("開始 合成個案甲 的當日工作（2026/09/10）");
      expect(link.textContent).toBe("開始當日工作");
    }
    expect(screen.queryByRole("link", { name: /查看 合成個案甲 的當日紀錄/ })).toBeNull();
    expect(container.querySelectorAll("[data-case-client-id]")).toHaveLength(2);
  });

  it("does not promise daily work for a synthetic directory client outside today's care roster", () => {
    const demo = snapshot({ demo: true });
    const view = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={demo}
      allowedDailyPages={[46]} canViewSummary demoDailyClientIds={[]} />);
    expect(workLinks(view.container)).toHaveLength(0);
    expect(screen.getAllByText("所選日期沒有可接續的照顧工作，可查看紀錄或評估。")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /查看 合成個案甲 的當日紀錄/ })).toHaveLength(2);

    view.rerender(<CaseCenterWorkspace page={page} filters={filters()} snapshot={demo}
      allowedDailyPages={[46]} canViewSummary demoDailyClientIds={[clientId]} />);
    expect(workLinks(view.container)).toHaveLength(2);
    expect(screen.queryByText("所選日期沒有可接續的照顧工作，可查看紀錄或評估。")).toBeNull();
  });

  it("offers the same authorized person-specific assessment route on desktop and mobile", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()}
      canOpenAssessments allowedDailyPages={[46]} />);
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/app/assessments?client="]')];
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(`/app/assessments?client=${clientId}`);
      expect(link.dataset.caseClientId).toBe(clientId);
      expect(link.getAttribute("aria-label")).toBe("評估 合成個案甲（SYN-001）");
      expect(link.textContent).toBe("評估這位個案");
    }
  });

  it("does not promise assessment for a terminal client or absent page permission", () => {
    const terminal = render(<CaseCenterWorkspace page={page} filters={filters()}
      snapshot={snapshot({ clients: [client({ lifecycleStatus: "closed", lifecycleState: "closed", serviceStatus: "ended" })] })}
      canOpenAssessments />);
    expect(terminal.container.querySelector('a[href^="/app/assessments?"]')).toBeNull();
    terminal.unmount();
    const unauthorized = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()} />);
    expect(unauthorized.container.querySelector('a[href^="/app/assessments?"]')).toBeNull();
  });

  it("uses the chosen past service date rather than silently switching to today", () => {
    const date = "2026-05-01";
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters({ date })} snapshot={snapshot({ serviceDate: date })} allowedDailyPages={[46]} />);
    expect(workLinks(container)).toHaveLength(2);
    expect(new URL(workLinks(container)[0]!.href).searchParams.get("date")).toBe(date);
    expect(screen.getByText("服務日期：2026/05/01")).toBeTruthy();
  });

  it.each([
    ["pending admission", { lifecycleState: "pending_admission", admittedOn: null, serviceStatus: "pending" }],
    ["suspended", { lifecycleStatus: "suspended", lifecycleState: "suspended", serviceStatus: "paused" }],
    ["transferred", { lifecycleStatus: "transferred", lifecycleState: "transferred", serviceStatus: "ended", endedOn: "2026-09-01" }],
    ["closed", { lifecycleStatus: "closed", lifecycleState: "closed", serviceStatus: "ended", endedOn: "2026-09-01" }],
    ["deceased", { lifecycleStatus: "deceased", lifecycleState: "deceased", serviceStatus: "ended", endedOn: "2026-09-01" }],
    ["future admission", { admittedOn: "2026-09-11", serviceStatus: "pending" }],
    ["end date inclusive", { endedOn: serviceDate, serviceStatus: "ended" }],
    ["inconsistent future-admission status", { admittedOn: "2026-09-11" }],
    ["inconsistent missing admission", { admittedOn: null }],
    ["inconsistent expired status", { endedOn: "2026-09-09" }],
    ["inconsistent lifecycle", { lifecycleStatus: "closed" }],
  ] satisfies [string, Partial<CaseCenterClient>][]) ("never starts services for %s; authorized summary remains read-only navigation", (_name, override) => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot({ clients: [client(override)] })} allowedDailyPages={[46, 3, 6]} canViewSummary />);
    expect(workLinks(container)).toHaveLength(0);
    const links = screen.getAllByRole("link", { name: /查看 合成個案甲 的當日紀錄/ });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(new URL((link as HTMLAnchorElement).href).pathname).toBe("/app/staff/service-management/daily-summary");
    }
    expect(container.querySelectorAll(".case-center-action-note")).toHaveLength(2);
  });

  it.each([undefined, [], [3], [6], [3, 6], [54]])("does not infer attendance permission from %j", (allowedDailyPages) => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()} allowedDailyPages={allowedDailyPages} />);
    expect(workLinks(container)).toHaveLength(0);
    expect(container.querySelectorAll("[data-case-client-id]")).toHaveLength(0);
  });

  it("does not infer summary permission from daily-work permission", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()} allowedDailyPages={[46]} />);
    expect(workLinks(container)).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /查看.*當日紀錄/ })).toBeNull();
  });

  it("offers only the authorized summary when daily-work access is absent", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()} canViewSummary />);
    expect(workLinks(container)).toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /查看 合成個案甲 的當日紀錄/ })).toHaveLength(2);
    expect(container.querySelectorAll("[data-case-client-id]")).toHaveLength(2);
  });

  it("does not let synthetic preview invent missing action permissions", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot({ demo: true })} />);
    expect(container.querySelectorAll("[data-case-client-id]")).toHaveLength(0);
  });

  it("fails closed when the snapshot and selected service date disagree", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot({ serviceDate: "2026-09-09" })} allowedDailyPages={[46]} />);
    expect(workLinks(container)).toHaveLength(0);
  });
});

describe("case center filters and readable fallback states", () => {
  it("puts search and client work before optional management statistics and keeps full filters available", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()} allowedDailyPages={[46]} />);
    const form = container.querySelector<HTMLFormElement>("form")!;
    const statistics = screen.getByText("個案統計").closest("details")!;
    const advanced = screen.getByText("更多篩選").closest("details")!;
    expect(form.hasAttribute("novalidate")).toBe(true);
    expect(screen.getByRole("searchbox").getAttribute("maxlength")).toBe("120");
    expect(statistics.hasAttribute("open")).toBe(false);
    expect(advanced.hasAttribute("open")).toBe(false);
    expect(container.querySelector(".metric-grid")).toBeNull();
    expect(form.compareDocumentPosition(workLinks(container)[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(workLinks(container)[0]!.compareDocumentPosition(statistics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const data = new FormData(form);
    expect(Object.fromEntries(data)).toEqual({ date: serviceDate, q: "", lifecycle: "all", service: "all", responsible: "all" });
    expect(statistics.querySelectorAll("dt")).toHaveLength(5);
  });

  it("keeps active advanced filters visible and shortcuts preserve date, query and responsibility", () => {
    const selected = filters({ query: "合成 甲", lifecycle: "suspended", service: "paused", responsible: "me", page: 2 });
    render(<CaseCenterWorkspace page={page} filters={selected} snapshot={snapshot()} />);
    expect(screen.getByText("更多篩選（已套用 3 項）").closest("details")!.hasAttribute("open")).toBe(true);
    const quick = screen.getByRole("navigation", { name: "常用個案篩選" });
    expect(within(quick).getByRole("link", { name: "服務中" }).getAttribute("href")).toBe(
      caseCenterHref({ ...selected, lifecycle: "all", service: "serving", page: 1 }));
    expect(within(quick).getByRole("link", { name: "待收案" }).getAttribute("href")).toBe(
      caseCenterHref({ ...selected, lifecycle: "pending_admission", service: "all", page: 1 }));
    expect(screen.getByRole("button", { name: "清除搜尋個案代碼或姓名" })).toBeTruthy();
  });

  it("preserves all combined filters in pagination and resets only filter criteria on clear", () => {
    const selected = filters({ query: "合成 甲", lifecycle: "active", service: "serving", responsible: actorId, page: 2 });
    const { container } = render(<CaseCenterWorkspace page={page} filters={selected} snapshot={snapshot({ page: 2, pageCount: 3, total: 53 })} />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("合成 甲");
    expect((screen.getByLabelText("生命週期") as HTMLSelectElement).value).toBe("active");
    expect((screen.getByLabelText("服務狀態") as HTMLSelectElement).value).toBe("serving");
    expect((screen.getByLabelText("負責人") as HTMLSelectElement).value).toBe("me");
    expect(container.querySelector<HTMLInputElement>('input[name="date"]')?.value).toBe(serviceDate);
    expect(screen.getByRole("link", { name: "下一頁" }).getAttribute("href")).toBe(caseCenterHref({ ...selected, page: 3 }));
    expect(screen.getByRole("link", { name: "上一頁" }).getAttribute("href")).toBe(caseCenterHref({ ...selected, page: 1 }));
    expect(screen.getByRole("link", { name: "清除" }).getAttribute("href")).toBe(caseCenterHref(filters()));
  });

  it("keeps restricted responsibility distinct from an unassigned client", () => {
    const selected = filters({ responsible: otherActorId });
    render(<CaseCenterWorkspace page={page} filters={selected} snapshot={snapshot({ clients: [], total: 0,
      access: { assignments: "self_only", profileLabels: "codes", responsibleFilterRestricted: true },
    })} allowedDailyPages={[46]} canViewSummary />);
    expect(screen.getByRole("alert").textContent).toContain("無法使用這位責任人篩選");
    expect(screen.getByRole("link", { name: "清除責任人篩選" }).getAttribute("href")).toBe(caseCenterHref(filters()));
    expect(screen.getByText(/不代表尚未指派/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "沒有符合條件的個案" })).toBeNull();
  });

  it("offers actionable empty and load-error states without false work links", () => {
    const empty = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot({ clients: [], total: 0 })} allowedDailyPages={[46]} canViewSummary />);
    expect(screen.getByRole("heading", { name: "沒有符合條件的個案" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "清除篩選" })).toBeTruthy();
    expect(empty.container.querySelectorAll("[data-case-client-id]")).toHaveLength(0);
    empty.unmount();
    render(<CaseCenterWorkspace page={page} filters={filters({ query: "合成" })} snapshot={null} loadError allowedDailyPages={[46]} canViewSummary />);
    expect(screen.getByRole("alert").textContent).toContain("個案清單暫時無法載入");
    expect(screen.getByRole("link", { name: "重新載入" }).getAttribute("href")).toBe(caseCenterHref(filters({ query: "合成" })));
  });
});

describe("case center native return history", () => {
  it.each(["click", "Enter"])("saves the client and scroll before %s without losing existing Next history state", (activation) => {
    const selected = filters({ query: "SYN", page: 2 });
    window.history.replaceState({ __NA: true, preserved: "existing-router-state" }, "", caseCenterHref(selected));
    const { container } = renderInStage(<CaseCenterWorkspace page={page} filters={selected} snapshot={snapshot({ page: 2, pageCount: 2 })} allowedDailyPages={[46]} canViewSummary />);
    stage!.scrollTop = 456;
    const link = workLinks(container)[0]!;
    link.addEventListener("click", (event) => event.preventDefault());
    if (activation === "click") fireEvent.click(link);
    else fireEvent.keyDown(link, { key: "Enter" });
    expect(window.history.state).toMatchObject({
      __NA: true, preserved: "existing-router-state", caseCenterScrollTop: 456, caseCenterFocusClientId: clientId,
    });
    expect(`${window.location.pathname}${window.location.search}`).toBe(caseCenterHref(selected));
  });

  it("restores scroll and focuses the visible mobile link after returning", () => {
    window.history.replaceState({ __NA: true, caseCenterScrollTop: 380, caseCenterFocusClientId: clientId }, "", caseCenterHref(filters()));
    const { container } = renderInStage(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()} allowedDailyPages={[46]} canViewSummary />);
    const mobile = container.querySelector<HTMLElement>(".mobile-records")!;
    const link = within(mobile).getByRole("link", { name: /開始 合成個案甲/ });
    vi.spyOn(link, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    flushFrame();
    flushFrame();
    expect(stage!.scrollTop).toBe(380);
    expect(document.activeElement).toBe(link);
  });

  it("restores the sole summary action for a non-serving client", () => {
    window.history.replaceState({ __NA: true, caseCenterScrollTop: 380, caseCenterFocusClientId: clientId }, "", caseCenterHref(filters()));
    const { container } = renderInStage(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot({
      clients: [client({ lifecycleStatus: "suspended", lifecycleState: "suspended", serviceStatus: "paused" })],
    })} allowedDailyPages={[46]} canViewSummary />);
    const mobile = container.querySelector<HTMLElement>(".mobile-records")!;
    const link = within(mobile).getByRole("link", { name: /查看 合成個案甲 的當日紀錄/ });
    vi.spyOn(link, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    flushFrame();
    flushFrame();
    expect(workLinks(container)).toHaveLength(0);
    expect(stage!.scrollTop).toBe(380);
    expect(document.activeElement).toBe(link);
  });
});
