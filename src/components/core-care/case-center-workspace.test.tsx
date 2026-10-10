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
  it("gives a pure care worker a compact person list without removing search, filters or authorized work", () => {
    const selected = filters({ query: "合成", lifecycle: "active", service: "serving", responsible: actorId });
    const { container } = render(<CaseCenterWorkspace caregiverMode page={page} filters={selected} snapshot={snapshot()}
      allowedDailyPages={[46]} canViewSummary />);
    expect(screen.getByText("找人，開始照顧。")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "個案摘要，左右捲動可查看五項統計" })).toBeNull();
    expect(container.querySelector(".core-care-callout")).toBeNull();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent?.trim())).toEqual([
      "個案", "服務狀態", "動作",
    ]);
    expect(within(table).getByText("合成個案甲")).toBeTruthy();
    expect(within(table).getByText("服務中")).toBeTruthy();
    expect(container.querySelector(".core-care-mobile .core-care-card-grid")).toBeNull();
    expect(workLinks(container)).toHaveLength(2);
    const form = container.querySelector<HTMLFormElement>("form.case-center-filters")!;
    expect(Object.fromEntries(new FormData(form))).toEqual({
      date: serviceDate, q: "合成", lifecycle: "active", service: "serving", responsible: "me",
    });
    expect(screen.getByText("第 1 / 1 頁，共 1 位符合條件")).toBeTruthy();
  });

  it("does not advertise intake or guaranteed work completion to a pure care worker", () => {
    const { container } = render(<CaseCenterWorkspace caregiverMode page={page} filters={filters()} snapshot={snapshot()}
      allowedDailyPages={[46]} canViewSummary canOpenIntake canCreateIntake />);
    expect(container.querySelector('a[href="/app/client-intake"]')).toBeNull();
    expect(screen.getAllByRole("link", { name: /查看 合成個案甲 的當日工作/ })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /開始 合成個案甲 的當日工作/ })).toBeNull();
  });

  it.each([
    ["待收案", { lifecycleState: "pending_admission", admittedOn: null, serviceStatus: "pending" }, "尚未收案，請先完成收案。"],
    ["暫停", { lifecycleStatus: "suspended", lifecycleState: "suspended", serviceStatus: "paused" }, "目前暫停服務，不開啟當日照顧。"],
  ] satisfies [string, Partial<CaseCenterClient>, string][])("keeps a pure care worker's %s person read-only, with the reason visible", (_state, override, reason) => {
    const { container } = render(<CaseCenterWorkspace caregiverMode page={page} filters={filters()}
      snapshot={snapshot({ clients: [client(override)] })}
      allowedDailyPages={[46]} canViewSummary />);
    expect(workLinks(container)).toHaveLength(0);
    expect(screen.getAllByText(reason)).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /查看 合成個案甲 的當日紀錄/ })).toHaveLength(2);
  });

  it("shows a clear next step without engineering copy or a fake add action", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()} allowedDailyPages={[46, 3, 6]} canViewSummary />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("個案中心");
    expect(screen.getByText("選好個案，直接接續有權限的工作。")).toBeTruthy();
    expect(screen.getByText("服務日期：2026/09/10")).toBeTruthy();
    expect(screen.getByRole("region", { name: "個案摘要，左右捲動可查看五項統計" }).classList.contains("case-center-metrics")).toBe(true);
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

  it("lets a social worker continue with the selected person when attendance is unavailable", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()}
      allowedContinuationPages={[28]} />);
    expect(workLinks(container)).toHaveLength(0);
    const links = screen.getAllByRole("link", { name: "開啟 合成個案甲 的心理社會評估" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      const url = new URL((link as HTMLAnchorElement).href);
      expect(url.pathname).toBe("/app/staff/social-work/psychosocial-assessment");
      expect(Object.fromEntries(url.searchParams)).toEqual({ client: clientId });
      expect(link.getAttribute("data-case-client-id")).toBe(clientId);
    }
    expect(screen.queryByText("當日工作尚未開放，請洽主管確認。")).toBeNull();
  });

  it("keeps nursing work for the same person and selected date without exposing unrelated pages", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()}
      allowedContinuationPages={[7, 8]} />);
    const primary = screen.getAllByRole("link", { name: "開啟 合成個案甲 的用藥紀錄" });
    expect(primary).toHaveLength(2);
    expect(Object.fromEntries(new URL((primary[0] as HTMLAnchorElement).href).searchParams)).toEqual({ date: serviceDate, client: clientId });
    expect(screen.queryByRole("link", { name: /心理社會評估/ })).toBeNull();
    const mobile = container.querySelector<HTMLElement>(".mobile-records")!;
    expect(within(mobile).getByText("其他工作")).toBeTruthy();
    fireEvent.click(within(mobile).getByText("其他工作"));
    expect(new URL((within(mobile).getByRole("link", { name: "開啟 合成個案甲 的用藥計畫" }) as HTMLAnchorElement).href).searchParams.get("client")).toBe(clientId);
  });

  it("does not offer today's medication execution for a paused person, and keeps demo links truthful", () => {
    const paused = client({ lifecycleStatus: "suspended", lifecycleState: "suspended", serviceStatus: "paused" });
    const view = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot({ clients: [paused] })}
      allowedContinuationPages={[7, 8, 28]} />);
    expect(screen.queryByRole("link", { name: /用藥紀錄/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: "開啟 合成個案甲 的心理社會評估" })).toHaveLength(2);
    view.unmount();
    render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot({ demo: true })}
      allowedContinuationPages={[7, 8, 28]} />);
    expect(screen.queryByRole("link", { name: /心理社會評估|用藥計畫|用藥紀錄/ })).toBeNull();
  });

  it("puts the mobile next step immediately after identity while retaining safety details and all five metrics", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()} allowedDailyPages={[46]} />);
    const mobileCard = container.querySelector<HTMLElement>(".core-care-mobile .record-card")!;
    expect(mobileCard.children[0]?.classList.contains("record-card__top")).toBe(true);
    expect(mobileCard.children[1]?.classList.contains("case-center-actions")).toBe(true);
    expect(mobileCard.children[2]?.classList.contains("core-care-card-grid")).toBe(true);
    expect(within(mobileCard).getByText("生命週期")).toBeTruthy();
    expect(within(mobileCard).getByText("負責人")).toBeTruthy();
    expect(container.querySelectorAll(".case-center-metrics .metric-card")).toHaveLength(5);
    expect(container.querySelector(".case-center-context")).toBeTruthy();
    expect(container.querySelector(".case-center-heading")).toBeTruthy();
  });

  it("does not offer dead-end daily links for demo directory-only clients", () => {
    const directoryOnly = client({ id: "00000014-aaaa-4aaa-8aaa-000000000014", clientCode: "DEMO-020", displayName: "展示個案 20" });
    const runnable = client({ id: "a1111111-1111-4111-8111-111111111111", clientCode: "HX-021", displayName: "陳O華" });
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot({
      demo: true, clients: [directoryOnly, runnable], total: 2, visibleTotal: 2,
    })} allowedDailyPages={[46]} canViewSummary />);
    expect(workLinks(container)).toHaveLength(2);
    expect(workLinks(container).every((link) => new URL(link.href).searchParams.get("client") === runnable.id)).toBe(true);
    expect(screen.getAllByText("僅供清單展示，無當日紀錄。")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /查看 展示個案 20 的當日紀錄/ })).toBeNull();
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
  it("keeps the GET filters in a collapsed disclosure with a readable applied summary", () => {
    const selected = filters({ query: "合成 甲", lifecycle: "active", service: "serving", responsible: actorId });
    const { container } = render(<CaseCenterWorkspace page={page} filters={selected} snapshot={snapshot()} />);
    const form = container.querySelector<HTMLFormElement>("form.case-center-filters")!;
    const disclosure = form.querySelector<HTMLDetailsElement>(".case-center-advanced-filters")!;

    expect(form.method).toBe("get");
    expect(form.action).toContain("/app/staff/workspace/case-center#case-center-list");
    expect(form.noValidate).toBe(true);
    expect(disclosure.open).toBe(false);
    expect(screen.getByText("已套用：在案、服務中、我（合成人員）")).toBeTruthy();
    expect(Object.fromEntries(new FormData(form))).toEqual({
      date: serviceDate, q: "合成 甲", lifecycle: "active", service: "serving", responsible: "me",
    });

    fireEvent.click(screen.getByText("展開篩選"));
    expect(disclosure.open).toBe(true);
    expect(screen.getByRole("button", { name: "套用篩選" })).toBeTruthy();
    fireEvent.click(screen.getByText("收合篩選"));
    expect(disclosure.open).toBe(false);
  });

  it("clears the search immediately and submits the current filters back to the search field", () => {
    const selected = filters({ query: "合成 甲", lifecycle: "active" });
    const { container } = render(<CaseCenterWorkspace page={page} filters={selected} snapshot={snapshot()} />);
    const form = container.querySelector<HTMLFormElement>("form.case-center-filters")!;
    const submit = vi.fn();
    form.requestSubmit = submit;
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    fireEvent.change(screen.getByLabelText("生命週期"), { target: { value: "suspended" } });

    fireEvent.click(screen.getByRole("button", { name: "清除搜尋" }));

    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(new FormData(form).get("lifecycle")).toBe("suspended");
    expect(submit).toHaveBeenCalledTimes(1);
    expect((submit.mock.calls[0] as HTMLButtonElement[])[0]?.getAttribute("formaction"))
      .toBe("/app/staff/workspace/case-center#case-center-search");
  });

  it("does not submit a search while a Chinese IME candidate is being selected", () => {
    render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()} />);
    const input = screen.getByRole("searchbox");
    fireEvent.compositionStart(input);
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true, cancelable: true })).toBe(false);
    fireEvent.compositionEnd(input);
    expect(fireEvent.keyDown(input, { key: "Enter", cancelable: true })).toBe(true);
  });

  it("preserves all combined filters in pagination and resets only filter criteria on clear", () => {
    const selected = filters({ query: "合成 甲", lifecycle: "active", service: "serving", responsible: actorId, page: 2 });
    const { container } = render(<CaseCenterWorkspace page={page} filters={selected} snapshot={snapshot({ page: 2, pageCount: 3, total: 53 })} />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("合成 甲");
    expect((screen.getByLabelText("生命週期") as HTMLSelectElement).value).toBe("active");
    expect((screen.getByLabelText("服務狀態") as HTMLSelectElement).value).toBe("serving");
    expect((screen.getByLabelText("負責人") as HTMLSelectElement).value).toBe("me");
    expect(container.querySelector<HTMLInputElement>('input[name="date"]')?.value).toBe(serviceDate);
    expect(screen.getByRole("link", { name: "下一頁" }).getAttribute("href")).toBe(`${caseCenterHref({ ...selected, page: 3 })}#case-center-list`);
    expect(screen.getByRole("link", { name: "上一頁" }).getAttribute("href")).toBe(`${caseCenterHref({ ...selected, page: 1 })}#case-center-list`);
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
    const empty = render(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot({ clients: [], total: 0, visibleTotal: 0 })} allowedDailyPages={[46]} canViewSummary />);
    expect(screen.getByRole("heading", { name: "目前沒有可見個案" })).toBeTruthy();
    expect(screen.getByText("請主管確認個案指派或資料來源。")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "清除篩選" })).toBeNull();
    expect(empty.container.querySelectorAll("[data-case-client-id]")).toHaveLength(0);
    empty.unmount();
    render(<CaseCenterWorkspace page={page} filters={filters({ query: "合成" })} snapshot={null} loadError allowedDailyPages={[46]} canViewSummary />);
    expect(screen.getByRole("alert").textContent).toContain("個案清單暫時無法載入");
    expect(screen.getByRole("link", { name: "重新載入" }).getAttribute("href")).toBe(caseCenterHref(filters({ query: "合成" })));
  });

  it("offers one existing intake entry for an unfiltered empty branch with create scopes", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()}
      snapshot={snapshot({ clients: [], total: 0, visibleTotal: 0 })} canOpenIntake canCreateIntake />);
    expect(screen.getByRole("heading", { name: "目前沒有可見個案" })).toBeTruthy();
    expect(screen.getByText("可前往收案頁建立個案。")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "個案匯入與收案" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/app/client-intake");
    expect(container.querySelector(".empty-card a.button--primary")).toBe(links[0]);
    expect(screen.queryByRole("link", { name: "清除篩選" })).toBeNull();
  });

  it("keeps read-only intake navigation without claiming that the viewer can create a client", () => {
    const { container } = render(<CaseCenterWorkspace page={page} filters={filters()}
      snapshot={snapshot({ clients: [], total: 0, visibleTotal: 0 })} canOpenIntake />);
    expect(screen.getByText("請主管確認個案指派或資料來源。")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "個案匯入與收案" })).toHaveLength(1);
    expect(container.querySelector(".empty-card a")).toBeNull();
    expect(screen.queryByText("可前往收案頁建立個案。")).toBeNull();
  });

  it.each([
    ["search", { query: "找不到" }],
    ["advanced filter", { service: "paused" as const }],
  ])("retains clear-filters for a zero-result %s", (_name, override) => {
    const selected = filters(override);
    const { container } = render(<CaseCenterWorkspace page={page} filters={selected}
      snapshot={snapshot({ clients: [], total: 0, visibleTotal: 0 })} canOpenIntake canCreateIntake />);
    expect(screen.getByRole("heading", { name: "沒有符合條件的個案" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "清除篩選" }).getAttribute("href")).toBe(caseCenterHref(filters()));
    expect(container.querySelector(".empty-card a[href='/app/client-intake']")).toBeNull();
  });
});

