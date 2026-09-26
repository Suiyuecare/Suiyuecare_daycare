"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import { hasPendingOperations, tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";
import { BODY_MUTATION_MAX_BYTES, bodyUuid, parseBodyAssessmentMutation, parseBodyAssessmentReceipt, type BodyAssessmentInput, type BodyAssessmentReceipt } from "./parser";
import type { BodyAssessmentSnapshot } from "./types";

export type BodyAssessmentScope = { organizationId: string; branchId: string; userId: string };
const scopeSchema = z.object({ organizationId: bodyUuid, branchId: bodyUuid, userId: bodyUuid }).strict();
export function bodyAssessmentScopeIdentity(scope: BodyAssessmentScope, demo: boolean) {
  const value = scopeSchema.parse(scope);
  return JSON.stringify([value.organizationId, value.branchId, value.userId, demo]);
}
export type BodyAssessmentOperation = Readonly<{ token: symbol; attempt: symbol; identity: string;
  scope: Readonly<BodyAssessmentScope>; input: BodyAssessmentInput; body: string;
  phase: "sending" | "unknown"; everUnknown: boolean }>;
type Confirmed = Readonly<{ identity: string; clientId: string; assessmentKey: string; versionId: string; version: number; committedAt: string }>;
type Journal = Readonly<{ operation: BodyAssessmentOperation | null; confirmed: readonly Confirmed[];
  navigationBlocked: boolean; privacyEpoch: number }>;
const EMPTY: Journal = { operation: null, confirmed: [], navigationBlocked: false, privacyEpoch: 0 };
let journal: Journal = EMPTY;
let release: (() => void) | null = null;
let removeGuards: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getBodyAssessmentPending = () => journal;
export function useBodyAssessmentPending() { return useSyncExternalStore(subscribe, getBodyAssessmentPending, () => EMPTY); }
function freezeInput(input: BodyAssessmentInput): BodyAssessmentInput {
  if ("observations" in input.payload) {
    for (const row of input.payload.observations) Object.freeze(row);
    Object.freeze(input.payload.observations);
  }
  Object.freeze(input.payload); return Object.freeze(input);
}
function unlock() { release?.(); release = null; removeGuards?.(); removeGuards = null; }

/** At most one tab-local body write and 32 opaque confirmation markers. No
 * payload, scope, token or clinical text is persisted in storage or history. */
export function beginBodyAssessment(scope: BodyAssessmentScope, demo: boolean, value: BodyAssessmentInput): BodyAssessmentOperation | null {
  if (demo || journal.operation || journal.confirmed.length >= 32 || hasPendingOperations()) return null;
  const identity = bodyAssessmentScopeIdentity(scope, demo);
  if (journal.confirmed.some((entry) => entry.identity === identity)) return null;
  const input = freezeInput(parseBodyAssessmentMutation(value.payload, value.idempotencyKey));
  const body = JSON.stringify(input.payload);
  if (new TextEncoder().encode(body).byteLength > BODY_MUTATION_MAX_BYTES) return null;
  const lease = tryAcquirePendingOperation(); if (!lease) return null;
  const token = Symbol();
  try {
    const operation = Object.freeze({ token, attempt: Symbol(), identity, scope: Object.freeze(scopeSchema.parse(scope)), input,
      body, phase: "sending" as const, everUnknown: false });
    release = lease; journal = { ...journal, operation, navigationBlocked: false };
    removeGuards = installPendingNavigationGuard({ hasPendingOperation: () => journal.operation !== null,
      permittedFormAttribute: "data-body-assessment-form", onBlocked: () => {
        journal = { ...journal, navigationBlocked: true }; emit();
      } });
    emit(); return operation;
  } catch (error) {
    if (journal.operation?.token === token) journal = { ...journal, operation: null, navigationBlocked: false };
    if (release === lease) unlock(); else lease();
    throw error;
  }
}
export function retryBodyAssessment(token: symbol, scope: BodyAssessmentScope, demo: boolean): BodyAssessmentOperation | null {
  const current = journal.operation;
  if (!current || current.token !== token || current.phase !== "unknown" ||
    current.identity !== bodyAssessmentScopeIdentity(scope, demo)) return null;
  const operation = Object.freeze({ ...current, phase: "sending" as const, attempt: Symbol() });
  journal = { ...journal, operation }; emit(); return operation;
}
export function settleBodyAssessment(operation: BodyAssessmentOperation, result: "unknown" | "denied" | BodyAssessmentReceipt) {
  const current = journal.operation;
  if (!current || current.token !== operation.token || current.attempt !== operation.attempt) return false;
  if (result === "unknown" || result === "denied" && current.everUnknown) {
    journal = { ...journal, operation: Object.freeze({ ...current, phase: "unknown", everUnknown: true }) }; emit(); return true;
  }
  const receipt = typeof result === "object" ? parseBodyAssessmentReceipt(result, current.input, current.scope) : null;
  journal = { ...journal, operation: null, navigationBlocked: false, confirmed: typeof result === "object"
    ? [...journal.confirmed, Object.freeze({ identity: current.identity, clientId: receipt!.client_id, assessmentKey: receipt!.assessment_key,
      versionId: receipt!.version_id, version: receipt!.version, committedAt: receipt!.committed_at })] : journal.confirmed };
  unlock(); emit(); return true;
}
/** Only a complete, fresh server snapshot containing the committed version (or
 * a newer version of that assessment) clears its marker. refresh() does not. */
