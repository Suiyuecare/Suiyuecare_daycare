// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type Link from "next/link";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { ClientContinuation, useCoreDraftGuard } from "./client-continuation";
import { NavigationLink } from "@/components/app/navigation-link";
import { CoreDraftGuardHost, requestCoreDraftLeave } from "@/components/app/core-draft-guard";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<typeof Link>) => <a href={String(href)} aria-current={props["aria-current"]} onClick={props.onClick}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const snapshot = buildDemoDailySnapshot("2026-09-10");
const second = snapshot.clients[1]!;
function continuation(overrides: Partial<ComponentProps<typeof ClientContinuation>> = {}) {
  return <ClientContinuation page={46} serviceDate={snapshot.serviceDate} clients={snapshot.clients}
    sourceAccess={snapshot.sourceAccess} {...overrides} />;
}

describe("select once and continue the authorized daily workflow", () => {
  it("requires an explicit choice and carries the second person into the current page", () => {
    render(continuation());
    expect(screen.getByRole("combobox", { name: "選擇個案" })).toHaveValue("");
    expect(screen.queryByRole("link", { name: "選定這位個案" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "選擇個案" }), { target: { value: second.clientId } });
    expect(screen.getByRole("link", { name: "選定這位個案" })).toHaveAttribute("href", `/app/staff/service-management/attendance?date=2026-09-10&client=${second.clientId}`);
  });
  it("preserves the selected person/date through all three steps and changing person", () => {
    render(continuation({ selectedClientId: second.clientId }));
    expect(screen.getByRole("heading", { name: `${second.displayName}的接續工作` })).toBeVisible();
    const steps = within(screen.getByRole("navigation", { name: "個案照顧三步驟" })).getAllByRole("link");
    expect(steps).toHaveLength(3);
    for (const link of steps) expect(link.getAttribute("href")).toContain(`?date=2026-09-10&client=${second.clientId}`);
    expect(steps[0]).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("link", { name: "更換個案" })).toHaveAttribute("href", "/app/staff/service-management/attendance?date=2026-09-10");
    expect(screen.getByRole("link", { name: "此個案的機構自訂表單" })).toHaveAttribute("href", `/app/client-forms?client=${second.clientId}`);
  });
  it("shows the selected person's primary action before the three-step navigation", () => {
    const activate = vi.fn();
    const { container } = render(continuation({ selectedClientId: second.clientId, action: <button type="button" onClick={activate}>登錄出勤</button> }));
    const action = screen.getByRole("button", { name: "登錄出勤" });
    const navigation = screen.getByRole("navigation", { name: "個案照顧三步驟" });
    expect(container.querySelector(".core-client-continuation--selected")).toBeInTheDocument();
    expect(action.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(action);
    expect(activate).toHaveBeenCalledOnce();
  });
  it("hides custom forms when this client has no care-record source access", () => {
    render(continuation({ selectedClientId: second.clientId, clients: [{ ...second, sourceAccess: { ...snapshot.sourceAccess, careDiaries: false } }] }));
    expect(screen.queryByRole("link", { name: "此個案的機構自訂表單" })).not.toBeInTheDocument();
  });
  it("does not call a draft completed or signed", () => {
    const client = { ...second, careDiary: { id: "synthetic", occurredAt: "2026-09-10T10:00:00+08:00", status: "draft" as const, hasAbnormalFlag: false } };
    render(continuation({ selectedClientId: second.clientId, clients: [client], page: 6 }));
    expect(screen.getByRole("link", { name: /3\. 日誌/u })).toHaveTextContent("已有草稿・未簽署");
  });
  it("preserves the selected shift but never treats daily evidence as proof of that shift", () => {
    const client = { ...second, careDiary: { id: "synthetic", occurredAt: "2026-09-10T09:00:00+08:00", status: "signed" as const, hasAbnormalFlag: false } };
    render(continuation({ selectedClientId: client.clientId, clients: [client], selectedShift: "afternoon", page: 6 }));
    const steps = within(screen.getByRole("navigation", { name: "個案照顧三步驟" })).getAllByRole("link");
    for (const link of steps) expect(link.getAttribute("href")).toContain("&shift=afternoon");
    expect(screen.getByRole("link", { name: "更換個案" })).toHaveAttribute("href", "/app/staff/daily-care/care-diary?date=2026-09-10&shift=afternoon");
    expect(screen.getByRole("link", { name: /3\. 日誌/u })).toHaveTextContent("當日有簽署・請核對班別");
  });
  it("does not call an unscoped latest signed diary proof that every shift is complete", () => {
    const client = { ...second, careDiary: { id: "synthetic", occurredAt: "2026-09-10T09:00:00+08:00", status: "signed" as const, hasAbnormalFlag: false } };
    render(continuation({ selectedClientId: client.clientId, clients: [client], page: 6 }));
    const diaryStep = screen.getByRole("link", { name: /3\. 日誌/u });
    expect(diaryStep).toHaveTextContent("當日有簽署・班別待核對");
    expect(diaryStep).not.toHaveTextContent("日誌已簽署");
  });
  it("does not expose unavailable source status or an actionable link", () => {
    render(continuation({ selectedClientId: second.clientId, sourceAccess: { ...snapshot.sourceAccess, measurements: false } }));
    expect(screen.queryByRole("link", { name: /2\. 量測/u })).not.toBeInTheDocument();
    expect(screen.getByText("無查閱權限")).toBeVisible();
    expect(screen.queryByText("已有量測")).not.toBeInTheDocument();
  });
  it("does not expose client labels when source access is absent", () => {
    const { container } = render(continuation({ selectedClientId: second.clientId, sourceAccess: { ...snapshot.sourceAccess, clients: false } }));
    expect(container.textContent).not.toContain(second.displayName);
    expect(container.textContent).not.toContain(second.clientCode);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("不表示今天沒有個案");
  });
  it.each(["a9999999-9999-4999-8999-999999999999", "javascript:alert(1)", ""])("does not fall back to another person for invalid selection %s", (selectedClientId) => {
    const { container } = render(continuation({ selectedClientId }));
    expect(screen.getByRole("alert")).toHaveTextContent("不會自動改用其他人");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain(second.displayName);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});

function GuardHarness() {
  const draft = useCoreDraftGuard();
  return <><button onClick={draft.changed}>編輯</button><button onClick={draft.begin}>開始儲存</button>
    <button onClick={() => { draft.finish(); draft.saved(); }}>確認儲存</button>
    <NavigationLink href="/app/dashboard" loadingLabel="工作台" onClick={(event) => event.preventDefault()}>前往工作台</NavigationLink>
    <form method="get" noValidate onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); }}><button>套用日期</button></form></>;
}

