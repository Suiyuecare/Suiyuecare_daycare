"use client";

import { useSyncExternalStore } from "react";
import { tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import type { EvaluationPreparationOperation } from "./evaluation-preparation-request";

type HeldOperation = { operation: EvaluationPreparationOperation; phase: "busy" | "unknown" };

// The frozen request and UUID key live only in this tab's JavaScript memory.
// A generic tab-local marker blocks fresh writes after a full reload loses them.
const unresolvedMarker = "evaluation-preparation-unresolved-v1";
let held: HeldOperation | null = null;
let releaseHeld: (() => void) | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = () => { for (const listener of [...listeners]) listener(); };
export const getHeldEvaluationPreparationOperation = () => held;
export function useHeldEvaluationPreparationOperation() {
  return useSyncExternalStore(subscribe, getHeldEvaluationPreparationOperation, () => null);
}
export function hasLostEvaluationPreparationOperation() {
  if (typeof window === "undefined") return false;
  try { return window.sessionStorage.getItem(unresolvedMarker) === "1" && held === null; }
  catch { return true; }
}
export function useLostEvaluationPreparationOperation() {
  return useSyncExternalStore(subscribe, hasLostEvaluationPreparationOperation, () => false);
}

export function beginEvaluationPreparationOperation(create: () => EvaluationPreparationOperation) {
  if (held || hasLostEvaluationPreparationOperation()) return null;
  const release = tryAcquirePendingOperation();
  if (!release) return null;
  try { window.sessionStorage.setItem(unresolvedMarker, "1"); }
  catch { release(); return null; }
  let operation: EvaluationPreparationOperation;
  try { operation = create(); }
  catch {
    try { window.sessionStorage.removeItem(unresolvedMarker); } catch { /* Fail closed. */ }
    release(); return null;
  }
  releaseHeld = release;
  held = { operation, phase: "busy" }; publish();
  return operation;
}
export function retryEvaluationPreparationOperation(operation: EvaluationPreparationOperation) {
  if (held?.operation !== operation || held.phase !== "unknown") return false;
  held = { ...held, phase: "busy" }; publish();
  return true;
}
export function markEvaluationPreparationUnknown(operation: EvaluationPreparationOperation) {
  if (held?.operation !== operation) return;
  held = { ...held, phase: "unknown" }; publish();
}
/** Only a correlated receipt or a first-attempt confirmed non-commit settles the lease. */
export function settleEvaluationPreparationOperation(operation: EvaluationPreparationOperation) {
  if (held?.operation !== operation) return;
  const release = releaseHeld;
  releaseHeld = null;
  try { window.sessionStorage.removeItem(unresolvedMarker); }
  catch { /* Keep the persisted warning if browser storage cannot be cleared. */ }
  held = null; release?.(); publish();
}
