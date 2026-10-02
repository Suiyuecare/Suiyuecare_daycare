"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { hasPendingOperations, hasViewTransition } from "./pending-operation-lock";
import { mayDiscardUnsavedChanges, registerUnsavedChangesOwner, requestUnsavedExit, type UnsavedChangesOwner } from "./unsaved-changes";

type Options = {
  dirty: boolean;
  scopeKey: string;
  revisionKey: string;
  canPrompt: boolean;
  permittedFormAttribute: `data-${string}`;
  onDiscard: () => void;
};
type QueuedExit = { token: symbol; epoch: number; proceed: () => void; valid: () => boolean };
type NavigationTarget = EventTarget & {
  navigate?: (url: string, options?: { history: "push" | "replace" }) => unknown;
  traverseTo?: (key: string) => unknown;
};
type NavigateEvent = Event & {
  destination?: { url: string; key?: string };
  navigationType?: string;
  formData?: FormData | null;
};
function effectiveTarget(node: HTMLElement, submitter?: HTMLElement | null) {
  return submitter?.getAttribute("formtarget") ?? node.getAttribute("target") ??
    document.querySelector("base[target]")?.getAttribute("target") ?? "";
}
function sameTab(value: string) {
  return !value || ["_self", "_top", "_parent"].includes(value.toLowerCase()) || (!!window.name && value === window.name);
}
function httpUrl(value: string) {
  try { const url = new URL(value, document.baseURI); return /^https?:$/u.test(url.protocol) ? url : null; }
  catch { return null; }
}
function sameDocumentAnchor(url: URL) {
  const current = new URL(window.location.href);
  return url.origin === current.origin && url.pathname === current.pathname && url.search === current.search && !!url.hash;
}
function getFormDestination(form: HTMLFormElement, submitter: HTMLElement | null) {
  return {
    target: effectiveTarget(form, submitter),
    action: httpUrl(submitter?.getAttribute("formaction") ?? form.getAttribute("action") ?? window.location.href)?.href ?? null,
    method: (submitter?.getAttribute("formmethod") ?? form.getAttribute("method") ?? "get").toLowerCase(),
  };
}
function formValues(form: HTMLFormElement, submitter: HTMLElement | null) {
  // Only a transient equality check; no values enter history or browser storage.
  const data = new FormData(form, submitter);
  return JSON.stringify([...data].map(([key, value]) => [key,
    typeof value === "string" ? value : [value.name, value.size, value.type, value.lastModified]]));
}
const locked = () => hasPendingOperations() || hasViewTransition();
function validDestination(exit: QueuedExit) { try { return exit.valid(); } catch { return false; } }

/** One app-owned discard confirmation. The consumer renders GovernanceDialog;
 * the continuation runs only after that dialog's passive cleanup has closed it.
 * Unsupported/noncancelable browser history can only use beforeunload warnings. */
