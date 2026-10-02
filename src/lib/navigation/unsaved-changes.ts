"use client";

import { hasPendingOperations, hasViewTransition } from "./pending-operation-lock";

export type UnsavedChangesOwner = {
  isDirty: () => boolean;
  requestDiscard: (proceed: () => void, isCurrent: () => boolean) => void;
  onBlocked?: () => void;
  onInvalidate: () => void;
};

// Coordination only: no clinical values, actor IDs, request bodies or storage.
// Each owner retains its own editor and confirmation lifecycle.
const owners = new Map<symbol, UnsavedChangesOwner>();

export function registerUnsavedChangesOwner(owner: UnsavedChangesOwner) {
  const token = Symbol("unsaved-owner");
  owners.set(token, owner);
  return () => { owners.delete(token); };
}

/** true means the caller must not proceed; false means there is no dirty owner.
 * Never guess which draft to discard when several owners are dirty. */
export function requestUnsavedExit(proceed: () => void, isCurrent: () => boolean = () => true): boolean {
  const dirty = [...owners.values()].filter((owner) => owner.isDirty());
  if (hasPendingOperations() || hasViewTransition() || dirty.length > 1) {
    for (const owner of dirty) owner.onBlocked?.();
    return true;
  }
  if (dirty.length === 0) return false;
  dirty[0].requestDiscard(proceed, isCurrent);
  return true;
}

/** Confirmation must still belong to the only dirty owner at the last moment. */
export function mayDiscardUnsavedChanges(owner: UnsavedChangesOwner) {
  const dirty = [...owners.values()].filter((entry) => entry.isDirty());
  return dirty.length === 1 && dirty[0] === owner && !hasPendingOperations() && !hasViewTransition();
}

/** Safe logout is unconditional, not a potentially cancellable leave prompt. */
export function clearUnsavedChangesOnLogout() {
  const detached = [...owners.values()];
  owners.clear(); // detach old actor callbacks before a consumer can throw/reenter
  // One faulty consumer must never prevent other privacy owners from clearing.
  for (const owner of detached) {
    try { owner.onInvalidate(); } catch { /* continue safe logout, never log editor values */ }
  }
}
