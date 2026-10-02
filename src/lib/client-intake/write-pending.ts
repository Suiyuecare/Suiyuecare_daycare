"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { cmsUploadAuthority } from "@/lib/imports/upload-pending";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";
import { cmsCommitSchema, intakeReceiptSchema, intakeSnapshotSchema, profileMutationSchema, type IntakeSnapshot } from "./model";

export type IntakeWriteKind = "profile" | "cms";
export type IntakeWriteOperation = Readonly<{ token: symbol; attempt: symbol; authority: string; epoch: number;
  kind: IntakeWriteKind; clientId: string | null; body: string; key: string; phase: "sending" | "unknown" | "saved";
  everUnknown: boolean; receipt: z.infer<typeof intakeReceiptSchema> | null }>;
type State = Readonly<{ authority: string | null; epoch: number; operation: IntakeWriteOperation | null; navigationBlocked: boolean }>;
const EMPTY: State = Object.freeze({ authority: null, epoch: 0, operation: null, navigationBlocked: false });
let state = EMPTY, loggedOut = false;
let lease: (() => void) | null = null, guard: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const authoritySchema = z.tuple([z.uuid(), z.uuid(), z.uuid(), z.array(z.string()), z.array(z.string()), z.enum(["aal1", "aal2"]), z.string().nullable(), z.boolean()]);
export const intakeWriteAuthority = cmsUploadAuthority;
export function observeIntakeWriteAuthority(signature: string | null) {
  if (loggedOut) return;
  let valid: string | null = null;
  try { if (signature && signature.length <= 30000) { authoritySchema.parse(JSON.parse(signature)); valid = signature; } } catch { /* Hide malformed authority. */ }
  if (valid === state.authority) return;
  state = Object.freeze({ ...state, authority: valid, epoch: state.epoch + 1,
    operation: state.operation ? Object.freeze({ ...state.operation, phase: state.operation.phase === "saved" ? "saved" : "unknown",
      everUnknown: true, attempt: Symbol() }) : null });
  emit();
}
export function useIntakeWriteState() { return useSyncExternalStore(subscribe, () => state, () => EMPTY); }
export const getIntakeWriteState = () => state;
export const hasIntakeWriteOperation = () => state.operation !== null;
export function isIntakeWriteAuthorityCurrent(context: TenantContext) {
  return !loggedOut && state.authority === intakeWriteAuthority(context);
}
export function getIntakeWriteOperation(context: TenantContext, kind: IntakeWriteKind, clientId: string | null) {
  const operation = state.operation;
  return isIntakeWriteAuthorityCurrent(context) && operation?.authority === state.authority && operation.epoch === state.epoch &&
    operation.kind === kind && operation.clientId === clientId ? operation : null;
}
function allowed(context: TenantContext, kind: IntakeWriteKind, clientId: string | null) {
  return !context.demo && isIntakeWriteAuthorityCurrent(context) && Boolean(context.branchId) &&
    ["clients.read", "clients.manage", "clients.demographics.read"].every(scope => context.scopes.includes(scope)) &&
    (clientId !== null || context.scopes.includes("clients.view_all")) &&
    (kind !== "cms" || ["imports.manage", "imports.approve"].every(scope => context.scopes.includes(scope)));
}
export function isCurrentIntakeWrite(operation: IntakeWriteOperation) {
  return !loggedOut && state.operation === operation && operation.authority === state.authority && operation.epoch === state.epoch;
}
function unlock() { const previousGuard = guard, previousLease = lease; guard = null; lease = null; previousGuard?.(); previousLease?.(); }

