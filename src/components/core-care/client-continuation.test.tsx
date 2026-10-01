// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type Link from "next/link";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { ClientContinuation, CoreDraftConfirmation, useCoreDraftGuard } from "./client-continuation";
import { NavigationLink } from "@/components/app/navigation-link";
import { clearUnsavedChangesOnLogout, requestUnsavedExit } from "@/lib/navigation/unsaved-changes";
import { tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<typeof Link>) => <a href={String(href)} aria-current={props["aria-current"]} onClick={props.onClick}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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
  it("continues from an eligible selected client to assessment only when the server offered the entry", () => {
    const { rerender } = render(continuation({ selectedClientId: second.clientId, canOpenAssessments: true }));
    expect(screen.getByRole("link", { name: "評估這位個案" })).toHaveAttribute("href", `/app/assessments?client=${second.clientId}`);
    rerender(continuation({ selectedClientId: second.clientId }));
    expect(screen.queryByRole("link", { name: "評估這位個案" })).not.toBeInTheDocument();
    rerender(continuation({ selectedClientId: second.clientId, canOpenAssessments: true,
      clients: [{ ...second, applicability: { attendance: "not_expected", care: "not_expected", reason: "history_only", eligible: false } }] }));
    expect(screen.queryByRole("link", { name: "評估這位個案" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "更換個案" })).toHaveAttribute("href", "/app/staff/daily-care/care-diary?date=2026-09-10");
    expect(screen.getByRole("link", { name: /3\. 日誌/u })).toHaveTextContent("當日有簽署・請核對班別");
  });
  it("identifies attendance as a date-level record while preserving confirmed work context", () => {
    render(continuation({ selectedClientId: second.clientId, selectedShift: "morning" }));
    expect(screen.getByText(/目前班別：上午班（出勤按當日）/)).toBeVisible();
    const steps = within(screen.getByRole("navigation", { name: "個案照顧三步驟" })).getAllByRole("link");
    for (const link of steps) expect(link.getAttribute("href")).toContain("&shift=morning");
    expect(steps[0]).toHaveTextContent("出勤");
    expect(steps[0]).not.toHaveTextContent("上午出勤");
  });
  it("clears the first client's shift when switching to a different client", () => {
    const first = snapshot.clients[0]!;
    render(continuation({ selectedClientId: first.clientId, selectedShift: "morning", page: 6 }));
    expect(screen.getByRole("link", { name: "更換個案" })).toHaveAttribute("href", "/app/staff/daily-care/care-diary?date=2026-09-10");
    cleanup();
    render(continuation({ selectedShift: "morning", page: 6 }));
    fireEvent.change(screen.getByRole("combobox", { name: "選擇個案" }), { target: { value: second.clientId } });
    expect(screen.getByRole("link", { name: "選定這位個案" })).toHaveAttribute("href", `/app/staff/daily-care/care-diary?date=2026-09-10&client=${second.clientId}`);
    expect(screen.queryByText(/目前班別：上午班/)).not.toBeInTheDocument();
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

function GuardHarness({ scope = "daily", revision = "1", blocked = false, onDiscard = () => {}, proceed = () => {}, submit = () => {} }: {
  scope?: string; revision?: string; blocked?: boolean; onDiscard?: () => void; proceed?: () => void; submit?: () => void;
}) {
  const draft = useCoreDraftGuard({ scopeKey: scope, revisionKey: revision, isBlocked: () => blocked, onDiscard });
  return <><button onClick={draft.changed}>編輯</button><button onClick={draft.begin}>開始儲存</button>
    <button onClick={() => { draft.finish(); draft.saved(); }}>確認儲存</button>
    <button onClick={() => draft.requestExit(proceed)}>離開填寫</button>
    <NavigationLink href="/app/dashboard" loadingLabel="工作台" onClick={(event) => event.preventDefault()}>前往工作台</NavigationLink>
    <form noValidate method="get" action="/app/dashboard" onSubmit={(event) => { event.preventDefault(); submit(); }}><input name="date" defaultValue="2026-09-10" /><button>套用日期</button></form>
    <form noValidate method="post" onSubmit={(event) => { event.preventDefault(); submit(); }}><button>其他寫入</button></form>
    <CoreDraftConfirmation draft={draft} /></>;
}
describe("unsent draft navigation guard", () => {
  it("cancels link navigation and document unload while preserving the draft", () => {
    const confirm = vi.spyOn(window, "confirm");
    render(<GuardHarness />);
    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    fireEvent.click(screen.getByRole("link"));
    expect(screen.getByRole("dialog", { name: "尚有未保存內容" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    expect(confirm).not.toHaveBeenCalled();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
  it("blocks pending navigation without discard and stops blocking after confirmed success", () => {
    render(<GuardHarness />);
    fireEvent.click(screen.getByRole("button", { name: "開始儲存" }));
    fireEvent.click(screen.getByRole("link"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("請先完成其他作業");
    fireEvent.click(screen.getByRole("button", { name: "確認儲存" }));
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
  it("replays only the original GET once, after explicit discard and modal cleanup", () => {
    const submit = vi.fn(() => expect(document.querySelector("dialog[open]")).toBeNull());
    const discard = vi.fn();
    render(<GuardHarness submit={submit} onDiscard={discard} />);
    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    fireEvent.click(screen.getByRole("button", { name: "套用日期" }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    expect(discard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "套用日期" }));
    fireEvent.click(screen.getByRole("button", { name: "捨棄填寫並繼續" }));
    expect(discard).toHaveBeenCalledOnce(); expect(submit).toHaveBeenCalledOnce();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
  it("reads changed and begin synchronously before a React state commit", () => {
    const proceed = vi.fn();
    const { result } = renderHook(() => useCoreDraftGuard({}));
    act(() => {
      result.current.changed();
      expect(requestUnsavedExit(proceed)).toBe(true);
      expect(proceed).not.toHaveBeenCalled();
    });
    expect(result.current.open).toBe(true);
    act(() => result.current.cancel());
    act(() => {
      expect(result.current.begin()).toBe(true);
      expect(result.current.begin()).toBe(false);
      expect(requestUnsavedExit(proceed)).toBe(true);
      const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
    });
    expect(result.current.open).toBe(false); expect(result.current.notice).not.toBe("");
  });
  it("blocks an unknown attempt even when no input change was reported", () => {
    const discard = vi.fn(); const proceed = vi.fn();
    render(<GuardHarness blocked onDiscard={discard} proceed={proceed} />);
    fireEvent.click(screen.getByRole("button", { name: "離開填寫" }));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(discard).not.toHaveBeenCalled(); expect(proceed).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });
  it.each(["pending", "view"])("retains the dirty draft while another %s owner is locked", (kind) => {
    render(<GuardHarness />); fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    const release = kind === "pending" ? tryAcquirePendingOperation()! : tryAcquireViewTransition()!;
    try { fireEvent.click(screen.getByRole("button", { name: "離開填寫" })); expect(screen.queryByRole("dialog")).toBeNull(); }
    finally { release(); }
    fireEvent.click(screen.getByRole("button", { name: "離開填寫" })); expect(screen.getByRole("dialog")).toBeVisible();
  });
  it("never turns another POST into a replayable exit", () => {
    const submit = vi.fn(); render(<GuardHarness submit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "編輯" })); fireEvent.click(screen.getByRole("button", { name: "其他寫入" }));
    expect(submit).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("invalidates changed GET data without discarding the draft", () => {
    const discard = vi.fn(); const submit = vi.fn(); render(<GuardHarness submit={submit} onDiscard={discard} />);
    fireEvent.click(screen.getByRole("button", { name: "編輯" })); fireEvent.click(screen.getByRole("button", { name: "套用日期" }));
    fireEvent.change(document.querySelector("input[name=date]")!, { target: { value: "2026-09-11" } });
    fireEvent.click(screen.getByRole("button", { name: "捨棄填寫並繼續" }));
    expect(discard).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("原操作已變更");
  });
  it("source revision changes cancel the old proposal but keep the draft", () => {
    const discard = vi.fn(); const proceed = vi.fn(); const ui = render(<GuardHarness revision="1" onDiscard={discard} proceed={proceed} />);
    fireEvent.click(screen.getByRole("button", { name: "編輯" })); fireEvent.click(screen.getByRole("button", { name: "離開填寫" }));
    const oldConfirm = screen.getByRole("button", { name: "捨棄填寫並繼續" });
    ui.rerender(<GuardHarness revision="2" onDiscard={discard} proceed={proceed} />);
    ui.rerender(<GuardHarness revision="1" onDiscard={discard} proceed={proceed} />);
    fireEvent.click(oldConfirm); expect(discard).not.toHaveBeenCalled(); expect(proceed).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  });
  it("visible scope ABA and logout invalidate old continuations without asking", () => {
    const discard = vi.fn(); const proceed = vi.fn(); const ui = render(<GuardHarness scope="a" onDiscard={discard} proceed={proceed} />);
    fireEvent.click(screen.getByRole("button", { name: "編輯" })); fireEvent.click(screen.getByRole("button", { name: "離開填寫" }));
    const oldConfirm = screen.getByRole("button", { name: "捨棄填寫並繼續" });
    ui.rerender(<GuardHarness scope="b" onDiscard={discard} proceed={proceed} />);
    ui.rerender(<GuardHarness scope="a" onDiscard={discard} proceed={proceed} />);
    fireEvent.click(oldConfirm); expect(proceed).not.toHaveBeenCalled(); expect(discard).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "編輯" })); fireEvent.click(screen.getByRole("button", { name: "離開填寫" }));
    act(() => clearUnsavedChangesOnLogout());
    expect(screen.queryByRole("dialog")).toBeNull(); expect(discard).toHaveBeenCalledTimes(3); expect(proceed).not.toHaveBeenCalled();
    expect(requestUnsavedExit(proceed)).toBe(false);
  });
  it("does not accept a discard during IME composition", () => {
    const discard = vi.fn(); render(<GuardHarness onDiscard={discard} />);
    fireEvent.click(screen.getByRole("button", { name: "編輯" })); fireEvent.click(screen.getByRole("button", { name: "離開填寫" }));
    const button = screen.getByRole("button", { name: "捨棄填寫並繼續" });
    fireEvent.compositionStart(button); fireEvent.click(button); expect(discard).not.toHaveBeenCalled();
    fireEvent.compositionEnd(button); fireEvent.click(button); expect(discard).toHaveBeenCalledOnce();
  });
  it("preserves the legacy no-options API outside this migration", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(() => useCoreDraftGuard());
    act(() => result.current.changed());
    expect(result.current.discard()).toBe(false); expect(confirm).toHaveBeenCalledOnce();
    confirm.mockReturnValue(true); expect(result.current.discard()).toBe(true);
    expect(result.current.open).toBe(false);
  });
});
