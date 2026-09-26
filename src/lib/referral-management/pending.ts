"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";
import { parseReferralManagementApiError, parseReferralManagementApiSuccess, parseReferralManagementMutation } from "./parser";
import { normalizeReferralSnapshot } from "./snapshot-contract";
import type { ReferralAction, ReferralManagementItem, ReferralManagementMutationInput, ReferralManagementSnapshot } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().max(64).refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
export type ReferralScope = { organizationId: string; branchId: string; userId: string };
const scopeSchema = z.object({ organizationId: uuid, branchId: uuid, userId: uuid }).strict();
const authoritySchema = z.tuple([z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.boolean()]),
  z.array(z.string()), z.array(z.string()), z.enum(["aal1", "aal2"])]);
export function referralScopeIdentity(scope: ReferralScope, demo: boolean) {
  const value = scopeSchema.parse(scope);
  return JSON.stringify([value.organizationId, value.branchId, value.userId, demo]);
}
/** Generic referral recency stays in the authoritative snapshot and API. The
 * nursing-only recentAal2At must not become an invented referral credential. */
export function referralAuthoritySignature(context: TenantContext) {
  return JSON.stringify([[context.organizationId.toLowerCase(), context.branchId.toLowerCase(), context.userId.toLowerCase(), context.demo],
    [...new Set(context.roles)].sort(), [...new Set(context.scopes)].sort(), context.assuranceLevel]);
}
function parseAuthority(signature: string) {
  if (!signature || signature.length > 20_000) throw new Error("INVALID_REFERRAL_AUTHORITY");
  const value = authoritySchema.parse(JSON.parse(signature));
  if (!value[0][3]) scopeSchema.parse({ organizationId: value[0][0], branchId: value[0][1], userId: value[0][2] });
  return value;
}
function authorityIdentity() { return journal.authoritySignature ? JSON.stringify(parseAuthority(journal.authoritySignature)[0]) : null; }
const permission: Record<ReferralAction, string> = { create: "create", submit: "submit", register_received: "receive", respond: "respond", close: "close", correct: "correct" };
const capability: Record<ReferralAction, keyof ReferralManagementSnapshot> = { create: "canCreate", submit: "canSubmit", register_received: "canRegisterReceipt", respond: "canRespond", close: "canClose", correct: "canCorrect" };
function readable(identity: string) {
  if (!journal.authoritySignature) return false;
  const [scope, , scopes, aal] = parseAuthority(journal.authoritySignature);
  return JSON.stringify(scope) === identity && !scope[3] && aal === "aal2" && scopes.includes("clients.read") && scopes.includes("referral_management.read");
}
function permitted(action: ReferralAction, identity: string, clientId: string, requireFresh = false) {
  if (!readable(identity) || !admission || admission.identity !== identity || !admission.clients.includes(clientId) ||
    requireFresh && (Date.now() < Date.parse(admission.generatedAt) || Date.now() >= Date.parse(admission.staleAfter))) return false;
  const scopes = parseAuthority(journal.authoritySignature!)[2];
  return scopes.includes(`referral_management.${permission[action]}`) && admission.capabilities[action];
}
export function referralRequestBody(input: ReferralManagementMutationInput): Record<string, unknown> {
  if (input.action === "create") return { action: input.action, clientId: input.clientId, receivingUnitState: input.receivingUnitState,
    receivingUnitCode: input.receivingUnitCode, receivingUnitName: input.receivingUnitName, referralDate: input.referralDate, referralReason: input.referralReason };
  const chain = { action: input.action, referralKey: input.referralKey, previousEventId: input.previousEventId, expectedSequence: input.expectedSequence };
  return input.action === "correct" ? { ...chain, correctsEventId: input.correctsEventId, entryContent: input.entryContent, correctionReason: input.correctionReason }
    : input.action === "submit" && input.entryContent === null ? chain : { ...chain, entryContent: input.entryContent };
}
export type ReferralTarget = Readonly<ReferralManagementItem>;
export type ReferralOperation = Readonly<{ token: symbol; attempt: symbol; identity: string; scope: Readonly<ReferralScope>;
  input: Readonly<ReferralManagementMutationInput>; body: string; snapshotAt: string; target: ReferralTarget | null;
  phase: "sending" | "unknown"; everUnknown: boolean; privacyEpoch: number; authorityEpoch: number; capabilityEpoch: number; authoritySignature: string }>;
