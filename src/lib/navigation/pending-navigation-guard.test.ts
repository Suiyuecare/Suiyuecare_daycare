// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installPendingNavigationGuard } from "./pending-navigation-guard";
let remove = () => {};
afterEach(() => { remove(); document.body.replaceChildren(); document.querySelectorAll("base").forEach((base) => base.remove()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function guard(pending = true) {
  const blocked = vi.fn(); remove = installPendingNavigationGuard({ hasPendingOperation: () => pending,
    permittedFormAttribute: "data-test-recovery-form", onBlocked: blocked }); return blocked;
}
function link(href: string, attributes: Record<string, string> = {}) {
  const element = document.createElement("a"); element.href = href;
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  document.body.append(element); return element;
}
function click(element: HTMLElement, options: MouseEventInit = {}) {
  const event = new MouseEvent("click", { button: 0, bubbles: true, cancelable: true, ...options });
  element.dispatchEvent(event); return event;
}
describe("payload-free shared pending navigation owner", () => {
  it.each(["/app/clients", "https://finance.example.com/portal", "#section"])("blocks same-tab HTTP destination %s", (href) => {
    const blocked = guard(); expect(click(link(href)).defaultPrevented).toBe(true); expect(blocked).toHaveBeenCalledOnce();
  });
  it("blocks cross-origin download links that may actually navigate", () => {
    guard(); expect(click(link("https://finance.example.com/file", { download: "receipt.pdf" })).defaultPrevented).toBe(true);
  });
  it.each([{ target: "_blank", href: "/app/clients" }, { href: "mailto:help@example.com", target: "_self" }])("allows explicit non-replacing destinations %j", (attributes) => {
    const blocked = guard(); expect(click(link(attributes.href, attributes)).defaultPrevented).toBe(false);
    expect(blocked).not.toHaveBeenCalled();
  });
  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])("leaves independent-tab interaction %j alone", (options) => {
    guard(); expect(click(link("/app/clients"), options).defaultPrevented).toBe(false);
  });
  it("honors base targets and an explicitly empty override as same-tab", () => {
    guard(); const base = document.createElement("base"); base.target = "_blank"; document.head.append(base);
    expect(click(link("/app/clients")).defaultPrevented).toBe(false);
    expect(click(link("/app/clients", { target: "" })).defaultPrevented).toBe(true);
  });
  it("handles submitter method, target and destination overrides", () => {
    guard(); const form = document.createElement("form"); form.action = "/app/clients"; form.target = "_blank";
    const button = document.createElement("button"); button.setAttribute("formtarget", ""); button.setAttribute("formaction", "https://finance.example.com/");
    form.append(button); document.body.append(form);
    const event = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }); form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    button.setAttribute("formmethod", "dialog"); const dialogEvent = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button });
    form.dispatchEvent(dialogEvent); expect(dialogEvent.defaultPrevented).toBe(false);
  });
  it("allows only the named recovery form while blocking unrelated GET filters", () => {
    guard(); const form = document.createElement("form"); form.action = "/app/body"; document.body.append(form);
    let event = new Event("submit", { bubbles: true, cancelable: true }); form.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    form.setAttribute("data-test-recovery-form", ""); event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  });
  it("warns on full unload but promises cancellation only for cancelable Navigation API events", () => {
    const navigation = new EventTarget(); Object.defineProperty(window, "navigation", { configurable: true, value: navigation });
    guard(); const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    const supported = new Event("navigate", { cancelable: true }); navigation.dispatchEvent(supported); expect(supported.defaultPrevented).toBe(true);
    const unsupported = new Event("navigate"); navigation.dispatchEvent(unsupported); expect(unsupported.defaultPrevented).toBe(false);
    remove(); const after = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(after); expect(after.defaultPrevented).toBe(false);
  });
  it("does nothing when the caller has no pending operation", () => {
    const blocked = guard(false); expect(click(link("/app/clients")).defaultPrevented).toBe(false); expect(blocked).not.toHaveBeenCalled();
  });
  it("rolls back partially installed listeners when registration throws", () => {
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      if (type === "beforeunload") throw new Error("synthetic install failure"); add(type, listener, options);
    });
    const blocked = vi.fn(); expect(() => installPendingNavigationGuard({ hasPendingOperation: () => true,
      permittedFormAttribute: "data-test-recovery-form", onBlocked: blocked })).toThrow("synthetic install failure");
    expect(click(link("/app/clients")).defaultPrevented).toBe(false); expect(blocked).not.toHaveBeenCalled();
  });
});
