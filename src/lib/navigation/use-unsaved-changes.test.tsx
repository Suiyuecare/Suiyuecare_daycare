// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { clearUnsavedChangesOnLogout, requestUnsavedExit } from "./unsaved-changes";
import { tryAcquirePendingOperation, tryAcquireViewTransition } from "./pending-operation-lock";
let releases: Array<() => void> = [];
let oldName = "";
beforeEach(() => {
  oldName = window.name;
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); clearUnsavedChangesOnLogout(); for (const release of releases) release(); releases = [];
  window.name = oldName; document.querySelectorAll("base").forEach((base) => base.remove()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Harness({ children, canPrompt = true, scope = "synthetic-owner", revision = "one" }: {
  children?: ReactNode; canPrompt?: boolean; scope?: string; revision?: string;
}) {
  const [value, setValue] = useState("合成暫存");
  const guard = useUnsavedChanges({ dirty: value !== "", scopeKey: scope, revisionKey: revision, canPrompt,
    permittedFormAttribute: "data-synthetic-editor", onDiscard: () => setValue("") });
  return <section><label>合成填寫<textarea className="resize-none" value={value} onChange={(e) => setValue(e.target.value)} /></label>
    {children}{guard.notice && <p role="alert">{guard.notice}</p>}
    {guard.open && <GovernanceDialog open title="捨棄填寫" cancelLabel="繼續填寫" returnFocusRef={guard.returnFocusRef} onRequestClose={guard.cancel}>
      <button type="button" onClick={guard.confirmDiscard}>捨棄</button></GovernanceDialog>}</section>;
}
function discard() { fireEvent.click(within(screen.getByRole("dialog", { name: "捨棄填寫" })).getByRole("button", { name: "捨棄" })); }
function navigateEvent({ cancelable = true, type = "push", formData = null as FormData | null } = {}) {
  return Object.assign(new Event("navigate", { cancelable }), {
    destination: { url: "https://finance.suiyuecare.com/", key: "synthetic-key" }, navigationType: type, formData,
  });
}
describe("shared unsaved navigation lifecycle", () => {
  it.each([tryAcquirePendingOperation, tryAcquireViewTransition])("dirty links and GETs fail closed under an unrelated lease even without a pending journal guard", (acquire) => {
    const visit = vi.fn((event) => event.preventDefault()); const submit = vi.fn((event) => event.preventDefault());
    render(<Harness><a href="/another" onClick={visit}>換頁</a><form noValidate method="get" action="/other" onSubmit={submit}><button type="submit">查詢</button></form></Harness>);
    act(() => releases.push(acquire()!));
    expect(fireEvent.click(screen.getByRole("link", { name: "換頁" }))).toBe(false);
    expect(fireEvent.submit(screen.getByRole("button", { name: "查詢" }).closest("form")!)).toBe(false);
    expect(visit).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("合成暫存")).toBeInTheDocument();
  });
  it.each([tryAcquirePendingOperation, tryAcquireViewTransition])("cancelable Navigation API exits fail closed while another lease exists", (acquire) => {
    const navigation = Object.assign(new EventTarget(), { navigate: vi.fn(), traverseTo: vi.fn() }); vi.stubGlobal("navigation", navigation);
    render(<Harness />); act(() => releases.push(acquire()!)); const event = navigateEvent(); navigation.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(navigation.navigate).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("合成暫存")).toBeInTheDocument();
  });
  it.each(["push", "replace", "traverse"])("resumes a cancelable %s navigation only after explicit discard, preserving its history operation", (type) => {
    const navigation = Object.assign(new EventTarget(), { navigate: vi.fn(), traverseTo: vi.fn() }); vi.stubGlobal("navigation", navigation);
    render(<Harness />); const event = navigateEvent({ type }); act(() => { navigation.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true); expect(navigation.navigate).not.toHaveBeenCalled(); expect(navigation.traverseTo).not.toHaveBeenCalled();
    discard();
    if (type === "traverse") expect(navigation.traverseTo).toHaveBeenCalledWith("synthetic-key");
    else expect(navigation.navigate).toHaveBeenCalledWith("https://finance.suiyuecare.com/", { history: type });
    expect(screen.getByLabelText("合成填寫")).toHaveValue(""); expect(document.querySelector("dialog[open]")).toBeNull();
  });
  it("never replays a POST-origin NavigateEvent as a GET, even if native form.submit bypassed the submit handler", () => {
    const navigation = Object.assign(new EventTarget(), { navigate: vi.fn(), traverseTo: vi.fn() }); vi.stubGlobal("navigation", navigation);
    render(<Harness />); const data = new FormData(); data.append("synthetic", "not-a-get"); const event = navigateEvent({ formData: data });
    act(() => { navigation.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true); expect(navigation.navigate).not.toHaveBeenCalled(); expect(navigation.traverseTo).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.getByDisplayValue("合成暫存")).toBeInTheDocument();
  });
  it("does not claim that a noncancelable browser traversal can be stopped or replayed", () => {
    const navigation = Object.assign(new EventTarget(), { navigate: vi.fn(), traverseTo: vi.fn() }); vi.stubGlobal("navigation", navigation);
    render(<Harness />); const event = navigateEvent({ cancelable: false, type: "traverse" }); navigation.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(navigation.traverseTo).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true }); fireEvent(window, unload); expect(unload.defaultPrevented).toBe(true);
  });
  it("named targets matching window.name are same-tab departures, unlike other named windows", () => {
    window.name = "synthetic-current"; const visit = vi.fn((event) => event.preventDefault());
    render(<Harness><a href="/another" target="synthetic-current" onClick={visit}>目前視窗</a><a href="/another" target="synthetic-other" onClick={visit}>其他視窗</a></Harness>);
    fireEvent.click(screen.getByRole("link", { name: "其他視窗" })); expect(visit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("link", { name: "目前視窗" })); expect(visit).toHaveBeenCalledOnce(); discard(); expect(visit).toHaveBeenCalledTimes(2);
  });
  it("an inherited base target and explicit empty submitter override preserve native GET semantics", () => {
    const base = document.createElement("base"); base.target = "_blank"; document.head.append(base);
    const submit = vi.fn((event) => event.preventDefault());
    const replay = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(function(this: HTMLFormElement, submitter?: HTMLElement | null) {
      this.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter }));
    });
    render(<Harness><form noValidate method="get" action="/original" onSubmit={submit}>
      <button type="submit" formTarget="" formAction="/overridden" formMethod="get">同視窗查詢</button></form></Harness>);
    const button = screen.getByRole("button", { name: "同視窗查詢" }); fireEvent(button.closest("form")!, new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }));
    expect(submit).not.toHaveBeenCalled(); discard(); expect(replay).toHaveBeenCalledWith(button); expect(submit).toHaveBeenCalledOnce();
  });
  it.each(["formaction", "formtarget", "formmethod"])("changing submitter %s after confirmation was requested keeps the draft", (attribute) => {
    const replay = vi.spyOn(HTMLFormElement.prototype, "requestSubmit");
    render(<Harness><form noValidate method="get" action="/original"><button type="submit" formTarget="" formAction="/original" formMethod="get">查詢</button></form></Harness>);
    const button = screen.getByRole("button", { name: "查詢" }); fireEvent(button.closest("form")!, new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }));
    button.setAttribute(attribute, attribute === "formmethod" ? "post" : attribute === "formtarget" ? "_blank" : "/changed"); discard();
    expect(replay).not.toHaveBeenCalled(); expect(screen.getByDisplayValue("合成暫存")).toBeInTheDocument();
  });
  it("does not replay an ordinary POST submission or open a nested prompt under another dialog", () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(<Harness canPrompt={false}><form noValidate method="post" action="/save" onSubmit={submit}><button type="submit">保存其他資料</button></form><a href="/other">離開</a></Harness>);
    expect(fireEvent.submit(screen.getByRole("button", { name: "保存其他資料" }).closest("form")!)).toBe(false);
    expect(fireEvent.click(screen.getByRole("link", { name: "離開" }))).toBe(false);
    expect(submit).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.getByDisplayValue("合成暫存")).toBeInTheDocument();
  });
  it("rejects an invalid or throwing destination check before any draft discard", () => {
    render(<Harness />); const proceed = vi.fn(); act(() => { requestUnsavedExit(proceed, () => { throw new Error("synthetic stale target"); }); });
    discard(); expect(proceed).not.toHaveBeenCalled(); expect(screen.getByDisplayValue("合成暫存")).toBeInTheDocument();
  });
  it("disconnected links are rejected before discard and cannot reappear as old continuations", () => {
    render(<Harness><a href="/other">離開</a></Harness>); const link = screen.getByRole("link", { name: "離開" }); fireEvent.click(link); link.remove(); discard();
    expect(screen.getByDisplayValue("合成暫存")).toBeInTheDocument(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
