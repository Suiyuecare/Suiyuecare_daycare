"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import { hasPendingOperations, tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";
import type { ClaimValidationExpected } from "./claim-validation-client";

export type ClaimValidationScope = { organizationId: string; branchId: string; userId: string };
export type ClaimValidationBatch = { id: string; periodLabel: string; totalAmount: string; itemCount: number };
const uuid = z.uuid().transform((value) => value.toLowerCase());
const scopeSchema = z.object({ organizationId: uuid, branchId: uuid, userId: uuid }).strict();
const batchSchema = z.object({ id: uuid, periodLabel: z.string().min(1).max(160),
  totalAmount: z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/u).transform((value) => {
    const [whole, fraction = ""] = value.split("."); return `${whole}.${fraction.padEnd(2, "0")}`;
  }), itemCount: z.number().int().min(1).max(5000) }).strict();

export function claimValidationScopeIdentity(scope: ClaimValidationScope, demo: boolean) {
  const normalized = scopeSchema.parse(scope);
  return JSON.stringify([normalized.organizationId, normalized.branchId, normalized.userId, demo]);
}
export type ClaimValidationOperation = Readonly<{
  token: symbol; scope: ClaimValidationScope; identity: string; batch: ClaimValidationBatch;
  expected: ClaimValidationExpected; body: string; phase: "sending" | "unknown";
  everUnknown: boolean; attempt: symbol;
}>;
type Confirmed = Readonly<{ identity: string; batchId: string }>;
type Journal = Readonly<{ operation: ClaimValidationOperation | null; confirmed: readonly Confirmed[]; navigationBlocked: boolean }>;
const EMPTY: Journal = { operation: null, confirmed: [], navigationBlocked: false };
let journal: Journal = EMPTY;
let release: (() => void) | null = null;
let removeGuards: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getClaimValidationPending = () => journal;
export function useClaimValidationPending() { return useSyncExternalStore(subscribe, getClaimValidationPending, () => EMPTY); }

function installGuards() {
  if (removeGuards || typeof window === "undefined") return;
  removeGuards = installPendingNavigationGuard({
    hasPendingOperation: () => journal.operation !== null,
    permittedFormAttribute: "data-claim-validation-form",
    onBlocked: () => { journal = { ...journal, navigationBlocked: true }; emit(); },
  });
}
function unlock() { release?.(); release = null; removeGuards?.(); removeGuards = null; }

/** One tab-local financial operation, at most 32 confirmation markers. Never
 * persist bodies, actor IDs, money or operation keys in browser storage/history. */
export function beginClaimValidation(scope: ClaimValidationScope, demo: boolean, batch: ClaimValidationBatch): ClaimValidationOperation | null {
  if (journal.operation || journal.confirmed.length >= 32 || hasPendingOperations()) return null;
  const identity = claimValidationScopeIdentity(scope, demo);
  const normalizedScope = scopeSchema.parse(scope); const normalizedBatch = batchSchema.parse(batch);
  if (journal.confirmed.some((entry) => entry.identity === identity && entry.batchId === normalizedBatch.id)) return null;
  const lease = tryAcquirePendingOperation(); if (!lease) return null;
  const token = Symbol();
  try {
    const expected = Object.freeze({ claimBatchId: normalizedBatch.id, itemCount: normalizedBatch.itemCount,
      totalAmount: normalizedBatch.totalAmount, demo, idempotencyKey: uuid.parse(crypto.randomUUID()) });
    const operation: ClaimValidationOperation = Object.freeze({ token, identity,
      scope: Object.freeze(normalizedScope), batch: Object.freeze(normalizedBatch), expected,
      body: JSON.stringify({ claim_batch_id: expected.claimBatchId, expected_total_amount: expected.totalAmount,
        expected_item_count: expected.itemCount }), phase: "sending", everUnknown: false, attempt: Symbol() });
    release = lease; journal = { ...journal, operation, navigationBlocked: false }; installGuards(); emit(); return operation;
  } catch (error) {
    // An installation/notification exception must not leave an orphan lease.
    // Reentrant listeners may have created another operation: never clear it.
    if (journal.operation?.token === token) journal = { ...journal, operation: null, navigationBlocked: false };
    if (release === lease) unlock(); else lease();
    throw error;
  }
}
export function retryClaimValidation(token: symbol): ClaimValidationOperation | null {
  const operation = journal.operation;
  if (!operation || operation.token !== token || operation.phase !== "unknown") return null;
  const next = Object.freeze({ ...operation, phase: "sending" as const, attempt: Symbol() });
  journal = { ...journal, operation: next }; emit(); return next;
}
export function settleClaimValidation(operation: ClaimValidationOperation, result: "success" | "denied" | "unknown") {
  const current = journal.operation;
  if (!current || current.token !== operation.token || current.attempt !== operation.attempt) return false;
  if (result === "unknown" || result === "denied" && current.everUnknown) {
    journal = { ...journal, operation: Object.freeze({ ...current, phase: "unknown", everUnknown: true }) }; emit(); return true;
  }
  journal = { operation: null, navigationBlocked: false, confirmed: result === "success" && !current.expected.demo
    ? [...journal.confirmed, { identity: current.identity, batchId: current.batch.id }] : journal.confirmed };
  unlock(); emit(); return true;
}
/** Only fresh server props that no longer offer the batch as draft remove its
 * marker. Scheduling router.refresh() is not authoritative read completion. */
export function reconcileClaimValidationConfirmed(scope: ClaimValidationScope, demo: boolean, draftIds: readonly string[]) {
  const identity = claimValidationScopeIdentity(scope, demo); const ids = new Set(draftIds.map((value) => value.toLowerCase()));
  const confirmed = journal.confirmed.filter((entry) => entry.identity !== identity || ids.has(entry.batchId));
  if (confirmed.length !== journal.confirmed.length) { journal = { ...journal, confirmed }; emit(); }
}
/** Explicit safe logout invalidates callbacks before the asynchronous logout.
 * Never call this for ordinary unmount, view refresh, scope change or denial. */
export function clearClaimValidationPendingOnLogout() { journal = EMPTY; unlock(); emit(); }