/** Memory-only original intent. Full document reload cannot recover this journal. */
export function beginIntakeWrite(context: TenantContext, kind: IntakeWriteKind, clientId: string | null, value: unknown) {
  if (!allowed(context, kind, clientId) || state.operation || hasPendingOperations() || hasViewTransition()) return null;
  const input = kind === "profile" ? profileMutationSchema.parse(value) : cmsCommitSchema.parse(value);
  if (("clientId" in input ? input.clientId : null) !== clientId) return null;
  const body = JSON.stringify(input);
  if (new TextEncoder().encode(body).byteLength > 64 * 1024) return null;
  const checkpoint = state;
  const held = tryAcquirePendingOperation(); if (!held) return null;
  // Lease listeners may synchronously revoke authority or perform safe logout.
  if (state !== checkpoint || !allowed(context, kind, clientId) || state.operation || hasViewTransition()) { held(); return null; }
  const operation: IntakeWriteOperation = Object.freeze({ token: Symbol(), attempt: Symbol(), authority: state.authority!, epoch: state.epoch,
    kind, clientId, body, key: input.idempotency_key, phase: "sending", everUnknown: false, receipt: null });
  try {
    lease = held; state = Object.freeze({ ...state, operation, navigationBlocked: false });
    guard = installPendingNavigationGuard({ hasPendingOperation: hasIntakeWriteOperation, permittedFormAttribute: "data-intake-write",
      onBlocked: () => { state = Object.freeze({ ...state, navigationBlocked: true }); emit(); } });
    emit(); return isCurrentIntakeWrite(operation) ? operation : null;
  } catch (error) { state = Object.freeze({ ...state, operation: null }); unlock(); throw error; }
}
export function retryIntakeWrite(operation: IntakeWriteOperation, context: TenantContext) {
  if (!isCurrentIntakeWrite(operation) || operation.phase !== "unknown" || !allowed(context, operation.kind, operation.clientId) || hasViewTransition()) return null;
  const next = Object.freeze({ ...operation, phase: "sending" as const, attempt: Symbol() });
  state = Object.freeze({ ...state, operation: next }); emit(); return next;
}
export function markIntakeWriteUnknown(operation: IntakeWriteOperation) {
  if (!isCurrentIntakeWrite(operation) || operation.phase === "saved") return false;
  state = Object.freeze({ ...state, operation: Object.freeze({ ...operation, phase: "unknown", everUnknown: true, attempt: Symbol() }) });
  emit(); return true;
}
export function rejectIntakeWrite(operation: IntakeWriteOperation) {
  if (!isCurrentIntakeWrite(operation)) return false;
  if (operation.everUnknown) return markIntakeWriteUnknown(operation);
  state = Object.freeze({ ...state, operation: null, navigationBlocked: false }); unlock(); emit(); return true;
}
export function saveIntakeWriteReceipt(operation: IntakeWriteOperation, value: unknown) {
  if (!isCurrentIntakeWrite(operation)) return null;
  const input = JSON.parse(operation.body) as { clientId?: string | null; expectedVersion?: number; expectedClientVersion?: number; batchId?: string };
  const schema = operation.kind === "cms" ? intakeReceiptSchema.extend({ persisted: z.literal(true), formallyImported: z.literal(true), batchId: z.uuid() })
    : intakeReceiptSchema.extend({ persisted: z.literal(true) });
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data.operationId !== operation.key ||
    (operation.clientId !== null && parsed.data.clientId !== operation.clientId) ||
    parsed.data.profileVersion !== (input.expectedVersion ?? 0) + 1 || parsed.data.clientRowVersion !== (input.expectedClientVersion ?? 0) + 1 ||
    operation.clientId === null && !parsed.data.pending || operation.kind === "cms" && parsed.data.batchId !== input.batchId) {
    throw new Error("INTAKE_RECEIPT_UNCERTAIN");
  }
  const next = Object.freeze({ ...operation, phase: "saved" as const, receipt: Object.freeze(parsed.data), attempt: Symbol() });
  state = Object.freeze({ ...state, operation: next }); emit(); return next;
}
export function matchesIntakeWriteReadback(operation: IntakeWriteOperation, value: IntakeSnapshot | void) {
  if (!isCurrentIntakeWrite(operation) || operation.phase !== "saved" || !operation.receipt) return false;
  const parsed = intakeSnapshotSchema.safeParse(value);
  const input = JSON.parse(operation.body) as { profile?: unknown; batchId?: string };
  // A later version or a refreshed page is not evidence of this original content.
  if (!parsed.success || parsed.data.clientId !== operation.receipt.clientId || parsed.data.profileVersion !== operation.receipt.profileVersion ||
    parsed.data.clientRowVersion !== operation.receipt.clientRowVersion || parsed.data.pending !== operation.receipt.pending ||
    (operation.kind === "profile" ? JSON.stringify(parsed.data.profile) !== JSON.stringify(input.profile) : parsed.data.sourceBatchId !== input.batchId)) return false;
  return true;
}
export function confirmIntakeWriteReadback(operation: IntakeWriteOperation, value: IntakeSnapshot | void) {
  if (!matchesIntakeWriteReadback(operation, value)) return false;
  state = Object.freeze({ ...state, operation: null, navigationBlocked: false }); unlock(); emit(); return true;
}
export function clearIntakeWritesOnLogout() {
  loggedOut = true;
  state = Object.freeze({ ...EMPTY, epoch: state.epoch + 1 }); unlock(); emit();
}
