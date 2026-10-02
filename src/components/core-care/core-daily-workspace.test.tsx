// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type Link from "next/link";
import { pageCatalog } from "@/lib/catalog";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { CoreDailyWorkspace } from "./core-daily-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<typeof Link>) => <a href={String(href)} aria-current={props["aria-current"]}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const snapshot = buildDemoDailySnapshot("2026-09-10");
const selected = snapshot.clients[1]!;
function workspace(page: number, overrides: Partial<ComponentProps<typeof CoreDailyWorkspace>> = {}) {
  return <CoreDailyWorkspace page={pageCatalog.find((item) => item.number === page)!} moduleTitle="每日照顧"
    serviceDate={snapshot.serviceDate} snapshot={snapshot} canWrite {...overrides} />;
}

describe("daily care selected-client handoff and source boundaries", () => {
  it("keeps historical arrival evidence visible without inflating the current service-day arrival count", () => {
    const client = { ...snapshot.clients[0]!, applicability: { eligible: false, attendance: "not_expected" as const, care: "not_expected" as const, reason: "history_only" as const } };
    render(workspace(46, { snapshot: { ...snapshot, clients: [client] } }));
    expect(within(screen.getByText("已到").closest("article")!).getByText("0")).toBeInTheDocument();
    expect(screen.getAllByText(/當日不適用，保留紀錄/).length).toBeGreaterThan(0);
  });
  it("keeps a per-client restricted source from opening a composer or diary lifecycle", () => {
    const client = { ...selected, sourceAccess: { attendance: true, measurements: true, careDiaries: false, serviceEvents: true } };
    render(workspace(6, { selectedClientId: client.clientId, snapshot: { ...snapshot, clients: [client] }, diaryLifecycle: <div>PRIVATE_DIARY_LIFECYCLE</div> }));
    expect(screen.queryByRole("button", { name: "新增日誌草稿" })).not.toBeInTheDocument();
    expect(screen.queryByText("PRIVATE_DIARY_LIFECYCLE")).not.toBeInTheDocument();
  });
  it("does not label a selected unscheduled client as needing new care in the three-step navigation", () => {
    const client = { ...selected, attendance: null, vitalSigns: null, careDiary: null,
      applicability: { eligible: true, attendance: "not_expected" as const, care: "not_expected" as const, reason: "not_scheduled" as const } };
    render(workspace(3, { selectedClientId: client.clientId, snapshot: { ...snapshot, clients: [client] } }));
    expect(within(screen.getByRole("navigation", { name: "個案照顧三步驟" })).getAllByText("本日不列待填")).toHaveLength(3);
  });
  it("excludes unscheduled and leave cases from missing measurements while keeping their rows", () => {
    const make = (index: number, reason: "scheduled" | "not_scheduled" | "leave_or_absent") => ({ ...snapshot.clients[index]!, vitalSigns: null,
      applicability: { eligible: true, attendance: "expected" as const, care: reason === "scheduled" ? "expected" as const : "not_expected" as const, reason } });
    render(workspace(3, { snapshot: { ...snapshot, clients: [make(0, "scheduled"), make(1, "not_scheduled"), make(2, "leave_or_absent")] } }));
    const missing = screen.getByText("名單尚無量測").closest("article")!;
    expect(within(missing).getByText("1")).toBeInTheDocument();
    expect(screen.getAllByText(/本日未排服務/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("不列入待填").length).toBeGreaterThan(0);
  });
  it("shows unknown applicability separately instead of counting all visible clients missing", () => {
    render(workspace(46, { snapshot: { ...snapshot, clients: [{ ...snapshot.clients[0]!, attendance: null,
      applicability: { eligible: true, attendance: "unknown", care: "unknown", reason: "unknown" } }] } }));
    expect(within(screen.getByText("適用性待確認").closest("article")!).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByText("名單尚無出勤").closest("article")!).getByText("0（已確認）")).toBeInTheDocument();
  });
  it.each([
    [46, "登錄出勤", "簽到、簽退或登記未到"],
    [3, "新增量測", "新增生命徵象"],
    [6, "新增日誌草稿", "新增照顧日誌"],
  ] as const)("passes the selected second client into the real page %s composer", (page, trigger, title) => {
    render(workspace(page, { selectedClientId: selected.clientId }));
    expect(screen.queryByRole("region", { name: "本頁摘要" })).not.toBeInTheDocument();
    expect(screen.queryByText("先確認個案與日期，再接續出勤、量測和照顧日誌。")).toBeNull();
    expect(screen.getByRole("button", { name: trigger }).closest(".core-client-continuation")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: trigger }));
    const dialog = screen.getByRole("dialog", { name: title });
    expect(within(dialog).getByRole("group", { name: "已選定個案" })).toHaveTextContent(selected.displayName);
    expect(within(dialog).getByRole("group", { name: "已選定個案" })).toHaveTextContent(selected.clientCode);
    expect(dialog.querySelector('input[name="client_id"]')).toHaveValue(selected.clientId);
    expect(within(dialog).queryByRole("combobox", { name: "個案 *" })).not.toBeInTheDocument();
  });
  it.each([46, 3, 6])("requires selection in the continuation before opening page %s composer", (page) => {
    render(workspace(page));
    expect(screen.getByText("先確認個案與日期，再接續出勤、量測和照顧日誌。")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "選擇個案" })).toHaveValue("");
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText("請先在上方選定個案，再新增紀錄。")).toBeVisible();
  });
  it("retains the selected client and day on a failed-load retry", () => {
    render(workspace(3, { selectedClientId: selected.clientId, snapshot: null, loadError: true }));
    expect(screen.getByRole("link", { name: "重新載入" })).toHaveAttribute("href", `/app/staff/daily-care/vital-signs?date=2026-09-10&client=${selected.clientId}`);
  });
  it("carries shift through date changes, continuation links and the actual diary composer", () => {
    render(workspace(6, { selectedClientId: selected.clientId, selectedShift: "afternoon" }));
    const dateForm = screen.getByLabelText("服務日期").closest("form")!;
    expect(new FormData(dateForm).get("shift")).toBe("afternoon");
    for (const link of within(screen.getByRole("navigation", { name: "個案照顧三步驟" })).getAllByRole("link")) expect(link.getAttribute("href")).toContain("&shift=afternoon");
    fireEvent.click(screen.getByRole("button", { name: "新增日誌草稿" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("班別 *")).toHaveValue("afternoon");
  });
  it("puts a positively identified draft ahead of creating another, without treating absent snapshot data as proof", () => {
    const draftClient = { ...snapshot.clients[4]!, careDiary: { ...snapshot.clients[4]!.careDiary!, status: "draft" as const } };
    const current = { ...snapshot, clients: [draftClient] };
    const view = render(workspace(6, { selectedClientId: draftClient.clientId, snapshot: current,
      diaryLifecycle: <section id="diary-lifecycle-title">已儲存日誌</section> }));
    const continueLink = screen.getByRole("link", { name: "接續已存草稿" });
    const addButton = screen.getByRole("button", { name: "新增日誌草稿" });
    expect(continueLink).toHaveAttribute("href", "#diary-lifecycle-title");
    expect(addButton).toHaveClass("button--secondary");
    expect(continueLink.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    view.rerender(workspace(6, { selectedClientId: draftClient.clientId,
      snapshot: { ...current, clients: [{ ...draftClient, careDiary: { ...draftClient.careDiary, status: "submitted" } }] },
      diaryLifecycle: <section id="diary-lifecycle-title">待簽日誌</section> }));
    expect(screen.getByRole("link", { name: "檢視待簽日誌" })).toHaveAttribute("href", "#diary-lifecycle-title");
    expect(screen.getByRole("button", { name: "新增日誌草稿" })).toHaveClass("button--secondary");
    view.rerender(workspace(6, { selectedClientId: draftClient.clientId,
      snapshot: { ...current, clients: [{ ...draftClient, careDiary: null }] },
      diaryLifecycle: <section id="diary-lifecycle-title">正在核對原始日誌</section> }));
    expect(screen.queryByRole("link", { name: "接續已存草稿" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增日誌草稿" })).toHaveClass("button--primary");
  });
  it("keeps the original GET parameters while stopping a blank service day with inline feedback", () => {
    render(workspace(6, { selectedClientId: selected.clientId, selectedShift: "morning" }));
    const dateInput = screen.getByLabelText("服務日期") as HTMLInputElement;
    const dateForm = dateInput.closest("form")!;
    expect(dateForm).toHaveAttribute("method", "get");
    expect(dateForm).toHaveAttribute("novalidate");
    fireEvent.change(dateInput, { target: { value: "" } });
    const capturedSubmit = vi.fn();
    document.addEventListener("submit", capturedSubmit, true);
    fireEvent.click(screen.getByRole("button", { name: "套用日期" }));
    document.removeEventListener("submit", capturedSubmit, true);
    expect(capturedSubmit).not.toHaveBeenCalled();
    const invalidSubmit = new Event("submit", { bubbles: true, cancelable: true });
    fireEvent(dateForm, invalidSubmit);
    expect(invalidSubmit.defaultPrevented).toBe(true);
    expect(dateInput).toHaveFocus();
    expect(dateInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("請選擇服務日期。", { selector: "small" })).toHaveAttribute("id", dateInput.getAttribute("aria-describedby"));
    fireEvent.change(dateInput, { target: { value: "2026-09-11" } });
    expect(dateInput).not.toHaveAttribute("aria-invalid");
    const validSubmit = new Event("submit", { bubbles: true, cancelable: true });
    fireEvent(dateForm, validSubmit);
    expect(validSubmit.defaultPrevented).toBe(false);
    expect(Object.fromEntries(new FormData(dateForm))).toEqual({ client: selected.clientId, shift: "morning", date: "2026-09-11" });
  });
  it("does not submit the date form while an IME Enter is committing text", () => {
    render(workspace(3));
    const dateInput = screen.getByLabelText("服務日期");
    fireEvent.compositionStart(dateInput);
    const composingEnter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true });
    fireEvent(dateInput, composingEnter);
    expect(composingEnter.defaultPrevented).toBe(true);
    fireEvent.compositionEnd(dateInput);
  });
  it("retains shift when recovering a failed load", () => {
    render(workspace(6, { selectedClientId: selected.clientId, selectedShift: "morning", snapshot: null, loadError: true }));
    expect(screen.getByRole("link", { name: "重新載入" }).getAttribute("href")).toContain("&shift=morning");
  });
  it.each([46, 3, 6])("keeps the selected page %s record list focused on that person", (page) => {
    const { container } = render(workspace(page, { selectedClientId: selected.clientId }));
    const recordDetails = screen.getByText("查看完整紀錄").closest("details")!;
    expect(recordDetails).not.toHaveAttribute("open");
    expect(recordDetails).toContainElement(screen.getByRole("table"));
    fireEvent.click(within(recordDetails).getByText("查看完整紀錄"));
    expect(recordDetails).toHaveAttribute("open");
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    expect(container.querySelectorAll(".core-care-mobile .record-card")).toHaveLength(1);
    expect(screen.getByText("2026-09-10 · 1 位已選定個案")).toBeVisible();
  });
  it("keeps the full work list visible before a client is selected", () => {
    render(workspace(3));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("查看完整紀錄")).not.toBeInTheDocument();
    expect(screen.getByText(/資料更新於/u)).toBeVisible();
  });
  it.each([46, 3, 6])("does not let an invalid page %s selection fall back to any other composer", (page) => {
    render(workspace(page, { selectedClientId: "a9999999-9999-4999-8999-999999999999" }));
    expect(screen.getByRole("alert")).toHaveTextContent("不會自動改用其他人");
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("does not expose client identities or zero totals when client access is false", () => {
    const { container } = render(workspace(3, { snapshot: { ...snapshot, sourceAccess: { ...snapshot.sourceAccess, clients: false } } }));
    expect(container.textContent).not.toContain(selected.displayName);
    expect(container.textContent).not.toContain(selected.clientCode);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本頁摘要" })).not.toBeInTheDocument();
  });
  it.each([[46, "attendance"], [3, "measurements"], [6, "careDiaries"]] as const)("does not render a page %s record list when its source is unauthorized", (page, source) => {
    render(workspace(page, { snapshot: { ...snapshot, sourceAccess: { ...snapshot.sourceAccess, [source]: false } } }));
    expect(screen.getByRole("heading", { name: "目前沒有本頁資料查看權限" })).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本頁摘要" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
  });
  it("marks unauthorized secondary sources instead of absence, zero or complete", () => {
    const { container } = render(workspace(6, { selectedClientId: selected.clientId,
      snapshot: { ...snapshot, clients: [selected], sourceAccess: { ...snapshot.sourceAccess, attendance: false, measurements: false, serviceEvents: false } } }));
    expect(screen.getAllByText("無查閱權限").length).toBeGreaterThan(2);
    expect(container.textContent).not.toContain("0 筆");
    expect(container.textContent).not.toContain("資料完整");
    expect(container.textContent).not.toContain("已有量測");
  });
  it("keeps actual permission and verification rules while disabling write actions", () => {
    render(workspace(6, { canWrite: false, selectedClientId: selected.clientId }));
    expect(screen.getByRole("button", { name: "新增日誌草稿" })).toBeDisabled();
    expect(screen.getByText(/新增紀錄需要對應權限及身分驗證/u)).toBeVisible();
    const rules = screen.getByText("資料來源與驗證說明").closest("details")!;
    expect(rules).not.toHaveAttribute("open");
    expect(rules.textContent).toContain("身分驗證");
    expect(rules.textContent).not.toContain("AAL2");
    expect(rules.textContent).toContain("最近 15 分鐘");
    fireEvent.click(within(rules).getByText("資料來源與驗證說明"));
    expect(within(rules).getByText(/週表、單日調整與實到/u)).toBeVisible();
  });
});
