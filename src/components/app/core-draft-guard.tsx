"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";

type DraftGuardState = { dirty: boolean; busy: boolean; held: boolean };
type PendingDiscard = {
  owner?: DraftGuardState;
  action: () => void;
  trigger: HTMLElement | null;
};

const activeDraftGuards = new Set<DraftGuardState>();
const subscribers = new Set<() => void>();
let pendingDiscard: PendingDiscard | null = null;
let resumedLink: HTMLAnchorElement | null = null;
let resumedForm: HTMLFormElement | null = null;
let approvedUnload = false;
let approvedUnloadTimer: number | null = null;

function publish() { for (const subscriber of subscribers) subscriber(); }
function subscribe(subscriber: () => void) { subscribers.add(subscriber); return () => { subscribers.delete(subscriber); }; }
function currentDiscard() { return pendingDiscard; }
function noServerDiscard() { return null; }
function anyBlocked() { for (const guard of activeDraftGuards) if (guard.busy || guard.held) return true; return false; }
function anyHeld() { for (const guard of activeDraftGuards) if (guard.held) return true; return false; }
function anyDirty() { for (const guard of activeDraftGuards) if (guard.dirty) return true; return false; }

/** Synchronous boundary check for scope changes and router.refresh. */
export function hasCoreDraftPending() { return anyDirty() || anyBlocked(); }
/** Synchronous check for writes in flight or with an unknown result. */
export function hasCoreDraftBlocked() { return anyBlocked(); }

export function useCoreDraftPending() {
  return useSyncExternalStore(subscribe, hasCoreDraftPending, () => false);
}

function setApprovedUnload() {
  approvedUnload = true;
  if (approvedUnloadTimer !== null) window.clearTimeout(approvedUnloadTimer);
  // A cancelled click or a client-side transition must not exempt a later tab close.
  approvedUnloadTimer = window.setTimeout(() => { approvedUnload = false; approvedUnloadTimer = null; }, 1500);
}

function clearApprovedUnload() {
  approvedUnload = false;
  if (approvedUnloadTimer !== null) window.clearTimeout(approvedUnloadTimer);
  approvedUnloadTimer = null;
}

function guardUnload(event: BeforeUnloadEvent) {
  // A write may start after leave consent but before the browser unloads.
  // In-flight or unknown writes always take precedence over that consent.
  if (anyBlocked()) {
    clearApprovedUnload();
    event.preventDefault();
    event.returnValue = "";
    return;
  }
  if (approvedUnload) {
    clearApprovedUnload();
    return;
  }
  if (!anyDirty()) return;
  event.preventDefault();
  event.returnValue = "";
}

function triggerOf(value: EventTarget | null) {
  return value instanceof HTMLElement ? value : document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function queueDiscard(action: () => void, trigger: HTMLElement | null, owner?: DraftGuardState) {
  if (anyBlocked() || pendingDiscard) return false;
  if (owner ? !owner.dirty : !anyDirty()) { action(); return true; }
  // An unavailable host must leave the draft untouched. The host is installed
  // by AppShell and by focused component test harnesses.
  if (subscribers.size === 0) return false;
  pendingDiscard = { owner, action, trigger };
  publish();
  return true;
}

/** Use for explicit in-app actions such as logout; the action runs after consent. */
export function requestCoreDraftLeave(action: () => void, trigger?: HTMLElement | null) {
  return queueDiscard(action, trigger ?? triggerOf(null));
}

function guardLinkClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!link || link === resumedLink || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
  let destination: URL;
  try { destination = new URL(link.href, window.location.href); } catch { return; }
  if (!["http:", "https:"].includes(destination.protocol)) return;
  const current = new URL(window.location.href);
  if (destination.origin === current.origin && destination.pathname === current.pathname && destination.search === current.search) return;
  if (!anyDirty() && !anyBlocked()) return;
  event.preventDefault();
  event.stopPropagation();
  queueDiscard(() => {
    if (!link.isConnected) return;
    resumedLink = link;
    setApprovedUnload();
    try {
      const replay = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      link.dispatchEvent(replay);
      // Next Link cancels the native click for a client-side transition.
      if (replay.defaultPrevented) clearApprovedUnload();
    } finally { resumedLink = null; }
  }, link);
}

function guardGetSubmit(event: SubmitEvent) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form === resumedForm || form.hasAttribute("data-core-care-draft") || form.method.toLowerCase() !== "get") return;
  if (!anyDirty() && !anyBlocked()) return;
  event.preventDefault();
  event.stopPropagation();
  const submitter = event.submitter;
  queueDiscard(() => {
    if (!form.isConnected) return;
    resumedForm = form;
    setApprovedUnload();
    const replaySubmit: { event: Event | null } = { event: null };
    const captureReplay = (replay: Event) => { if (replay.target === form) replaySubmit.event = replay; };
    document.addEventListener("submit", captureReplay, true);
    try {
      if ((submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) && submitter.form === form && !submitter.disabled) form.requestSubmit(submitter);
      else form.requestSubmit();
    } catch {
      // A form can replace/disable its submitter while consent is open. Keep
      // the draft and unload guard rather than leaving a stale exemption.
      clearApprovedUnload();
    } finally {
      document.removeEventListener("submit", captureReplay, true);
      resumedForm = null;
      // React's delegated handler can cancel or stop the replayed submit. The
      // capture phase retains that exact event for inspection after it returns.
      if (!replaySubmit.event || replaySubmit.event.defaultPrevented) clearApprovedUnload();
    }
  }, triggerOf(submitter));
}

