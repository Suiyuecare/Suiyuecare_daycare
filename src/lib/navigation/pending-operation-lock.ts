"use client";

import { useSyncExternalStore } from "react";

// Tab-local coordination only: opaque Symbols and booleans, never client IDs,
// request bodies, idempotency keys, tokens, localStorage or sessionStorage.
const operations = new Set<symbol>();
// Bind recovery to the original opaque owner, never to a payload or user ID.
const operationOwners = new WeakMap<() => void, symbol>();
let viewTransition: symbol | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const serverSnapshot = () => false;

export const hasPendingOperations = () => operations.size > 0;
export const hasViewTransition = () => viewTransition !== null;
export function usePendingOperations() {
  return useSyncExternalStore(subscribe, hasPendingOperations, serverSnapshot);
}
export function useViewTransitionPending() {
  return useSyncExternalStore(subscribe, hasViewTransition, serverSnapshot);
}

/** Acquire BEFORE creating an operation or sending its first write. Keep the
 * release closure across retries, including later rejections after uncertainty.
 * Release only after a correlated success or known first-attempt non-commit.
 * Do not release an unknown operation merely because its composer unmounted. */
export function tryAcquirePendingOperation(): (() => void) | null {
  if (typeof window === "undefined" || viewTransition !== null) return null;
  const token = Symbol();
  operations.add(token);
  notify();
  const release = () => { if (operations.delete(token)) notify(); };
  operationOwners.set(release, token);
  return release;
}

/** Refresh and branch changes acquire synchronously BEFORE any navigation or
 * cookie-changing request. This also stops a new write starting mid-refresh.
 * Release at completed React transition or full-view unmount; never on an
 * uncertain branch POST while the old page is still mounted. */
export function tryAcquireViewTransition(): (() => void) | null {
  if (typeof window === "undefined" || hasPendingOperations() || viewTransition !== null) return null;
  const token = Symbol();
  viewTransition = token;
  notify();
  return () => {
    if (viewTransition === token) { viewTransition = null; notify(); }
  };
}

/** Read-only recovery may run beside exactly its own unknown write. The
 * journal verifies phase/identity before passing its private lease. This keeps
 * that write held and excludes all writes/navigation until the read finishes.
 * Foreign, released and fabricated release closures never qualify. */
export function tryAcquirePendingRecoveryRead(ownWriteLease?: () => void): (() => void) | null {
  if (typeof window === "undefined" || viewTransition !== null) return null;
  if (!ownWriteLease) return tryAcquireViewTransition();
  const owner = operationOwners.get(ownWriteLease);
  if (!owner || operations.size !== 1 || !operations.has(owner)) return null;
  const token = Symbol();
  viewTransition = token;
  notify();
  return () => {
    if (viewTransition === token) { viewTransition = null; notify(); }
  };
}
