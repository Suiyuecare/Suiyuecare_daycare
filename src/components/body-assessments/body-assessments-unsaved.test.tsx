// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import Link from "next/link";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { staffPages } from "@/lib/catalog";
import { buildDemoBodyAssessmentSnapshot } from "@/lib/body-assessments/demo";
import type { BodyAssessmentSnapshot } from "@/lib/body-assessments/types";
import { clearBodyAssessmentPendingOnLogout } from "@/lib/body-assessments/pending";
import { clearUnsavedChangesOnLogout, registerUnsavedChangesOwner, requestUnsavedExit } from "@/lib/navigation/unsaved-changes";
import { hasViewTransition, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { BodyAssessmentsWorkspace } from "./body-assessments-workspace";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const page = staffPages.find((entry) => entry.number === 19)!;
let snapshot: BodyAssessmentSnapshot;
let actor: string;
let releases: Array<() => void> = [];
beforeEach(() => {
  clearUnsavedChangesOnLogout(); clearBodyAssessmentPendingOnLogout(); refresh.mockReset();
  const demo = buildDemoBodyAssessmentSnapshot({ clientId: null, state: "all" });
  const record = demo.records[0].history[0]; actor = record.actor_user_id;
  snapshot = { ...demo, demo: false, records: [{ ...record, history: [], historyTotal: 0, historyTruncated: false }] };
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { cleanup(); clearUnsavedChangesOnLogout(); clearBodyAssessmentPendingOnLogout();
  for (const release of releases) release(); releases = []; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function props(data = snapshot, user = actor, canManage = true) { return { page, snapshot: data, actorUserId: user, canManage, canSign: true }; }
function open(dirty = true) {
  fireEvent.click(screen.getByRole("button", { name: "新增評估草稿" }));
  if (dirty) fireEvent.change(screen.getByLabelText("建立／修訂理由"), { target: { value: "合成未保存內容" } });
}
function prompt() { return screen.getByRole("dialog", { name: "捨棄尚未保存的填寫？" }); }
function discard() { fireEvent.click(within(prompt()).getByRole("button", { name: "捨棄填寫並繼續" })); }
function keep() { fireEvent.click(within(prompt()).getByRole("button", { name: "繼續填寫" })); }

describe("body editor app-owned unsaved protection", () => {
  it("closes an unchanged editor without confirmation", () => {
    render(<BodyAssessmentsWorkspace {...props()} />); open(false);
    fireEvent.click(screen.getByRole("button", { name: "取消編輯" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByRole("form", { name: "身體評估編輯" })).not.toBeInTheDocument();
  });
  it("change then restore to the original values is clean", () => {
    render(<BodyAssessmentsWorkspace {...props()} />); open();
    fireEvent.change(screen.getByLabelText("建立／修訂理由"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "取消編輯" })); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("cancel and Escape retain entered values and restore the initiating focus", () => {
    render(<BodyAssessmentsWorkspace {...props()} />); open();
    const trigger = screen.getByRole("button", { name: "取消編輯" }); trigger.focus(); fireEvent.click(trigger);
    expect(within(prompt()).getByRole("button", { name: "繼續填寫" })).toHaveFocus();
    keep(); expect(screen.getByDisplayValue("合成未保存內容")).toBeInTheDocument(); expect(trigger).toHaveFocus();
    fireEvent.click(trigger); fireEvent.keyDown(prompt(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.getByDisplayValue("合成未保存內容")).toBeInTheDocument(); expect(trigger).toHaveFocus();
  });
  it("explicit discard clears only the unsent editor, with zero writes", () => {
    render(<BodyAssessmentsWorkspace {...props()} />); open(); fireEvent.click(screen.getByRole("button", { name: "取消編輯" })); discard();
    expect(screen.queryByRole("form", { name: "身體評估編輯" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "修訂草稿" })).toBeEnabled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("switching to a different record requires discard and does not nest dialogs", () => {
    render(<BodyAssessmentsWorkspace {...props()} />); open(); fireEvent.click(screen.getByRole("button", { name: "修訂草稿" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1); keep(); expect(screen.getByDisplayValue("合成未保存內容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "修訂草稿" })); discard();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.getByLabelText("個案", { selector: "select[data-body-first-field]" })).toBeDisabled();
    expect(screen.getByLabelText("建立／修訂理由")).toHaveValue(""); expect(fetch).not.toHaveBeenCalled();
  });
  it("signing another saved record first closes the discard dialog, then opens signature confirmation without a POST", () => {
    const opened: number[] = [];
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function(this: HTMLDialogElement) {
      opened.push(document.querySelectorAll("dialog[open]").length); this.open = true;
    });
    render(<BodyAssessmentsWorkspace {...props()} />); open(); fireEvent.click(screen.getByRole("button", { name: "核對並簽署" })); discard();
    expect(screen.getByRole("dialog", { name: "確認身體評估簽署" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1); expect(opened).toEqual([0, 0]); expect(fetch).not.toHaveBeenCalled();
  });
  it("expanding history does not discard or prompt", () => {
    render(<BodyAssessmentsWorkspace {...props()} />); open(); fireEvent.click(screen.getByText(/紀錄詳情與版本歷程/u));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.getByDisplayValue("合成未保存內容")).toBeInTheDocument();
  });
  it("reload waits for explicit discard and executes once", () => {
    render(<BodyAssessmentsWorkspace {...props()} />); open(); fireEvent.click(screen.getByRole("button", { name: "重新載入" }));
    expect(refresh).not.toHaveBeenCalled(); keep(); expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新載入" })); discard(); expect(refresh).toHaveBeenCalledOnce();
  });
  it("shared frame refresh requests use the same owner and invalidate on safe logout without prompting", () => {
    render(<BodyAssessmentsWorkspace {...props()} />); open(); const proceed = vi.fn();
    act(() => { expect(requestUnsavedExit(proceed)).toBe(true); }); prompt();
    act(() => clearUnsavedChangesOnLogout());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByDisplayValue("合成未保存內容")).not.toBeInTheDocument(); expect(proceed).not.toHaveBeenCalled();
  });
  it("cannot confirm while a Chinese IME composition is active", () => {
    render(<BodyAssessmentsWorkspace {...props()} />); open(); fireEvent.click(screen.getByRole("button", { name: "取消編輯" }));
    const button = within(prompt()).getByRole("button", { name: "捨棄填寫並繼續" });
    fireEvent.compositionStart(button); fireEvent.keyDown(button, { key: "Enter", isComposing: true }); fireEvent.click(button);
    expect(prompt()).toBeInTheDocument(); expect(screen.getByDisplayValue("合成未保存內容")).toBeInTheDocument();
    fireEvent.compositionEnd(button); fireEvent.click(button); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it.each([tryAcquirePendingOperation, tryAcquireViewTransition])("never discards a draft if another operation starts during confirmation", (acquire) => {
    render(<BodyAssessmentsWorkspace {...props()} />); open(); fireEvent.click(screen.getByRole("button", { name: "取消編輯" }));
    act(() => { releases.push(acquire()!); }); discard();
    expect(prompt()).toBeInTheDocument(); expect(screen.getByDisplayValue("合成未保存內容")).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
  });
  it("cannot discard one of multiple dirty editors or a new dirty owner appearing during confirmation", () => {
    render(<BodyAssessmentsWorkspace {...props()} />); open(); fireEvent.click(screen.getByRole("button", { name: "取消編輯" }));
    const request = vi.fn(); releases.push(registerUnsavedChangesOwner({ isDirty: () => true, requestDiscard: request, onInvalidate: vi.fn() }));
    discard(); expect(prompt()).toBeInTheDocument(); expect(screen.getByDisplayValue("合成未保存內容")).toBeInTheDocument(); expect(request).not.toHaveBeenCalled();
  });
  it.each(["actor", "role", "assignment"])("invalidates queued exits after %s revocation and restoration ABA", (boundary) => {
    const view = render(<BodyAssessmentsWorkspace {...props()} />); open(); const proceed = vi.fn();
    act(() => { requestUnsavedExit(proceed); }); const oldButton = within(prompt()).getByRole("button", { name: "捨棄填寫並繼續" });
    const revoked = boundary === "assignment" ? { ...snapshot, clients: [], clientTotal: 0, records: [], matchingTotal: 0 } : snapshot;
    view.rerender(<BodyAssessmentsWorkspace {...props(revoked, boundary === "actor" ? "00000000-0000-4000-8000-000000000099" : actor, boundary !== "role")} />);
    view.rerender(<BodyAssessmentsWorkspace {...props()} />); fireEvent.click(oldButton);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByDisplayValue("合成未保存內容")).not.toBeInTheDocument(); expect(proceed).not.toHaveBeenCalled();
  });
  it("source snapshot changes cancel queued exits without silently losing same-scope entered values", () => {
    const view = render(<BodyAssessmentsWorkspace {...props()} />); open(); const proceed = vi.fn(); act(() => { requestUnsavedExit(proceed); });
    view.rerender(<BodyAssessmentsWorkspace {...props({ ...snapshot, generatedAt: new Date(Date.parse(snapshot.generatedAt) + 1000).toISOString() })} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.getByDisplayValue("合成未保存內容")).toBeInTheDocument(); expect(proceed).not.toHaveBeenCalled();
  });
  it("unmount invalidates an old confirm callback and unregisters its owner", () => {
    const view = render(<BodyAssessmentsWorkspace {...props()} />); open(); const proceed = vi.fn(); act(() => { requestUnsavedExit(proceed); });
    const button = within(prompt()).getByRole("button", { name: "捨棄填寫並繼續" }); view.unmount(); fireEvent.click(button);
    expect(proceed).not.toHaveBeenCalled(); expect(requestUnsavedExit(vi.fn())).toBe(false);
  });
  it("a changed HTTP destination is rejected before discard, preserving the draft", () => {
    const next = vi.fn((event) => event.preventDefault());
    render(<><Link href="/app/staff/assessments/spmsq" onClick={next}>下一量表</Link><BodyAssessmentsWorkspace {...props()} /></>); open();
    const link = screen.getByRole("link", { name: "下一量表" }); fireEvent.click(link); expect(next).not.toHaveBeenCalled();
    link.setAttribute("href", "/app/staff/assessments/gds"); discard();
    expect(next).not.toHaveBeenCalled(); expect(screen.getByDisplayValue("合成未保存內容")).toBeInTheDocument();
  });
  it("same-tab links replay once only after the discard dialog has closed", () => {
    const next = vi.fn((event) => { expect(document.querySelector("dialog[open]")).toBeNull(); event.preventDefault(); });
    render(<><a href="https://finance.suiyuecare.com" onClick={next}>Finance</a><BodyAssessmentsWorkspace {...props()} /></>); open();
    fireEvent.click(screen.getByRole("link", { name: "Finance" })); expect(next).not.toHaveBeenCalled(); discard(); expect(next).toHaveBeenCalledOnce();
  });
  it("modifier/new-tab/same-document anchor actions retain the editor without prompts", () => {
    const safe = vi.fn((event) => event.preventDefault());
    render(<><a href="/another" onClick={safe}>其他頁</a><a href="/another" target="_blank" onClick={safe}>新分頁</a>
      <a href="#body-local" onClick={safe}>本頁詳情</a><BodyAssessmentsWorkspace {...props()} /></>); open();
    fireEvent.click(screen.getByRole("link", { name: "其他頁" }), { ctrlKey: true }); fireEvent.click(screen.getByRole("link", { name: "新分頁" }));
    fireEvent.click(screen.getByRole("link", { name: "本頁詳情" })); expect(safe).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.getByDisplayValue("合成未保存內容")).toBeInTheDocument();
  });
  it("GET filters replay through native requestSubmit only after discard and then acquire the normal view lease", () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(function(this: HTMLFormElement, submitter?: HTMLElement | null) {
      this.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter }));
    });
    render(<BodyAssessmentsWorkspace {...props()} />); open(); const form = screen.getByRole("form", { name: "查詢身體評估" });
    fireEvent.submit(form); expect(hasViewTransition()).toBe(false); expect(submit).not.toHaveBeenCalled(); discard();
    expect(submit).toHaveBeenCalledOnce(); expect(hasViewTransition()).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it("changing GET values while confirmation is open invalidates its original destination without discarding", () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit");
    render(<BodyAssessmentsWorkspace {...props()} />); open(); const form = screen.getByRole("form", { name: "查詢身體評估" });
    fireEvent.submit(form); (form.querySelector('select[name="state"]') as HTMLSelectElement).value = "draft"; discard();
    expect(submit).not.toHaveBeenCalled(); expect(screen.getByDisplayValue("合成未保存內容")).toBeInTheDocument();
  });
  it("warns only for truly dirty hard unload and never uses browser confirm or persists input", () => {
    const confirm = vi.spyOn(window, "confirm"); const local = vi.spyOn(Storage.prototype, "setItem");
    render(<BodyAssessmentsWorkspace {...props()} />); open(false);
    const clean = new Event("beforeunload", { cancelable: true }); fireEvent(window, clean); expect(clean.defaultPrevented).toBe(false);
    fireEvent.change(screen.getByLabelText("建立／修訂理由"), { target: { value: "合成未保存內容" } });
    const dirty = new Event("beforeunload", { cancelable: true }); fireEvent(window, dirty); expect(dirty.defaultPrevented).toBe(true);
    expect(confirm).not.toHaveBeenCalled(); expect(local).not.toHaveBeenCalled();
  });
});
