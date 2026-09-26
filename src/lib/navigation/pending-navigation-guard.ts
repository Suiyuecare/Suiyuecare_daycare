"use client";

export type PendingNavigationGuardOptions = {
  hasPendingOperation: () => boolean;
  permittedFormAttribute: `data-${string}`;
  onBlocked: () => void;
};

function sameTab(target: string | null) {
  return !target || ["_self", "_top", "_parent"].includes(target.toLowerCase());
}
function httpDestination(value: string) {
  try { return /^https?:$/u.test(new URL(value, document.baseURI).protocol); }
  catch { return false; }
}

/** Shared navigation semantics only. The caller owns its independent journal,
 * operation lease and cleanup lifetime; this owner never sees clinical data,
 * financial data, actor identities, request bodies or idempotency keys. */
export function installPendingNavigationGuard({ hasPendingOperation, permittedFormAttribute, onBlocked }: PendingNavigationGuardOptions) {
  if (typeof window === "undefined") return () => {};
  const block = (event: Event) => {
    if (!hasPendingOperation()) return;
    event.preventDefault(); event.stopImmediatePropagation(); onBlocked();
  };
  const click = (event: MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    const target = link.getAttribute("target") ?? document.querySelector("base[target]")?.getAttribute("target") ?? null;
    // A cross-origin download may navigate despite its download attribute.
    if (sameTab(target) && httpDestination(link.href)) block(event);
  };
  const submit = (event: SubmitEvent) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.hasAttribute(permittedFormAttribute)) return;
    const submitter = event.submitter;
    const target = submitter?.getAttribute("formtarget") ?? form.getAttribute("target") ?? document.querySelector("base[target]")?.getAttribute("target") ?? null;
    const action = submitter?.getAttribute("formaction") ?? form.getAttribute("action") ?? document.location.href;
    const method = submitter?.getAttribute("formmethod") ?? form.getAttribute("method") ?? "get";
    if (method.toLowerCase() !== "dialog" && sameTab(target) && httpDestination(action)) block(event);
  };
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (hasPendingOperation()) { event.preventDefault(); event.returnValue = " "; }
  };
  // Cancel supported Navigation API transitions; unsupported/noncancelable
  // browser traversal cannot honestly be promised universal protection.
  const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
  const navigate = (event: Event) => { if (event.cancelable) block(event); };
  const remove = () => {
    document.removeEventListener("click", click, true); document.removeEventListener("submit", submit, true);
    window.removeEventListener("beforeunload", beforeUnload); navigation?.removeEventListener("navigate", navigate);
  };
  try {
    document.addEventListener("click", click, true); document.addEventListener("submit", submit, true);
    window.addEventListener("beforeunload", beforeUnload); navigation?.addEventListener("navigate", navigate);
  } catch (error) { remove(); throw error; }
  return remove;
}
