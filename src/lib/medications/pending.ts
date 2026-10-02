"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { parseMedicationActionError, parseMedicationActionSuccess, type MedicationActionExpectation } from "./action-response";
import type { MedicationOutcome } from "@/lib/integrations/medications";

export type MedicationScope = Readonly<{ organizationId: string; branchId: string; userId: string }>;
export type MedicationDraft = Readonly<{ status: MedicationOutcome; occurredAt: string; reason: string }>;
export type MedicationOperation = Readonly<{
  token: symbol; attempt: symbol; scope: MedicationScope; identity: string;
  key: string; body: string; expectation: Readonly<MedicationActionExpectation>;
  draft: MedicationDraft; source: string; authority: string; epoch: number;
  phase: "sending" | "unknown"; everUnknown: boolean; quarantined: boolean;
}>;
export type MedicationSuccess = ReturnType<typeof parseMedicationActionSuccess>;
type Saved = Readonly<{ identity: string; rowId: string; source: string; receipt: MedicationSuccess }>;
type Journal = Readonly<{ operation: MedicationOperation | null; saved: readonly Saved[];
  authority: string | null; epoch: number; navigationBlocked: boolean }>;
let journal: Journal = { operation: null, saved: [], authority: null, epoch: 0, navigationBlocked: false };
// Auth context has no fresh-session nonce here. After logout only a new
// document/module lifetime can establish authority; stale SSR props cannot.
let loggedOut = false;
let release: (() => void) | null = null;
let removeGuard: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
const scopeSchema = z.object({ organizationId: z.uuid(), branchId: z.uuid(), userId: z.uuid() }).strict();
const signatureSchema = z.tuple([z.string(), z.string(), z.string(), z.boolean(), z.array(z.string()),
  z.array(z.string()), z.enum(["aal1", "aal2"]), z.string().nullable()]);
const identity = (scope: MedicationScope) => JSON.stringify(Object.values(scopeSchema.parse(scope)).map(value => value.toLowerCase()));
const authorityIdentity = () => journal.authority ? JSON.stringify(signatureSchema.parse(JSON.parse(journal.authority)).slice(0, 3)) : null;
export const getMedicationPending = () => journal;
const serverJournal: Journal = { operation: null, saved: [], authority: null, epoch: 0, navigationBlocked: false };
export function useMedicationPending() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getMedicationPending, () => serverJournal);
}
export function medicationAuthoritySignature(context: TenantContext) {
  return JSON.stringify([context.organizationId.toLowerCase(), context.branchId.toLowerCase(), context.userId.toLowerCase(),
    context.demo, [...context.roles].sort(), [...context.scopes].sort(), context.assuranceLevel, context.recentAal2At]);
}
/** Observed by AppShell even while this workflow is unmounted. Returning to
 * old props after authority ABA never revives a submitted clinical intent. */