export function reconcileBodyAssessmentConfirmed(scope: BodyAssessmentScope, snapshot: BodyAssessmentSnapshot, now: number) {
  const identity = bodyAssessmentScopeIdentity(scope, snapshot.demo);
  if (snapshot.demo || snapshot.organizationId !== scope.organizationId || snapshot.branchId !== scope.branchId ||
    snapshot.clientsTruncated || snapshot.recordsTruncated || !Number.isFinite(Date.parse(snapshot.generatedAt)) ||
    !Number.isFinite(Date.parse(snapshot.staleAfter)) || now > Date.parse(snapshot.staleAfter)) return;
  const confirmed = journal.confirmed.filter((entry) => entry.identity !== identity ||
    Date.parse(snapshot.generatedAt) < Date.parse(entry.committedAt) || !snapshot.records.some((record) =>
      record.assessment_key === entry.assessmentKey && record.version >= entry.version &&
      (record.version > entry.version || record.version_id === entry.versionId)));
  if (confirmed.length !== journal.confirmed.length) { journal = { ...journal, confirmed }; emit(); }
}
/** Privacy boundary only. Ordinary remount/scope change must retain the key;
 * logout invalidates late replies and releases only this journal's own lease. */
export function clearBodyAssessmentPendingOnLogout() {
  journal = { ...EMPTY, privacyEpoch: journal.privacyEpoch + 1 }; unlock(); emit();
}

export function isConfirmedBodyAssessmentRejection(raw: unknown, status: number) {
  const envelope = z.object({ requestId: bodyUuid, status: z.literal("error"), data: z.null(),
    errors: z.array(z.object({ code: z.string(), message: z.string().max(500), field: z.string().max(120).optional() }).strict())
      .min(1).max(20) }).strict().safeParse(raw);
  const allowed: Record<number, readonly string[]> = {
    400: ["INVALID_BODY_ASSESSMENT_OPERATION", "INVALID_JSON"], 401: ["AUTH_REQUIRED"],
    403: ["DEMO_READ_ONLY", "BODY_ASSESSMENT_NOT_AUTHORIZED", "AAL2_REQUIRED"],
    409: ["BODY_ASSESSMENT_VERSION_CONFLICT", "BODY_ASSESSMENT_IDEMPOTENCY_CONFLICT"],
    413: ["REQUEST_TOO_LARGE"],
  };
  return envelope.success && envelope.data.errors.every((error) => allowed[status]?.includes(error.code));
}