describe("case center return history", () => {
  it("focuses the new list heading after pagination without requiring a pointer", () => {
    const selected = filters({ page: 2 });
    window.history.replaceState({ __NA: true }, "", `${caseCenterHref(selected)}#case-center-list`);
    renderInStage(<CaseCenterWorkspace page={page} filters={selected} snapshot={snapshot({ page: 2, pageCount: 2 })} />);
    flushFrame();
    flushFrame();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "個案工作清單" }));
  });

  it("returns focus to the search field after clearing and loading results", () => {
    window.history.replaceState({ __NA: true }, "", `${caseCenterHref(filters())}#case-center-search`);
    renderInStage(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()} />);
    flushFrame();
    flushFrame();
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

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

  it("keeps the source position when a client-side route change unmounts the list", () => {
    const view = renderInStage(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot()} allowedDailyPages={[46]} />);
    const link = workLinks(view.container)[0]!;
    stage!.scrollTop = 456;
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    stage!.scrollTop = 0;
    view.unmount();
    expect(window.history.state).toMatchObject({ caseCenterScrollTop: 456, caseCenterFocusClientId: clientId });
  });

  it("does not restore a removed client onto an unrelated authorized row", () => {
    window.history.replaceState({ __NA: true, caseCenterScrollTop: 380, caseCenterFocusClientId: clientId }, "", caseCenterHref(filters()));
    renderInStage(<CaseCenterWorkspace page={page} filters={filters()} snapshot={snapshot({
      clients: [client({ id: "02000000-0000-4000-8000-000000000099", clientCode: "SYN-099" })],
    })} allowedDailyPages={[46]} />);
    stage!.scrollTop = 99;
    flushFrame();
    flushFrame();
    expect(stage!.scrollTop).toBe(0);
    expect(stage!.querySelector<HTMLElement>("[data-case-client-id]")?.dataset.caseClientId).not.toBe(clientId);
  });
});