export function useUnsavedChanges(options: Options) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const latest = useRef(options);
  const lifecycle = useRef({ mounted: false, epoch: 0, scopeKey: options.scopeKey, revisionKey: options.revisionKey });
  const queued = useRef<QueuedExit | null>(null);
  const accepted = useRef<QueuedExit | null>(null);
  const composition = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const owner = useRef<UnsavedChangesOwner | null>(null);

  useLayoutEffect(() => {
    const privacyChanged = lifecycle.current.scopeKey !== options.scopeKey;
    const sourceChanged = lifecycle.current.revisionKey !== options.revisionKey;
    latest.current = options;
    if (privacyChanged || sourceChanged) {
      lifecycle.current.epoch += 1;
      lifecycle.current.scopeKey = options.scopeKey; lifecycle.current.revisionKey = options.revisionKey;
      queued.current = null; accepted.current = null; composition.current = false;
      setOpen(false); setNotice("");
      if (privacyChanged) options.onDiscard();
    }
  }, [options]);

  const blocked = useCallback(() => { setNotice("請先完成其他作業或取消其他未保存編輯，再執行此操作。"); }, []);
  const queue = useCallback((proceed: () => void, valid: () => boolean = () => true) => {
    if (!lifecycle.current.mounted || queued.current || accepted.current) return;
    if (locked() || !latest.current.canPrompt) { blocked(); return; }
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queued.current = { token: Symbol("discard"), epoch: lifecycle.current.epoch, proceed, valid };
    composition.current = false; setNotice(""); setOpen(true);
  }, [blocked]);
  const invalidate = useCallback(() => {
    lifecycle.current.epoch += 1; queued.current = null; accepted.current = null;
    composition.current = false; latest.current = { ...latest.current, dirty: false };
    setOpen(false); setNotice(""); latest.current.onDiscard();
  }, []);

  useEffect(() => {
    const activeLifecycle = lifecycle.current;
    activeLifecycle.mounted = true;
    const registeredOwner: UnsavedChangesOwner = { isDirty: () => latest.current.dirty,
      requestDiscard: queue, onBlocked: blocked, onInvalidate: invalidate };
    owner.current = registeredOwner;
    const unregister = registerUnsavedChangesOwner(registeredOwner);
    function stop(event: Event) { event.preventDefault(); event.stopImmediatePropagation(); }
    function click(event: MouseEvent) {
      if (!latest.current.dirty || event.defaultPrevented || event.button !== 0 ||
          event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const url = httpUrl(link.href); const target = effectiveTarget(link);
      if (!url || !sameTab(target) || sameDocumentAnchor(url)) return;
      if (link.hasAttribute("download") && url.origin === window.location.origin) return;
      const documentAtClick = document; const locationAtClick = window.location.href;
      const baseAtClick = document.baseURI; const href = link.href; const nameAtClick = window.name;
      stop(event);
      const valid = () => link.isConnected && link.ownerDocument === documentAtClick && document === documentAtClick &&
        window.location.href === locationAtClick && window.name === nameAtClick && document.baseURI === baseAtClick && link.href === href && effectiveTarget(link) === target;
      requestUnsavedExit(() => link.click(), valid);
    }
    function submit(event: SubmitEvent) {
      if (!latest.current.dirty || event.defaultPrevented) return;
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form.hasAttribute(latest.current.permittedFormAttribute)) return;
      const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;
      const destination = getFormDestination(form, submitter);
      if (!sameTab(destination.target) || !destination.action || destination.method === "dialog") return;
      stop(event);
      if (destination.method !== "get") { blocked(); return; } // never replay a mutation
      const documentAtSubmit = document; const locationAtSubmit = window.location.href; const baseAtSubmit = document.baseURI; const nameAtSubmit = window.name;
      let values: string;
      try { values = formValues(form, submitter); } catch { blocked(); return; }
      const valid = () => form.isConnected && form.ownerDocument === documentAtSubmit && document === documentAtSubmit &&
        (!submitter || (submitter.isConnected && (submitter as HTMLButtonElement).form === form)) &&
        window.location.href === locationAtSubmit && window.name === nameAtSubmit && document.baseURI === baseAtSubmit &&
        JSON.stringify(getFormDestination(form, submitter)) === JSON.stringify(destination) && formValues(form, submitter) === values;
      requestUnsavedExit(() => form.requestSubmit(submitter), valid);
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!latest.current.dirty) return;
      event.preventDefault(); event.returnValue = " ";
    }
    const navigation = (window as unknown as { navigation?: NavigationTarget }).navigation;
    function navigate(rawEvent: Event) {
      if (!latest.current.dirty || !rawEvent.cancelable || rawEvent.defaultPrevented) return;
      const event = rawEvent as NavigateEvent; const url = event.destination && httpUrl(event.destination.url);
      if (!url) return;
      // form.submit() can bypass the submit event. Never turn its POST
      // NavigateEvent into a GET by replaying navigation.navigate().
      if (event.formData != null) { stop(event); blocked(); return; }
      if (sameDocumentAnchor(url)) return;
      stop(event);
      const currentHref = window.location.href; const base = document.baseURI;
      const valid = () => window.location.href === currentHref && document.baseURI === base;
      if (event.navigationType === "traverse" && event.destination?.key && navigation?.traverseTo) {
        const key = event.destination.key;
        requestUnsavedExit(() => { navigation.traverseTo?.(key); }, valid);
      } else if ((event.navigationType === "push" || event.navigationType === "replace") && navigation?.navigate) {
        const history = event.navigationType;
        requestUnsavedExit(() => { navigation.navigate?.(url.href, { history }); }, valid);
      } else blocked();
    }
    const remove = () => {
      document.removeEventListener("click", click, true); document.removeEventListener("submit", submit, true);
      window.removeEventListener("beforeunload", beforeUnload); navigation?.removeEventListener("navigate", navigate);
    };
    try {
      document.addEventListener("click", click, true); document.addEventListener("submit", submit, true);
      window.addEventListener("beforeunload", beforeUnload); navigation?.addEventListener("navigate", navigate);
    } catch (error) { remove(); unregister(); activeLifecycle.mounted = false; throw error; }
    return () => {
      remove(); unregister(); owner.current = null; activeLifecycle.mounted = false; activeLifecycle.epoch += 1;
      queued.current = null; accepted.current = null;
    };
  }, [blocked, invalidate, options.scopeKey, queue]);

  useEffect(() => {
    if (open || !accepted.current) return;
    const exit = accepted.current; accepted.current = null;
    if (!lifecycle.current.mounted || exit.epoch !== lifecycle.current.epoch || locked() || !validDestination(exit)) return;
    // Another dirty owner appearing while the dialog was open must not be lost.
    if (!requestUnsavedExit(exit.proceed, exit.valid)) exit.proceed();
  }, [open]);

  return {
    open, notice, returnFocusRef: trigger,
    requestExit(proceed: () => void) { if (!requestUnsavedExit(proceed)) proceed(); },
    cancel() { queued.current = null; accepted.current = null; composition.current = false; setOpen(false); },
    confirmDiscard() {
      const exit = queued.current;
      if (!exit || composition.current || !lifecycle.current.mounted || exit.epoch !== lifecycle.current.epoch) return;
      if (locked() || !latest.current.canPrompt) { blocked(); return; }
      if (!owner.current || !mayDiscardUnsavedChanges(owner.current)) { blocked(); return; }
      if (!validDestination(exit)) { queued.current = null; setOpen(false); setNotice("原操作已變更，請重新選擇要執行的操作。"); return; }
      queued.current = null; accepted.current = exit; latest.current = { ...latest.current, dirty: false };
      latest.current.onDiscard(); composition.current = false; setOpen(false);
    },
    compositionStart() { composition.current = true; },
    compositionEnd() { composition.current = false; },
  };
}
