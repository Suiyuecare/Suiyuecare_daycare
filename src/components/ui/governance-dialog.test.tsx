// @vitest-environment jsdom

import { StrictMode, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GovernanceDialog } from "./governance-dialog";

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const showModal = vi.fn(function (this: HTMLDialogElement) {
  if (this.open) throw new Error("Already open");
  this.setAttribute("open", "");
});
const close = vi.fn(function (this: HTMLDialogElement) {
  if (!this.open) throw new Error("Already closed");
  this.removeAttribute("open");
});

beforeEach(() => {
  showModal.mockClear(); close.mockClear();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: showModal });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: close });
});

afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const [name, descriptor] of [["showModal", originalShowModal], ["close", originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

function Harness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <><button onClick={() => setOpen(true)} ref={trigger} type="button">核對規則</button>
    <GovernanceDialog busy={busy} onRequestClose={() => setOpen(false)} open={open}
      returnFocusRef={trigger} title="確認送審">
      <form noValidate><label>理由<input name="reason" /></label><button type="submit">送出</button></form>
    </GovernanceDialog></>;
}

function bounds(dialog: HTMLDialogElement) {
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({ x: 30, y: 40, width: 300, height: 200,
    top: 40, bottom: 240, left: 30, right: 330, toJSON: () => ({}) });
}

describe("GovernanceDialog controlled native confirmation", () => {
  it("does not open when closed and uses native showModal with cancel initial focus", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull(); expect(showModal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "核對規則" }));
    expect(screen.getByRole("dialog", { name: "確認送審" })).toHaveProperty("open", true);
    expect(showModal).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "取消" }));
  });

  it("cancel only requests close until the parent changes open, without submitting", () => {
    const onRequestClose = vi.fn(); const submit = vi.fn((event) => event.preventDefault());
    const { rerender } = render(<GovernanceDialog open onRequestClose={onRequestClose} title="確認核准">
      <form noValidate onSubmit={submit}><button type="submit">核准</button></form>
    </GovernanceDialog>);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onRequestClose).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveProperty("open", true); expect(close).not.toHaveBeenCalled();
    rerender(<GovernanceDialog open={false} onRequestClose={onRequestClose} title="確認核准">內容</GovernanceDialog>);
    expect(close).toHaveBeenCalledOnce(); expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("prevents native cancel default and requests cancellation, never closes itself", () => {
    const request = vi.fn(); render(<GovernanceDialog open onRequestClose={request} title="確認退休">內容</GovernanceDialog>);
    const dialog = screen.getByRole("dialog");
    const cancel = new Event("cancel", { cancelable: true }); fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true); expect(request).toHaveBeenCalledOnce();
    expect(dialog).toHaveProperty("open", true); expect(close).not.toHaveBeenCalled();
  });

  it("handles Escape as cancel but not as confirmation or IME composition", () => {
    const request = vi.fn(); render(<GovernanceDialog open onRequestClose={request} title="確認退休">內容</GovernanceDialog>);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", isComposing: true });
    expect(request).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(request).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  });

  it("requests closure only on actual backdrop, not content or surface padding", () => {
    const request = vi.fn(); render(<GovernanceDialog open onRequestClose={request} title="確認退休"><p>規則內容</p></GovernanceDialog>);
    const dialog = screen.getByRole("dialog") as HTMLDialogElement; bounds(dialog);
    fireEvent.click(screen.getByText("規則內容"), { clientX: 10, clientY: 10 });
    fireEvent.click(dialog, { clientX: 35, clientY: 45 });
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(dialog, { clientX: 10, clientY: 10 });
    expect(request).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  });

  it("does not cancel after a pointer gesture started on the dialog content", () => {
    const request = vi.fn(); render(<GovernanceDialog open onRequestClose={request} title="確認退休"><p>規則內容</p></GovernanceDialog>);
    const dialog = screen.getByRole("dialog") as HTMLDialogElement; bounds(dialog);
    fireEvent.pointerDown(screen.getByText("規則內容"), { clientX: 40, clientY: 50 });
    fireEvent.click(dialog, { clientX: 10, clientY: 10 });
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(dialog, { clientX: 10, clientY: 10 });
    expect(request).toHaveBeenCalledOnce();
  });

  it("busy blocks cancel, Escape, cancel event and backdrop, without reopening", () => {
    const request = vi.fn(); const { rerender } = render(<GovernanceDialog open onRequestClose={request} title="確認核准">內容</GovernanceDialog>);
    const dialog = screen.getByRole("dialog") as HTMLDialogElement; bounds(dialog);
    rerender(<GovernanceDialog busy open onRequestClose={request} title="確認核准">處理中</GovernanceDialog>);
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "取消" })).toHaveProperty("disabled", true);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "確認核准" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    const cancel = new Event("cancel", { cancelable: true }); fireEvent(dialog, cancel);
    fireEvent.click(dialog, { clientX: 10, clientY: 10 });
    expect(cancel.defaultPrevented).toBe(true); expect(request).not.toHaveBeenCalled();
    expect(showModal).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  });

  it("returns focus to the supplied original trigger after cancellation", () => {
    render(<Harness />); const trigger = screen.getByRole("button", { name: "核對規則" });
    fireEvent.click(trigger); fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(document.activeElement).toBe(trigger); expect(close).toHaveBeenCalledOnce();
  });

  it("recovers busy focus after Chrome has moved focus from the disabled cancel button to BODY", () => {
    const request = vi.fn(); const { rerender } = render(<GovernanceDialog open onRequestClose={request} title="確認核准">內容</GovernanceDialog>);
    const cancel = screen.getByRole("button", { name: "取消" });
    expect(document.activeElement).toBe(cancel);
    cancel.blur(); expect(document.activeElement).toBe(document.body);
    rerender(<GovernanceDialog busy open onRequestClose={request} title="確認核准">處理中</GovernanceDialog>);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "確認核准" }));
    expect(showModal).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  });

  it("busy does not steal focus from a remaining usable control inside the dialog", () => {
    const checkProgress = vi.fn();
    const { rerender } = render(<GovernanceDialog open onRequestClose={vi.fn()} title="確認核准"><button onClick={checkProgress} type="button">回查進度</button></GovernanceDialog>);
    const control = screen.getByRole("button", { name: "回查進度" }); control.focus();
    rerender(<GovernanceDialog busy open onRequestClose={vi.fn()} title="確認核准"><button onClick={checkProgress} type="button">回查進度</button></GovernanceDialog>);
    expect(document.activeElement).toBe(control);
    fireEvent.click(control); expect(checkProgress).toHaveBeenCalledOnce();
  });

  it("recovers focus after children remove the focused control while busy remains true", () => {
    const confirm = vi.fn();
    const { rerender } = render(<GovernanceDialog busy open onRequestClose={vi.fn()} title="確認核准"><button onClick={confirm} type="button">確認送出</button></GovernanceDialog>);
    screen.getByRole("button", { name: "確認送出" }).focus();
    rerender(<GovernanceDialog busy open onRequestClose={vi.fn()} title="確認核准"><p role="alert">已保存，但清單尚未更新。</p></GovernanceDialog>);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "確認核准" }));
    expect(showModal).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  });

  it("moves focus from a reused confirmation control as soon as it becomes disabled", () => {
    const confirm = vi.fn();
    const { rerender } = render(<GovernanceDialog busy open onRequestClose={vi.fn()} title="確認核准"><button onClick={confirm} type="button">確認送出</button></GovernanceDialog>);
    const button = screen.getByRole("button", { name: "確認送出" }); button.focus();
    rerender(<GovernanceDialog busy open onRequestClose={vi.fn()} title="確認核准"><button disabled onClick={confirm} type="button">處理中…</button></GovernanceDialog>);
    expect(screen.getByRole("button", { name: "處理中…" })).toBe(button);
    expect(button).toHaveProperty("disabled", true);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "確認核准" }));
    expect(showModal).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  });

  it("the single animation frame recovers BODY focus dropped after the effect", () => {
    let frame!: FrameRequestCallback;
    const schedule = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 91; });
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", schedule); vi.stubGlobal("cancelAnimationFrame", cancel);
    const { unmount } = render(<GovernanceDialog busy open onRequestClose={vi.fn()} title="確認核准">送出中</GovernanceDialog>);
    const title = screen.getByRole("heading", { name: "確認核准" });
    expect(document.activeElement).toBe(title);
    title.blur(); expect(document.activeElement).toBe(document.body);
    act(() => frame(16));
    expect(document.activeElement).toBe(title); expect(schedule).toHaveBeenCalledOnce();
    unmount(); expect(cancel).toHaveBeenCalledWith(91);
  });

  it("the animation frame preserves a usable inner control and is cancelled on close", () => {
    let frame!: FrameRequestCallback;
    const schedule = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 92; });
    const cancel = vi.fn(); const retry = vi.fn();
    vi.stubGlobal("requestAnimationFrame", schedule); vi.stubGlobal("cancelAnimationFrame", cancel);
    const { rerender } = render(<GovernanceDialog busy open onRequestClose={vi.fn()} title="確認核准"><button onClick={retry} type="button">回查進度</button></GovernanceDialog>);
    const control = screen.getByRole("button", { name: "回查進度" }); control.focus();
    act(() => frame(16)); expect(document.activeElement).toBe(control);
    rerender(<GovernanceDialog busy open={false} onRequestClose={vi.fn()} title="確認核准">內容</GovernanceDialog>);
    expect(cancel).toHaveBeenCalledWith(92); expect(schedule).toHaveBeenCalledOnce();
    act(() => frame(32)); expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("returns to the same workspace focus anchor if a commit disables the original trigger", () => {
    const workspace = document.createElement("section");
    const anchor = document.createElement("h2"); anchor.textContent = "評估量表規則審核";
    anchor.setAttribute("data-governance-focus-anchor", ""); anchor.tabIndex = -1;
    const trigger = document.createElement("button"); trigger.textContent = "送交第二人核准";
    workspace.append(anchor, trigger); document.body.append(workspace); trigger.focus();
    const returnFocusRef = { current: trigger };
    const { rerender } = render(<GovernanceDialog open returnFocusRef={returnFocusRef} onRequestClose={vi.fn()} title="確認送審">內容</GovernanceDialog>);
    trigger.disabled = true; const focus = vi.spyOn(trigger, "focus");
    rerender(<GovernanceDialog open={false} returnFocusRef={returnFocusRef} onRequestClose={vi.fn()} title="確認送審">內容</GovernanceDialog>);
    expect(focus).not.toHaveBeenCalled(); expect(document.activeElement).toBe(anchor);
    expect(close).toHaveBeenCalledOnce(); workspace.remove();
  });

  it("captures active trigger without returnFocusRef and restores it on unmount", () => {
    const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
    const { unmount } = render(<GovernanceDialog open onRequestClose={vi.fn()} title="確認退回">內容</GovernanceDialog>);
    unmount(); expect(document.activeElement).toBe(trigger); trigger.remove();
    expect(close).toHaveBeenCalledOnce();
  });

  it("has unique label references for multiple mounted, non-nested dialog owners", () => {
    const { container } = render(<><GovernanceDialog open={false} onRequestClose={vi.fn()} title="送審">一</GovernanceDialog>
      <GovernanceDialog open={false} onRequestClose={vi.fn()} title="退休">二</GovernanceDialog></>);
    const labels = Array.from(container.querySelectorAll("dialog")).map((dialog) => dialog.getAttribute("aria-labelledby")!);
    expect(new Set(labels).size).toBe(2);
    for (const id of labels) expect(document.getElementById(id)?.tagName).toBe("H2");
  });

  it("does not reopen when callback, content, title or viewport changes", () => {
    const { rerender } = render(<GovernanceDialog open onRequestClose={vi.fn()} title="送審">一</GovernanceDialog>);
    rerender(<GovernanceDialog open onRequestClose={vi.fn()} title="退休">不同內容</GovernanceDialog>);
    fireEvent(window, new Event("resize"));
    expect(showModal).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "退休" })).toHaveProperty("open", true);
  });

  it("handles StrictMode replay and final cleanup with exactly one close per open cycle", () => {
    const request = vi.fn(); const { rerender, unmount } = render(<StrictMode>
      <GovernanceDialog open onRequestClose={request} title="送審">內容</GovernanceDialog>
    </StrictMode>);
    expect(showModal).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledOnce();
    rerender(<StrictMode><GovernanceDialog open={false} onRequestClose={request} title="送審">內容</GovernanceDialog></StrictMode>);
    expect(close).toHaveBeenCalledTimes(2); unmount(); expect(close).toHaveBeenCalledTimes(2);
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed rather than displaying a non-modal fallback if showModal fails", () => {
    showModal.mockImplementationOnce(() => { throw new Error("unsupported dialog"); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<GovernanceDialog open onRequestClose={vi.fn()} title="送審">內容</GovernanceDialog>)).toThrow("unsupported dialog");
    expect(document.querySelector("dialog[open]")).toBeNull();
  });
});