function registerDraftGuard(guard: DraftGuardState) {
  if (activeDraftGuards.size === 0) {
    window.addEventListener("beforeunload", guardUnload);
    document.addEventListener("click", guardLinkClick, true);
    document.addEventListener("submit", guardGetSubmit, true);
  }
  activeDraftGuards.add(guard);
  publish();
  return () => {
    activeDraftGuards.delete(guard);
    publish();
    if (pendingDiscard?.owner === guard) { pendingDiscard = null; publish(); }
    if (activeDraftGuards.size > 0) return;
    if (pendingDiscard) { pendingDiscard = null; publish(); }
    window.removeEventListener("beforeunload", guardUnload);
    document.removeEventListener("click", guardLinkClick, true);
    document.removeEventListener("submit", guardGetSubmit, true);
  };
}

/** Protect local cancellation, links, GET navigation and actual page unloads. */
export function useCoreDraftGuard() {
  const guard = useRef<DraftGuardState>({ dirty: false, busy: false, held: false });
  useEffect(() => registerDraftGuard(guard.current), []);
  return {
    changed() { guard.current.dirty = true; publish(); },
    begin() { if (guard.current.busy) return false; guard.current.busy = true; guard.current.dirty = true; publish(); return true; },
    finish() { guard.current.busy = false; publish(); },
    /** The server may have committed this write; no discard/navigation is safe yet. */
    hold() { guard.current.held = true; guard.current.dirty = true; publish(); },
    /** A definite non-commit is verified; the editable draft remains dirty. */
    unhold() { guard.current.held = false; publish(); },
    saved() { guard.current.dirty = false; guard.current.held = false; publish(); },
    discard(onApproved: () => void, trigger?: HTMLElement | null) {
      return queueDiscard(() => {
        if (!activeDraftGuards.has(guard.current)) return;
        guard.current.dirty = false;
        publish();
        try { onApproved(); } catch (error) { guard.current.dirty = true; publish(); throw error; }
      }, trigger ?? triggerOf(null), guard.current);
    },
  };
}

/** For disabling explicit actions while a write is in flight or unresolved. */
export function useCoreDraftBlocked() {
  return useSyncExternalStore(subscribe, anyBlocked, () => false);
}

export function useCoreDraftHeld() {
  return useSyncExternalStore(subscribe, anyHeld, () => false);
}

export function CoreDraftGuardHost() {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const discardButton = useRef<HTMLButtonElement>(null);
  const request = useSyncExternalStore(subscribe, currentDiscard, noServerDiscard);

  useEffect(() => () => {
    if (pendingDiscard) { pendingDiscard = null; publish(); }
    clearApprovedUnload();
  }, []);

  useEffect(() => {
    if (!request || dialog.current?.open) return;
    try {
      dialog.current?.showModal();
      cancelButton.current?.focus();
    } catch {
      pendingDiscard = null;
      publish();
      request.trigger?.focus();
    }
  }, [request]);

  function cancel() {
    if (!pendingDiscard) return;
    const trigger = pendingDiscard.trigger;
    pendingDiscard = null;
    publish();
    dialog.current?.close();
    window.setTimeout(() => { if (trigger?.isConnected && !dialog.current?.open) trigger.focus(); }, 0);
  }

  function confirm() {
    const current = pendingDiscard;
    if (!current) return;
    if (anyBlocked() || (current.owner && !activeDraftGuards.has(current.owner))) { cancel(); return; }
    pendingDiscard = null;
    publish();
    dialog.current?.close();
    current.action();
  }

  return <dialog aria-describedby={`${titleId}-description`} aria-labelledby={`${titleId}-title`}
    className="core-dialog" onCancel={(event) => { event.preventDefault(); cancel(); }}
    onClose={() => { if (pendingDiscard && !dialog.current?.open) cancel(); }}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const first = cancelButton.current;
      const last = discardButton.current;
      if (!first || !last) return;
      const outside = !dialog.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
    }} ref={dialog} role="alertdialog">
    <div className="core-dialog__surface">
      <header className="drawer__header"><h2 id={`${titleId}-title`}>{request?.owner ? "放棄未儲存的輸入？" : "放棄未儲存的內容並離開？"}</h2></header>
      <div className="drawer__body core-dialog__body" id={`${titleId}-description`}>
        <p>{request?.owner ? "這次輸入尚未儲存。放棄後無法接續本次填寫。" : "目前仍有未儲存的輸入。離開後無法接續本次填寫；已保存的資料不受影響。"}</p>
      </div>
      <footer className="drawer__footer">
        <button autoFocus className="button button--secondary" onClick={cancel} ref={cancelButton} type="button">繼續填寫</button>
        <button className="button button--danger" onClick={confirm} ref={discardButton} type="button">{request?.owner ? "放棄本次輸入" : "放棄輸入並離開"}</button>
      </footer>
    </div>
  </dialog>;
}
