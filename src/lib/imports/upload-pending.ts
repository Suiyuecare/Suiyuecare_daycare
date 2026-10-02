"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquirePendingRecoveryRead } from "@/lib/navigation/pending-operation-lock";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";
import type { CmsUploadResult } from "./upload-client";

export type CmsUploadMode = "routine-intake" | "general";
export type CmsUploadScope = Readonly<{ authority: string; organizationId: string; branchId: string; actorUserId: string;
  mode: CmsUploadMode; clientId: string | null }>;
export type CmsUploadFile = Readonly<{ name: string; size: number; mime: string; sha256: string }>;
export type CmsUploadOperation = Readonly<{ token: symbol; attempt: symbol; epoch: number; scope: CmsUploadScope;
  key: string; originalId: string; file: CmsUploadFile; phase: "sending" | "unknown" | "staged";
  reservationId: string | null; batchId: string | null; recoveryKey: string | null; result: CmsUploadResult | null }>;
type State = Readonly<{ authority: string | null; epoch: number; operation: CmsUploadOperation | null; navigationBlocked: boolean }>;
const EMPTY: State = Object.freeze({ authority: null, epoch: 0, operation: null, navigationBlocked: false });
let state = EMPTY, loggedOut = false, deniedAuthority: string | null = null;
let lease: (() => void) | null = null, guard: (() => void) | null = null;
let activeRead: { abort: AbortController; release: () => void } | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const uuid = z.string().uuid();
const tuple = z.tuple([uuid, uuid, uuid, z.array(z.string()), z.array(z.string()), z.enum(["aal1", "aal2"]), z.string().nullable(), z.boolean()]);

export function cmsUploadAuthority(context: TenantContext) {
  return JSON.stringify([context.organizationId, context.branchId, context.userId, [...context.roles].sort(),
    [...context.scopes].sort(), context.assuranceLevel, context.recentAal2At, context.demo]);
}
export function cmsUploadScope(context: TenantContext, mode: CmsUploadMode, clientId: string | null): CmsUploadScope {
  return Object.freeze({ authority: cmsUploadAuthority(context), organizationId: context.organizationId,
    branchId: context.branchId, actorUserId: context.userId, mode, clientId });
}
export function canUseCmsUpload(scope: CmsUploadScope): boolean {
  try {
    const auth = tuple.parse(JSON.parse(scope.authority));
    return ["routine-intake", "general"].includes(scope.mode) && !loggedOut && deniedAuthority !== scope.authority && state.authority === scope.authority && !auth[7] && auth[0] === scope.organizationId &&
      auth[1] === scope.branchId && auth[2] === scope.actorUserId && auth[4].includes("imports.manage") &&
      (scope.clientId === null || uuid.safeParse(scope.clientId).success) &&
      (scope.mode === "general" ? auth[5] === "aal2" && scope.clientId === null :
        ["clients.read", "clients.demographics.read", "clients.manage", "clients.view_all"].every(key => auth[4].includes(key)));
  } catch { return false; }
}
const identity = (scope: CmsUploadScope) => JSON.stringify([scope.organizationId, scope.branchId, scope.actorUserId, scope.mode, scope.clientId]);
export function observeCmsUploadAuthority(authority: string | null) {
  if (loggedOut) return;
  let valid: string | null = null;
  try { if (authority && authority.length <= 30_000) { tuple.parse(JSON.parse(authority)); valid = authority; } } catch { /* Hide stale/untrusted content. */ }
  if (valid !== null && valid === deniedAuthority || valid === state.authority) return;
  cancelRead();
  state = Object.freeze({ ...state, authority: valid, epoch: state.epoch + 1,
    operation: state.operation ? Object.freeze({ ...state.operation, phase: "unknown", attempt: Symbol() }) : null });
  emit();
}
/** A denied/untrusted read must not resurrect old server props. There is no
 * fresh-context endpoint in this slice; safe logout/full login is the recovery. */