export type ReferralConfirmed = Readonly<{ identity: string; clientId: string; referralKey: string; eventId: string; sequence: number;
  status: ReferralManagementItem["status"]; eventKind: ReferralManagementItem["eventKind"]; receivingUnitState: ReferralManagementItem["receivingUnitState"];
  committedAt: string; snapshotAt: string }>;
type Journal = Readonly<{ operation: ReferralOperation | null; confirmed: readonly ReferralConfirmed[]; navigationBlocked: boolean;
  privacyEpoch: number; authorityEpoch: number; capabilityEpoch: number; authoritySignature: string | null;
  snapshotFloor: string | null; acceptedSnapshotAt: string | null }>;
const EMPTY: Journal = { operation: null, confirmed: [], navigationBlocked: false, privacyEpoch: 0, authorityEpoch: 0,
  capabilityEpoch: 0, authoritySignature: null, snapshotFloor: null, acceptedSnapshotAt: null };
let journal: Journal = EMPTY;
let admission: { identity: string; fingerprint: string; generatedAt: string; staleAfter: string; clients: string[];
  capabilities: Record<ReferralAction, boolean>; sources: Map<string, ReferralManagementItem> } | null = null;
let release: (() => void) | null = null;
let removeGuards: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getReferralPending = () => journal;
export function useReferralPending() { return useSyncExternalStore(subscribe, getReferralPending, () => EMPTY); }
/** Render-time watermark only, never admission or clinical evidence. Equal
 * accepted generation is valid; privacy snapshotFloor separately requires >.
 * A remounted owner must not display a rejected, older supplied projection. */
export function getReferralSnapshotAdmission(scope: ReferralScope, demo: boolean): string | null {
  if (demo) return null;
  const identity = referralScopeIdentity(scope, false);
  return identity === authorityIdentity() && readable(identity) ? journal.acceptedSnapshotAt : null;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value;
}
function unlock() { const held = release; const guards = removeGuards; release = null; removeGuards = null; try { guards?.(); } finally { held?.(); } }
function invalidateOperation() { return journal.operation ? Object.freeze({ ...journal.operation, phase: "unknown" as const, everUnknown: true, attempt: Symbol() }) : null; }
export function observeReferralAuthority(signature: string) {
  const next = parseAuthority(signature);
  if (signature === journal.authoritySignature) return journal.authorityEpoch;
  const previous = journal.authoritySignature ? parseAuthority(journal.authoritySignature) : null;
  const canRead = (value: ReturnType<typeof parseAuthority>) => !value[0][3] && value[3] === "aal2" &&
    value[2].includes("clients.read") && value[2].includes("referral_management.read");
  // The source carries no actor attestation. Retain a data-free generation
  // boundary outside React so A→B→A/remount cannot resurrect A's old source.
  const boundary = previous && (JSON.stringify(previous[0]) !== JSON.stringify(next[0]) || canRead(previous) && !canRead(next));
  const sourceAt = admission?.generatedAt ?? journal.acceptedSnapshotAt;
  const snapshotFloor = boundary && sourceAt && (!journal.snapshotFloor || Date.parse(sourceAt) > Date.parse(journal.snapshotFloor))
    ? sourceAt : journal.snapshotFloor;
  admission = null;
  journal = { ...journal, snapshotFloor, authoritySignature: signature, authorityEpoch: journal.authorityEpoch + 1,
    capabilityEpoch: journal.capabilityEpoch + 1, operation: invalidateOperation() };
  emit(); return journal.authorityEpoch;
}
/** Actual server flags include the generic recent-AAL2 result. Caller must
 * withhold a previous actor's snapshot across its generation/privacy boundary. */