function HoldHarness() {
  const draft = useCoreDraftGuard();
  return <><button onClick={draft.changed}>編輯</button><button onClick={draft.begin}>開始儲存</button>
    <button onClick={() => { draft.hold(); draft.finish(); }}>結果未知</button>
    <button onClick={draft.unhold}>已確認未寫入</button><button onClick={draft.saved}>已確認儲存</button>
    <button onClick={(event) => draft.discard(() => {}, event.currentTarget)}>捨棄</button>
    <button onClick={(event) => requestCoreDraftLeave(() => {}, event.currentTarget)}>登出</button>
    <NavigationLink href="/app/dashboard" loadingLabel="工作台" onClick={(event) => event.preventDefault()}>工作台</NavigationLink>
    <form method="get" noValidate onSubmit={(event) => event.preventDefault()}><button>套用日期</button></form></>;
}

function MultipleGuardHarness() {
  const first = useCoreDraftGuard();
  const second = useCoreDraftGuard();
  return <><button onClick={first.changed}>編輯甲</button><button onClick={second.changed}>編輯乙</button>
    <button onClick={second.begin}>儲存乙</button><button onClick={() => { second.finish(); second.saved(); }}>乙已儲存</button>
    <button onClick={(event) => first.discard(() => {}, event.currentTarget)}>捨棄甲</button>
    <NavigationLink href="/app/dashboard" loadingLabel="工作台" onClick={(event) => event.preventDefault()}>前往工作台</NavigationLink>
    <form method="get" noValidate onSubmit={(event) => event.preventDefault()}><button>套用日期</button></form></>;
}

function unloadPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function renderGuard(content: React.ReactNode) {
  return render(<><CoreDraftGuardHost />{content}</>);
}

