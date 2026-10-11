"use client";

import { useSyncExternalStore } from "react";
import { tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import type { z } from "zod";
import type { qualityFreezeRequestSchema } from "@/lib/quality-monthly/contract";

export type QualityOperation = Readonly<{
  input: z.infer<typeof qualityFreezeRequestSchema>; organizationId: string; branchId: string; actorUserId: string;
}>;
type Held = { operation: QualityOperation; phase: "busy" | "unknown" };
const marker = "quality-monthly-unresolved-v1";
let held: Held | null = null;
let release: (() => void) | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = () => { for (const listener of [...listeners]) listener(); };
export const getHeldQualityOperation = () => held;
export function useHeldQualityOperation() { return useSyncExternalStore(subscribe, getHeldQualityOperation, () => null); }
export function hasLostQualityOperation() {
  if (typeof window === "undefined") return false;
  try { return sessionStorage.getItem(marker) === "1" && held === null; } catch { return true; }
}
export function useLostQualityOperation() { return useSyncExternalStore(subscribe, hasLostQualityOperation, () => false); }
export function beginQualityOperation(input: QualityOperation) {
  if (held || hasLostQualityOperation()) return null;
  const acquired = tryAcquirePendingOperation(); if (!acquired) return null;
  try { sessionStorage.setItem(marker, "1"); } catch { acquired(); return null; }
  const operation = Object.freeze({ ...input, input: Object.freeze({ ...input.input }) });
  release = acquired; held = { operation, phase: "busy" }; publish(); return operation;
}
export function retryQualityOperation(operation: QualityOperation) {
  if (held?.operation !== operation || held.phase !== "unknown") return false;
  held = { operation, phase: "busy" }; publish(); return true;
}
export function markQualityOperationUnknown(operation: QualityOperation) {
  if (held?.operation !== operation) return;
  held = { operation, phase: "unknown" }; publish();
}
/** The body/key live only in tab memory. Unmount does not imply a failed write. */
export function settleQualityOperation(operation: QualityOperation) {
  if (held?.operation !== operation) return;
  try { sessionStorage.removeItem(marker); } catch { /* Keep the reload warning if clearing fails. */ }
  held = null; const acquired = release; release = null; acquired?.(); publish();
}
