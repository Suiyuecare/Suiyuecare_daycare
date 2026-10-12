// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getScopeChangePendingReason } from "./scope-change-pending";
import { useProtectedCompletionDraft } from "./use-protected-completion-draft";

function Draft({ dirty = false, busy = false, unknown = false, onBlockedNavigation }: {
  dirty?: boolean; busy?: boolean; unknown?: boolean; onBlockedNavigation?: (reason: "dirty" | "busy" | "unknown") => void;
}) { useProtectedCompletionDraft(dirty, busy, unknown, onBlockedNavigation); return null; }

function navigate({ href = "/app/another-workflow", target, download, ...eventOptions }: MouseEventInit & {
  href?: string; target?: string; download?: string;
} = {}) {
  const anchor = document.createElement("a"); anchor.href = href;
  if (target) anchor.target = target;
  if (download !== undefined) anchor.setAttribute("download", download);
  document.body.append(anchor);
  let capturedDefault: boolean | undefined;
  // Avoid asking jsdom to navigate; record whether the capture guard allowed it.
  anchor.addEventListener("click", event => { capturedDefault = event.defaultPrevented; event.preventDefault(); });
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...eventOptions });
  anchor.dispatchEvent(event); anchor.remove();
  return capturedDefault ?? event.defaultPrevented;
}
afterEach(() => { cleanup(); expect(getScopeChangePendingReason()).toBeNull(); });

describe("opt-in completion navigation protection", () => {
  it.each([{ dirty: true, reason: "dirty" }, { dirty: true, busy: true, reason: "busy" },
    { dirty: true, busy: true, unknown: true, reason: "unknown" }] as const)("holds ordinary navigation and publishes $reason", ({ reason, ...state }) => {
    const blocked = vi.fn(); render(<Draft {...state} onBlockedNavigation={blocked} />);
    expect(navigate()).toBe(true); expect(blocked).toHaveBeenCalledWith(reason);
    expect(getScopeChangePendingReason()).toBe(reason);
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });
  it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 },
    { target: "_blank" }, { download: "" }, { download: "synthetic.pdf" }, { href: "#details" },
    { href: `${window.location.pathname}${window.location.search}#details` }])("preserves modifier/new-tab/download/hash semantics %j", options => {
    const blocked = vi.fn(); render(<Draft dirty onBlockedNavigation={blocked} />);
    expect(navigate(options)).toBe(false); expect(blocked).not.toHaveBeenCalled();
  });
  it("restores ordinary navigation and clean unload after a saved or explicitly discarded draft", () => {
    const blocked = vi.fn(); const view = render(<Draft dirty onBlockedNavigation={blocked} />);
    expect(navigate()).toBe(true); view.rerender(<Draft onBlockedNavigation={blocked} />);
    expect(navigate()).toBe(false); expect(blocked).toHaveBeenCalledTimes(1);
    expect(getScopeChangePendingReason()).toBeNull();
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });
  it("leaves ordinary navigation behavior unchanged for existing callers without the opt-in", () => {
    render(<Draft dirty />); expect(navigate()).toBe(false); expect(getScopeChangePendingReason()).toBe("dirty");
  });
});