describe("unsent draft navigation guard", () => {
  it("keeps unknown writes held across link, GET, logout, and local discard until a definite result", () => {
    renderGuard(<HoldHarness />);
    fireEvent.click(screen.getByRole("button", { name: "開始儲存" }));
    fireEvent.click(screen.getByRole("button", { name: "結果未知" }));
    const link = screen.getByRole("link", { name: "工作台" });
    const departure = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(link, departure);
    expect(departure.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "套用日期" }));
    fireEvent.click(screen.getByRole("button", { name: "登出" }));
    fireEvent.click(screen.getByRole("button", { name: "捨棄" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(unloadPrevented()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "已確認未寫入" }));
    fireEvent.click(link);
    expect(screen.getByRole("alertdialog")).toHaveAttribute("open");
  });
  it("replays an in-app Link once after consent and restores focus after cancel", async () => {
    const onNavigate = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault());
    function ReplayHarness() { const draft = useCoreDraftGuard(); return <><button onClick={draft.changed}>編輯</button><NavigationLink href="/app/dashboard" loadingLabel="工作台" onClick={onNavigate}>工作台</NavigationLink></>; }
    renderGuard(<ReplayHarness />);
    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    const link = screen.getByRole("link", { name: "工作台" });
    link.focus();
    fireEvent.click(link);
    expect(onNavigate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "繼續填寫" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "繼續填寫" }));
    await waitFor(() => expect(link).toHaveFocus());
    fireEvent.click(link);
    fireEvent.click(within(dialog).getByRole("button", { name: "放棄輸入並離開" }));
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(unloadPrevented()).toBe(true);
  });
  it("clears a queued confirmation when its host unmounts", () => {
    function View({ host }: { host: boolean }) { return <>{host ? <CoreDraftGuardHost /> : null}<GuardHarness /></>; }
    const view = render(<View host />);
    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    fireEvent.click(screen.getByRole("link"));
    expect(screen.getByRole("alertdialog")).toHaveAttribute("open");
    view.rerender(<View host={false} />);
    expect(unloadPrevented()).toBe(true);
    view.rerender(<View host />);
    fireEvent.click(screen.getByRole("link"));
    expect(screen.getByRole("alertdialog")).toHaveAttribute("open");
  });
  it("clears a hard-navigation unload exemption when the host unmounts", () => {
    function View({ host }: { host: boolean }) {
      const draft = useCoreDraftGuard();
      return <>{host ? <CoreDraftGuardHost /> : null}<button onClick={draft.changed}>編輯</button>
        <form method="get" noValidate onSubmit={(event) => event.stopPropagation()}><button>套用日期</button></form></>;
    }
    const view = render(<View host />);
    const form = screen.getByRole("button", { name: "套用日期" }).closest("form")!;
    const requestSubmit = vi.spyOn(form, "requestSubmit").mockImplementation(() => {
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    });
    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    fireEvent.submit(form);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "放棄輸入並離開" }));
    expect(requestSubmit).toHaveBeenCalledOnce();
    view.rerender(<View host={false} />);
    expect(unloadPrevented()).toBe(true);
  });
  it("uses one app dialog for a dirty link and preserves the draft on cancel", () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    renderGuard(<GuardHarness />);
    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    fireEvent.click(screen.getByRole("link"));
    const dialog = screen.getByRole("alertdialog", { name: "放棄未儲存的內容並離開？" });
    expect(dialog).toHaveAttribute("open");
    expect(nativeConfirm).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "繼續填寫" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(unloadPrevented()).toBe(true);
  });
  it("blocks pending writes without asking and stops blocking after confirmed success", () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    renderGuard(<GuardHarness />);
    fireEvent.click(screen.getByRole("button", { name: "開始儲存" }));
    const departure = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole("link").dispatchEvent(departure);
    expect(departure.defaultPrevented).toBe(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(nativeConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "確認儲存" }));
    expect(unloadPrevented()).toBe(false);
  });
  it("preserves a dirty draft when a GET handler cancels resumed navigation", () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    renderGuard(<GuardHarness />);
    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    fireEvent.click(screen.getByRole("button", { name: "套用日期" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("open");
    fireEvent.click(within(dialog).getByRole("button", { name: "放棄輸入並離開" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(unloadPrevented()).toBe(true);
    fireEvent.click(screen.getByRole("link"));
    expect(dialog).toHaveAttribute("open");
    fireEvent.click(within(dialog).getByRole("button", { name: "放棄輸入並離開" }));
    expect(unloadPrevented()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "確認儲存" }));
    expect(unloadPrevented()).toBe(false);
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
  it("asks once for two dirty forms and keeps both protected on cancel", () => {
    const addUnload = vi.spyOn(window, "addEventListener");
    renderGuard(<MultipleGuardHarness />);
    expect(addUnload.mock.calls.filter(([name]) => name === "beforeunload")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "編輯甲" }));
    fireEvent.click(screen.getByRole("button", { name: "編輯乙" }));
    fireEvent.click(screen.getByRole("link", { name: "前往工作台" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("open");
    fireEvent.click(within(dialog).getByRole("button", { name: "繼續填寫" }));
    expect(unloadPrevented()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "捨棄甲" }));
    expect(dialog).toHaveAttribute("open");
    fireEvent.click(within(dialog).getByRole("button", { name: "放棄本次輸入" }));
    expect(unloadPrevented()).toBe(true);
  });
  it("checks every busy form before asking to leave and never clears another draft", () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    renderGuard(<MultipleGuardHarness />);
    fireEvent.click(screen.getByRole("button", { name: "編輯甲" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存乙" }));
    const link = screen.getByRole("link", { name: "前往工作台" });
    const departure = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(departure);
    expect(departure.defaultPrevented).toBe(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(unloadPrevented()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "捨棄甲" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(unloadPrevented()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "套用日期" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "乙已儲存" }));
    fireEvent.click(link);
    expect(screen.getByRole("alertdialog")).toHaveAttribute("open");
    expect(unloadPrevented()).toBe(true);
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
  it("removes the shared listener when the last draft owner unmounts", () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    const view = renderGuard(<MultipleGuardHarness />);
    fireEvent.click(screen.getByRole("button", { name: "編輯甲" }));
    expect(unloadPrevented()).toBe(true);
    view.unmount();
    expect(unloadPrevented()).toBe(false);
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});