export function quarantineCmsUploadAuthority(scope: CmsUploadScope) {
  if (state.authority !== scope.authority) return;
  deniedAuthority = scope.authority; observeCmsUploadAuthority(null);
}
export function useCmsUploadState() { return useSyncExternalStore(subscribe, () => state, () => EMPTY); }
export function getCmsUploadState() { return state; }
export function getCmsUploadOperation(scope: CmsUploadScope): CmsUploadOperation | null {
  return canUseCmsUpload(scope) && state.operation && identity(state.operation.scope) === identity(scope) ? state.operation : null;
}
export function hasCmsUploadOperation() { return state.operation !== null; }
export function isCurrentCmsUpload(operation: CmsUploadOperation, scope: CmsUploadScope) {
  return getCmsUploadOperation(scope) === operation && operation.epoch === state.epoch && operation.scope.authority === scope.authority;
}
function unlock() { const oldGuard = guard, oldLease = lease; guard = null; lease = null; try { oldGuard?.(); } finally { oldLease?.(); } }
function cancelRead() { const read = activeRead; activeRead = null; read?.abort.abort(); read?.release(); }
export function beginCmsUpload(scope: CmsUploadScope, file: CmsUploadFile, key: string, originalId: string) {
  if (!canUseCmsUpload(scope) || state.operation || hasPendingOperations() || hasViewTransition() ||
      !uuid.safeParse(key).success || !uuid.safeParse(originalId).success || !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      !Number.isSafeInteger(file.size) || file.size < 1 || file.size > (scope.mode === "general" ? 25 : 4) * 1024 * 1024 ||
      !/\.html?$/iu.test(file.name) || file.name.length > 255 || /[\\/\u0000-\u001f\u007f]/u.test(file.name) ||
      !["text/html", "application/xhtml+xml"].includes(file.mime)) return null;
  const checkpoint = state;
  const held = tryAcquirePendingOperation(); if (!held) return null;
  // Acquiring the shared lease synchronously notifies other owners. They may
  // log out or revoke this authority before acquire returns; never reinstall
  // an original upload after that privacy boundary.
  if (state !== checkpoint || !canUseCmsUpload(scope)) { held(); return null; }
  const operation: CmsUploadOperation = Object.freeze({ token: Symbol(), attempt: Symbol(), epoch: state.epoch,
    scope: Object.freeze({ ...scope }), file: Object.freeze({ ...file }), key, originalId, phase: "sending",
    reservationId: null, batchId: null, recoveryKey: null, result: null });
  lease = held; state = Object.freeze({ ...state, operation, navigationBlocked: false });
  try {
    guard = installPendingNavigationGuard({ hasPendingOperation: hasCmsUploadOperation, permittedFormAttribute: "data-cms-upload",
      onBlocked: () => { state = Object.freeze({ ...state, navigationBlocked: true }); emit(); } });
  } catch (error) { state = Object.freeze({ ...state, operation: null }); unlock(); throw error; }
  emit(); return isCurrentCmsUpload(operation, scope) ? operation : null;
}
/** A new attempt retains the original key/bytes, including across remounts and
 * fresh authorization. The server's explicit recovery path decides authority. */
export function retryCmsUpload(scope: CmsUploadScope, token: symbol, recoveryKey?: string) {
  const operation = getCmsUploadOperation(scope);
  if (!operation || operation.token !== token || operation.phase === "sending" || hasViewTransition() ||
      recoveryKey !== undefined && (!uuid.safeParse(recoveryKey).success || recoveryKey === operation.key)) return null;
  const next = Object.freeze({ ...operation, scope: Object.freeze({ ...scope }), epoch: state.epoch, attempt: Symbol(),
    phase: "sending" as const, recoveryKey: recoveryKey ?? operation.recoveryKey });
  state = Object.freeze({ ...state, operation: next }); emit(); return next;
}
export function markCmsUploadUnknown(operation: CmsUploadOperation, scope: CmsUploadScope) {
  if (!isCurrentCmsUpload(operation, scope)) return;
  state = Object.freeze({ ...state, operation: Object.freeze({ ...operation, phase: "unknown", attempt: Symbol() }) }); emit();
}
export function markCmsUploadStaged(operation: CmsUploadOperation, scope: CmsUploadScope, result: CmsUploadResult) {
  const { reservationId, batchId } = result;
  if (!isCurrentCmsUpload(operation, scope) || reservationId !== null && !uuid.safeParse(reservationId).success ||
      batchId !== null && !uuid.safeParse(batchId).success) return null;
  const next = Object.freeze({ ...operation, phase: "staged" as const, reservationId, batchId, result: Object.freeze({ ...result }) });
  state = Object.freeze({ ...state, operation: next }); emit(); return next;
}
export function locateCmsUpload(operation: CmsUploadOperation, scope: CmsUploadScope, reservationId: string) {
  if (getCmsUploadOperation(scope) !== operation || !uuid.safeParse(reservationId).success) return null;
  const next = Object.freeze({ ...operation, scope: Object.freeze({ ...scope }), epoch: state.epoch, reservationId });
  state = Object.freeze({ ...state, operation: next }); emit(); return next;
}
/** Only a correlated source preview ends this upload guard; neither an empty
 * locator response nor a thin completion receipt means formal intake. */
export function finishCmsUpload(operation: CmsUploadOperation, scope: CmsUploadScope) {
  if (!isCurrentCmsUpload(operation, scope) || operation.phase !== "staged") return false;
  state = Object.freeze({ ...state, operation: null, navigationBlocked: false }); unlock(); emit(); return true;
}
export function beginCmsUploadRead(scope: CmsUploadScope, token: symbol) {
  const operation = getCmsUploadOperation(scope);
  if (!operation || operation.token !== token || operation.phase === "sending" || activeRead || !lease) return null;
  const release = tryAcquirePendingRecoveryRead(lease); if (!release) return null;
  const read = { abort: new AbortController(), release }; activeRead = read;
  const epoch = state.epoch;
  return { operation, signal: read.abort.signal, current: () => activeRead === read && !read.abort.signal.aborted &&
    epoch === state.epoch && getCmsUploadOperation(scope) === operation,
    close: () => { if (activeRead === read) activeRead = null; read.abort.abort(); release(); } };
}
export function clearCmsUploadOnLogout() {
  loggedOut = true; cancelRead(); state = Object.freeze({ ...EMPTY, epoch: state.epoch + 1 }); unlock(); emit();
}