export function observeReferralSnapshot(scope: ReferralScope, demo: boolean, snapshot: ReferralManagementSnapshot | null) {
  const identity = demo ? null : referralScopeIdentity(scope, false);
  if (identity !== authorityIdentity()) return false;
  let next: typeof admission = null;
  if (!demo && snapshot && !snapshot.demo && readable(identity!)) {
    const value = normalizeReferralSnapshot(snapshot, scopeSchema.parse(scope));
    if (journal.snapshotFloor && Date.parse(value.generatedAt) <= Date.parse(journal.snapshotFloor) ||
      journal.acceptedSnapshotAt && Date.parse(value.generatedAt) < Date.parse(journal.acceptedSnapshotAt)) return false;
    const clients = value.clientOptions.map((client) => client.clientId).sort();
    const capabilities = Object.fromEntries(Object.entries(capability).map(([action, field]) => [action, value[field]])) as Record<ReferralAction, boolean>;
    next = { identity: identity!, fingerprint: JSON.stringify([identity, clients, capabilities]), generatedAt: value.generatedAt,
      staleAfter: value.staleAfter, clients, capabilities, sources: new Map(value.items.map((item) => [item.referralKey, deepFreeze(item)])) };
  }
  const changed = admission?.fingerprint !== next?.fingerprint;
  const clearedFloor = next !== null && journal.snapshotFloor !== null;
  const generationChanged = next !== null && next.generatedAt !== journal.acceptedSnapshotAt;
  admission = next;
  if (changed || clearedFloor || generationChanged) { journal = { ...journal, snapshotFloor: clearedFloor ? null : journal.snapshotFloor,
    acceptedSnapshotAt: next?.generatedAt ?? journal.acceptedSnapshotAt,
    capabilityEpoch: journal.capabilityEpoch + (changed ? 1 : 0), operation: changed ? invalidateOperation() : journal.operation }; emit(); }
  return true;
}
/** Only tab memory: no browser storage, automatic replay or full-reload recovery. */
export function beginReferral(scope: ReferralScope, demo: boolean, value: ReferralManagementMutationInput,
  snapshotAt: string, target?: ReferralManagementItem): ReferralOperation | null {
  if (demo || journal.operation || journal.confirmed.length >= 32 || hasPendingOperations() || hasViewTransition()) return null;
  const normalizedScope = scopeSchema.parse(scope); const identity = referralScopeIdentity(normalizedScope, false);
  const input = deepFreeze(parseReferralManagementMutation(referralRequestBody(value), value.idempotencyKey));
  const sourceAt = timestamp.parse(snapshotAt);
  const source = input.referralKey ? admission?.sources.get(input.referralKey) ?? null : null;
  const clientId = input.action === "create" ? input.clientId! : source?.clientId ?? "";
  if (!permitted(input.action, identity, clientId, true) || admission!.generatedAt !== sourceAt ||
    journal.confirmed.some((entry) => entry.identity === identity && (input.action === "create" ? entry.clientId === clientId : entry.referralKey === input.referralKey))) return null;
  const proof = target ? source && JSON.stringify(source) === JSON.stringify(target) ? source : null : null;
  const expectedStatus = { submit: "draft", register_received: "submitted", respond: "received", close: "responded" };
  if (input.action === "create" ? target !== undefined : !proof || proof.eventId !== input.previousEventId || proof.sequence !== input.expectedSequence ||
    (input.action !== "correct" && proof.status !== expectedStatus[input.action]) ||
    input.action === "submit" && proof.receivingUnitState !== "manual_unstandardized" ||
    input.action === "correct" && !proof.history.some((entry) => entry.eventId === input.correctsEventId && entry.eventKind !== "corrected")) {
    throw new Error("INVALID_REFERRAL_SOURCE_BINDING");
  }
  const body = JSON.stringify(referralRequestBody(input));
  if (new TextEncoder().encode(body).byteLength > 32 * 1024) return null;
  const checkpoint = { privacyEpoch: journal.privacyEpoch, authorityEpoch: journal.authorityEpoch, capabilityEpoch: journal.capabilityEpoch };
  const lease = tryAcquirePendingOperation(); if (!lease) return null;
  if (journal.operation || checkpoint.privacyEpoch !== journal.privacyEpoch || checkpoint.authorityEpoch !== journal.authorityEpoch ||
    checkpoint.capabilityEpoch !== journal.capabilityEpoch || !permitted(input.action, identity, clientId, true)) { lease(); return null; }
  const token = Symbol();
  try {
    const operation: ReferralOperation = Object.freeze({ token, attempt: Symbol(), identity, scope: Object.freeze(normalizedScope), input, body,
      snapshotAt: sourceAt, target: proof, phase: "sending", everUnknown: false, ...checkpoint, authoritySignature: journal.authoritySignature! });
    release = lease; journal = { ...journal, operation, navigationBlocked: false };
    removeGuards = installPendingNavigationGuard({ hasPendingOperation: () => journal.operation !== null,
      permittedFormAttribute: "data-referral-management-form", onBlocked: () => { journal = { ...journal, navigationBlocked: true }; emit(); } });
    emit(); return journal.operation === operation ? operation : null;
  } catch (error) {
    if (journal.operation?.token === token) journal = { ...journal, operation: null, navigationBlocked: false };
    if (release === lease) unlock(); else lease(); throw error;
  }
}
export function retryReferral(token: symbol, scope: ReferralScope, demo: boolean): ReferralOperation | null {
  const current = journal.operation; const clientId = current?.input.clientId ?? current?.target?.clientId ?? "";
  if (!current || current.token !== token || current.phase !== "unknown" || demo || hasViewTransition() ||
    current.identity !== referralScopeIdentity(scope, false) || !permitted(current.input.action, current.identity, clientId)) return null;
  const operation = Object.freeze({ ...current, phase: "sending" as const, attempt: Symbol(), privacyEpoch: journal.privacyEpoch,
    authorityEpoch: journal.authorityEpoch, capabilityEpoch: journal.capabilityEpoch, authoritySignature: journal.authoritySignature! });
  journal = { ...journal, operation }; emit(); return journal.operation === operation ? operation : null;
}
export function settleReferral(operation: ReferralOperation, result: "unknown" | "denied" | ReturnType<typeof parseReferralManagementApiSuccess>) {
  const current = journal.operation;
  if (current !== operation || current.privacyEpoch !== journal.privacyEpoch || current.authorityEpoch !== journal.authorityEpoch ||
    current.capabilityEpoch !== journal.capabilityEpoch || current.authoritySignature !== journal.authoritySignature || current.identity !== authorityIdentity()) return false;
  const clientId = current.input.clientId ?? current.target!.clientId;
  if (result === "unknown" || !permitted(current.input.action, current.identity, clientId) || result === "denied" && current.everUnknown) {
    journal = { ...journal, operation: Object.freeze({ ...current, phase: "unknown", everUnknown: true, attempt: Symbol() }) }; emit(); return true;
  }
  let confirmed: ReferralConfirmed | null = null;
  if (typeof result === "object") {
    const receipt = parseReferralManagementApiSuccess(result, current.input, current.scope.organizationId, current.scope.branchId,
      result.data.replayed ? 200 : 201).data;
    if (current.target && (receipt.eventId === current.target.eventId || receipt.receivingUnitState !== current.target.receivingUnitState ||
      current.input.action === "correct" && receipt.referralStatus !== current.target.status)) throw new Error("INVALID_REFERRAL_RECEIPT_SOURCE_BINDING");
    confirmed = Object.freeze({ identity: current.identity, clientId, referralKey: receipt.referralKey, eventId: receipt.eventId,
      sequence: receipt.eventSequence, status: receipt.referralStatus, eventKind: receipt.eventKind,
      receivingUnitState: receipt.receivingUnitState, committedAt: receipt.committedAt, snapshotAt: current.snapshotAt });
  }
  journal = { ...journal, operation: null, navigationBlocked: false, confirmed: confirmed ? [...journal.confirmed, confirmed] : journal.confirmed };
  unlock(); emit(); return true;
}
/** Refresh/missing/newer unrelated heads do not prove this write reached the
 * visible list. Require the exact event inside the same client's same chain. */