export function observeMedicationAuthority(signature: string) {
  if (loggedOut) return;
  let valid: string | null = null;
  try {
    if (signature.length > 20_000) throw new Error();
    const parsed = signatureSchema.parse(JSON.parse(signature));
    if (!parsed[3]) scopeSchema.parse({ organizationId: parsed[0], branchId: parsed[1], userId: parsed[2] });
    valid = signature;
  } catch { /* Invalid authority hides this workflow without breaking the shell. */ }
  if (valid === journal.authority) return;
  journal = { ...journal, authority: valid, epoch: journal.epoch + 1,
    operation: journal.operation ? Object.freeze({ ...journal.operation, attempt: Symbol(), phase: "unknown", everUnknown: true, quarantined: true }) : null };
  emit();
}
function allowed(scope: MedicationScope, kind: MedicationActionExpectation["kind"]) {
  if (loggedOut || authorityIdentity() !== identity(scope) || !journal.authority) return false;
  const authority = signatureSchema.parse(JSON.parse(journal.authority));
  return !authority[3] && authority[6] === "aal2" &&
    authority[5].includes(kind === "record" ? "medications.administer" : "medications.verify");
}
export function medicationAuthorityMatches(scope: MedicationScope) {
  try { return !loggedOut && authorityIdentity() === identity(scope); } catch { return false; }
}
export function observeMedicationTarget(scope: MedicationScope, rowId: string, source: string, enabled: boolean) {
  const operation = journal.operation;
  if (!operation || !scopeSchema.safeParse(scope).success || operation.identity !== identity(scope) || operation.expectation.medicationAdministrationId !== rowId || operation.quarantined) return;
  if (operation.source !== source || !enabled) {
    journal = { ...journal, operation: Object.freeze({ ...operation, attempt: Symbol(), phase: "unknown", everUnknown: true, quarantined: true }) };
    emit();
  }
}
export function beginMedicationOperation(scope: MedicationScope, body: string, expectation: MedicationActionExpectation,
  draft: MedicationDraft, source: string): MedicationOperation | null {
  if (!allowed(scope, expectation.kind) || journal.operation || journal.saved.length >= 32 || hasPendingOperations() || hasViewTransition() ||
      journal.saved.some(entry => entry.identity === identity(scope) && entry.rowId === expectation.medicationAdministrationId)) return null;
  const checkpoint = journal;
  const lease = tryAcquirePendingOperation();
  if (!lease) return null;
  // Lease notification can synchronously revoke authority or log out.
  if (journal !== checkpoint || !allowed(scope, expectation.kind)) { lease(); return null; }
  const operation: MedicationOperation = Object.freeze({ token: Symbol(), attempt: Symbol(), scope: Object.freeze({ ...scope }),
    identity: identity(scope), key: crypto.randomUUID(), body, expectation: Object.freeze({ ...expectation }), draft: Object.freeze({ ...draft }),
    source, authority: journal.authority!, epoch: journal.epoch, phase: "sending", everUnknown: false, quarantined: false });
  release = lease; journal = { ...journal, operation, navigationBlocked: false };
  try {
    removeGuard = installPendingNavigationGuard({ hasPendingOperation: () => journal.operation !== null,
      permittedFormAttribute: "data-medication-action-form", onBlocked: () => { journal = { ...journal, navigationBlocked: true }; emit(); } });
  } catch (error) { journal = { ...journal, operation: null }; unlock(); throw error; }
  emit(); return journal.operation === operation ? operation : null;
}
export function retryMedicationOperation(operation: MedicationOperation, scope: MedicationScope, source: string) {
  if (journal.operation !== operation || operation.phase !== "unknown" || operation.quarantined || operation.source !== source ||
      operation.epoch !== journal.epoch || operation.authority !== journal.authority || operation.identity !== identity(scope) ||
      !allowed(scope, operation.expectation.kind) || hasViewTransition()) return null;
  const retry = Object.freeze({ ...operation, attempt: Symbol(), phase: "sending" as const });
  journal = { ...journal, operation: retry }; emit(); return journal.operation === retry ? retry : null;
}
export function isMedicationOperationCurrent(operation: MedicationOperation) {
  return journal.operation === operation && operation.epoch === journal.epoch && operation.authority === journal.authority &&
    operation.identity === authorityIdentity() && !operation.quarantined;
}
function unlock() { const ownRelease = release; release = null; removeGuard?.(); removeGuard = null; ownRelease?.(); }
export function markMedicationUnknown(operation: MedicationOperation) {
  if (!isMedicationOperationCurrent(operation)) return false;
  journal = { ...journal, operation: Object.freeze({ ...operation, attempt: Symbol(), phase: "unknown", everUnknown: true }) };
  emit(); return true;
}
/** Only a structured first rejection known to precede/non-commit the RPC can
 * release the intent. RESULT_INVALID describes a possible committed write. */
export function rejectMedicationOperation(operation: MedicationOperation, value: unknown, httpStatus: number) {
  if (!isMedicationOperationCurrent(operation)) return false;
  const envelope = parseMedicationActionError(value);
  const codes = new Set(["MEDICATION_NOT_AUTHORIZED", "MEDICATION_VERIFICATION_NOT_AUTHORIZED", "AAL2_REQUIRED", "DEMO_READ_ONLY",
    "INVALID_MEDICATION_ADMINISTRATION", "INVALID_MEDICATION_VERIFICATION", "INVALID_MEDICATION_DOSE", "MEDICATION_STATE_CONFLICT",
    "MEDICATION_VERIFICATION_STATE_CONFLICT", "MEDICATION_IDEMPOTENCY_CONFLICT", "MEDICATION_VERIFICATION_IDEMPOTENCY_CONFLICT"]);
  if (operation.everUnknown || !envelope || ![400, 401, 403, 409].includes(httpStatus) || !envelope.errors.every(error => codes.has(error.code))) {
    markMedicationUnknown(operation); return false;
  }
  journal = { ...journal, operation: null, navigationBlocked: false }; unlock(); emit(); return true;
}
export function confirmMedicationOperation(operation: MedicationOperation, value: unknown, status: number) {
  if (!isMedicationOperationCurrent(operation)) return null;
  let receipt: MedicationSuccess;
  try { receipt = parseMedicationActionSuccess(value, operation.expectation, status); }
  catch { markMedicationUnknown(operation); return null; }
  journal = { ...journal, operation: null, navigationBlocked: false, saved: [...journal.saved, Object.freeze({ identity: operation.identity,
    rowId: operation.expectation.medicationAdministrationId, source: operation.source, receipt })] };
  unlock(); emit(); return receipt;
}
/** Saved receipt guards intentionally survive remount. Only a correlated
 * server read of the result may replace this guard; refresh itself is no proof. */
export function clearMedicationPendingOnLogout() {
  loggedOut = true;
  journal = { operation: null, saved: [], authority: null, epoch: journal.epoch + 1, navigationBlocked: false };
  unlock(); emit();
}
