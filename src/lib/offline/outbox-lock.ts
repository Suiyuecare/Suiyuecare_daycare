"use client";

// All tabs share this lock while an offline care command is sent and its
// receipt is reconciled. Logout takes the same lock before deleting drafts.
// Acquire this lock before the draft-store lock, never in the reverse order.
const OUTBOX_LOCK = "daycare-offline-outbox-global-v1";

export async function withOfflineOutboxLock<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    throw new Error("OFFLINE_PROTECTED_STORAGE_UNAVAILABLE");
  }
  return navigator.locks.request(
    OUTBOX_LOCK,
    signal ? { mode: "exclusive", signal } : { mode: "exclusive" },
    operation,
  );
}