export function reconcileReferralConfirmed(scope: ReferralScope, snapshot: ReferralManagementSnapshot, now: number) {
  if (!Number.isFinite(now) || snapshot.demo) return;
  const normalized = scopeSchema.parse(scope); const identity = referralScopeIdentity(normalized, false);
  if (!readable(identity)) return;
  let value: ReferralManagementSnapshot;
  try { value = normalizeReferralSnapshot(snapshot, normalized); } catch { return; }
  if (now < Date.parse(value.generatedAt) || now >= Date.parse(value.staleAfter) ||
    journal.snapshotFloor && Date.parse(value.generatedAt) <= Date.parse(journal.snapshotFloor) ||
    journal.acceptedSnapshotAt && Date.parse(value.generatedAt) < Date.parse(journal.acceptedSnapshotAt)) return;
  const confirmed = journal.confirmed.filter((entry) => entry.identity !== identity ||
    Date.parse(value.generatedAt) < Math.max(Date.parse(entry.committedAt), Date.parse(entry.snapshotAt)) ||
    !value.items.some((item) => item.clientId === entry.clientId && item.referralKey === entry.referralKey &&
      item.receivingUnitState === entry.receivingUnitState && item.history.some((event) => event.eventId === entry.eventId &&
        event.sequence === entry.sequence && event.status === entry.status && event.eventKind === entry.eventKind && event.occurredAt === entry.committedAt)));
  if (confirmed.length !== journal.confirmed.length) { journal = { ...journal, confirmed }; emit(); }
}
export function clearReferralPendingOnLogout() {
  const sourceAt = admission?.generatedAt ?? journal.acceptedSnapshotAt ?? journal.operation?.snapshotAt ?? null;
  const snapshotFloor = sourceAt && (!journal.snapshotFloor || Date.parse(sourceAt) > Date.parse(journal.snapshotFloor)) ? sourceAt : journal.snapshotFloor;
  admission = null; journal = { ...EMPTY, snapshotFloor, acceptedSnapshotAt: journal.acceptedSnapshotAt,
    privacyEpoch: journal.privacyEpoch + 1, authorityEpoch: journal.authorityEpoch + 1,
    capabilityEpoch: journal.capabilityEpoch + 1 }; unlock(); emit();
}
export function isConfirmedReferralRejection(raw: unknown, status: number) {
  let envelope: ReturnType<typeof parseReferralManagementApiError>;
  try { envelope = parseReferralManagementApiError(raw); } catch { return false; }
  const allowed: Record<number, readonly string[]> = {
    400: ["INVALID_REFERRAL_MANAGEMENT", "INVALID_REFERRAL_MANAGEMENT_STATE", "INVALID_JSON"],
    401: ["AUTH_REQUIRED"], 403: ["DEMO_READ_ONLY", "REFERRAL_MANAGEMENT_NOT_AUTHORIZED", "AAL2_REQUIRED"],
    409: ["REFERRAL_MANAGEMENT_SEQUENCE_CONFLICT", "REFERRAL_MANAGEMENT_IDEMPOTENCY_CONFLICT"], 413: ["REQUEST_TOO_LARGE"],
  };
  return envelope !== null && envelope.errors.every((error) => allowed[status]?.includes(error.code));
}
