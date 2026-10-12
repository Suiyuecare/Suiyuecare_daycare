"use client";

import { useSyncExternalStore } from "react";
import { tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import type { EvaluationEvidenceAction } from "@/lib/evaluation-preparation/contract";

export type EvidenceOperation = Readonly<{
  input: EvaluationEvidenceAction; organizationId: string; branchId: string; actorUserId: string;
}>;
type Held = { operation: EvidenceOperation; phase: "busy" | "unknown" };
const marker = "evaluation-evidence-unresolved-v1";
let held: Held | null = null;
let release: (() => void) | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = () => { for (const listener of [...listeners]) listener(); };
export const getHeldEvidenceOperation = () => held;
export function useHeldEvidenceOperation() { return useSyncExternalStore(subscribe, getHeldEvidenceOperation, () => null); }
export function hasLostEvidenceOperation() {
  if (typeof window === "undefined") return false;
  try { return sessionStorage.getItem(marker) === "1" && held === null; } catch { return true; }
}
export function useLostEvidenceOperation() { return useSyncExternalStore(subscribe, hasLostEvidenceOperation, () => false); }
export function evidenceSnapshotCurrent(staleAfter: string) { return Date.now() < Date.parse(staleAfter); }
export function beginEvidenceOperation(input: EvidenceOperation) {
  if (held || hasLostEvidenceOperation()) return null;
  const acquired = tryAcquirePendingOperation(); if (!acquired) return null;
  try { sessionStorage.setItem(marker, "1"); } catch { acquired(); return null; }
  const operation = Object.freeze({ ...input, input: Object.freeze({ ...input.input }) });
  release = acquired; held = { operation, phase: "busy" }; publish(); return operation;
}
export function retryEvidenceOperation(operation: EvidenceOperation) {
  if (held?.operation !== operation || held.phase !== "unknown") return false;
  held = { operation, phase: "busy" }; publish(); return true;
}
export function markEvidenceOperationUnknown(operation: EvidenceOperation) {
  if (held?.operation !== operation) return;
  held = { operation, phase: "unknown" }; publish();
}
/** Unmount/navigation never settles. Only matching success or known first refusal does. */
export function settleEvidenceOperation(operation: EvidenceOperation) {
  if (held?.operation !== operation) return;
  try { sessionStorage.removeItem(marker); } catch { /* Retain reload warning if clearing fails. */ }
  held = null; const acquired = release; release = null; acquired?.(); publish();
}
