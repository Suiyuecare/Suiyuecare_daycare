"use client";

import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";

/** Tab-local scope-change safety only. Never retain client identity or draft contents. */
export type ScopeChangeDraftState = { dirty: boolean; busy: boolean; unknown: boolean };
export type ScopeChangePendingReason = "dirty" | "busy" | "unknown" | null;

const entries = new Map<symbol, ScopeChangeDraftState>();
const listeners = new Set<() => void>();
let reason: ScopeChangePendingReason = null;

function computeReason(): ScopeChangePendingReason {
  let dirty = false;
  let busy = false;
  for (const entry of entries.values()) {
    if (entry.unknown) return "unknown";
    busy ||= entry.busy;
    dirty ||= entry.dirty;
  }
  return busy ? "busy" : dirty ? "dirty" : null;
}

function publish() {
  const next = computeReason();
  if (reason === next) return;
  reason = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getScopeChangePendingReason() { return reason; }
export function hasScopeChangePending() { return reason !== null; }
export function useScopeChangePendingReason() {
  return useSyncExternalStore(subscribe, getScopeChangePendingReason, () => null);
}

/** Register one independent editor. Its updater publishes before the next
 * scope-changing click, while cleanup prevents late callbacks reviving a page. */
export function useScopeChangeDraftRegistration() {
  const token = useRef(Symbol("scope-change-draft"));
  const mounted = useRef(false);
  const latest = useRef<ScopeChangeDraftState>({ dirty: false, busy: false, unknown: false });

  useLayoutEffect(() => {
    const entryToken = token.current;
    mounted.current = true;
    entries.set(entryToken, latest.current);
    publish();
    return () => {
      mounted.current = false;
      entries.delete(entryToken);
      publish();
    };
  }, []);

  return useCallback((state: ScopeChangeDraftState) => {
    latest.current = state;
    if (!mounted.current) return;
    entries.set(token.current, state);
    publish();
  }, []);
}
