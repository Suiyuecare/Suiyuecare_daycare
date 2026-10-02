"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquirePendingRecoveryRead } from "@/lib/navigation/pending-operation-lock";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";
import { parseCreateSocialWorkDraft, parseSocialWorkRecordMutation, parseSocialWorkFollowUpMutation, parseSocialWorkActionSuccess, parseSocialWorkActionError } from "./parser";
import { normalizeSocialWorkSnapshot } from "./snapshot-contract";
import type { CreateSocialWorkDraftInput, SocialWorkRecordMutationInput, SocialWorkFollowUpMutationInput, SocialWorkRecordSnapshot, SocialWorkServiceRecord } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().max(64).refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value))).transform((value) => new Date(value).toISOString());
export type SocialWorkScope = { organizationId: string; branchId: string; userId: string };
const scopeSchema = z.object({ organizationId: uuid, branchId: uuid, userId: uuid }).strict();
const authoritySchema = z.tuple([z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.boolean()]), z.array(z.string()), z.array(z.string()), z.enum(["aal1", "aal2"])]);
export type SocialWorkInput = CreateSocialWorkDraftInput | SocialWorkRecordMutationInput | SocialWorkFollowUpMutationInput;
export type SocialWorkCapabilities = { canManage: boolean; canSign: boolean; hasRecentAal2: boolean };
export function socialWorkScopeIdentity(scope: SocialWorkScope, demo: boolean) {
  const value = scopeSchema.parse(scope); return JSON.stringify([value.organizationId, value.branchId, value.userId, demo]);
}
export function socialWorkAuthoritySignature(context: TenantContext) {
  return JSON.stringify([[context.organizationId.toLowerCase(), context.branchId.toLowerCase(), context.userId.toLowerCase(), context.demo], [...new Set(context.roles)].sort(), [...new Set(context.scopes)].sort(), context.assuranceLevel]);
}
function parseAuthority(signature: string) {
  if (!signature || signature.length > 20_000) throw new Error("INVALID_SOCIAL_WORK_AUTHORITY");
  const value = authoritySchema.parse(JSON.parse(signature));
  if (!value[0][3]) scopeSchema.parse({ organizationId: value[0][0], branchId: value[0][1], userId: value[0][2] });
  return value;
}
export function socialWorkRequestBody(input: SocialWorkInput): Record<string, unknown> {
  if (input.action === "track") return { action: input.action, clientId: input.clientId, recordKey: input.recordKey, serviceVersionId: input.serviceVersionId, expectedSequence: input.expectedSequence, dueOn: input.dueOn, followUpPlan: input.followUpPlan };
  if (input.action === "complete_follow_up") return { action: input.action, clientId: input.clientId, recordKey: input.recordKey, serviceVersionId: input.serviceVersionId, expectedSequence: input.expectedSequence, followUpOutcome: input.followUpOutcome };
  if (input.action === "cancel_follow_up") return { action: input.action, clientId: input.clientId, recordKey: input.recordKey, serviceVersionId: input.serviceVersionId, expectedSequence: input.expectedSequence, transitionReason: input.transitionReason };
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== "idempotencyKey"));
}
export function parseSocialWorkInput(body: Record<string, unknown>, key: string): SocialWorkInput {
  return body.action === "create_draft" ? parseCreateSocialWorkDraft(body, key) : ["track", "complete_follow_up", "cancel_follow_up"].includes(String(body.action)) ? parseSocialWorkFollowUpMutation(body, key) : parseSocialWorkRecordMutation(body, key);
}
export type SocialWorkOperation = Readonly<{ token: symbol; attempt: symbol; identity: string; scope: Readonly<SocialWorkScope>; input: Readonly<SocialWorkInput>; body: string; snapshotAt: string; target: Readonly<SocialWorkServiceRecord> | null; phase: "sending" | "unknown"; everUnknown: boolean; privacyEpoch: number; authorityEpoch: number; capabilityEpoch: number; authoritySignature: string }>;
export type SocialWorkConfirmed = Readonly<{ identity: string; clientId: string; recordKey: string; receiptKind: "record" | "follow_up"; resultId: string; sequence: number; state: string; committedAt: string; snapshotAt: string }>;
type Journal = Readonly<{ operation: SocialWorkOperation | null; confirmed: readonly SocialWorkConfirmed[]; privacyEpoch: number; authorityEpoch: number; capabilityEpoch: number; authoritySignature: string | null; navigationBlocked: boolean; snapshotFloor: string | null; acceptedSnapshotAt: string | null }>;
const EMPTY: Journal = { operation: null, confirmed: [], privacyEpoch: 0, authorityEpoch: 0, capabilityEpoch: 0, authoritySignature: null, navigationBlocked: false, snapshotFloor: null, acceptedSnapshotAt: null };
let journal: Journal = EMPTY;
let admission: { identity: string; generatedAt: string; staleAfter: string; fingerprint: string; clients: string[]; capabilities: SocialWorkCapabilities; sources: Map<string, SocialWorkServiceRecord> } | null = null;
let release: (() => void) | null = null; let removeGuards: (() => void) | null = null;
const listeners = new Set<() => void>();
function emit() { for (const listener of [...listeners]) listener(); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export const getSocialWorkPending = () => journal;
export function useSocialWorkPending() { return useSyncExternalStore(subscribe, getSocialWorkPending, () => EMPTY); }
function freeze<T>(value: T): T { if (value && typeof value === "object") { for (const entry of Object.values(value)) freeze(entry); Object.freeze(value); } return value; }
function unlock() { const held = release; const guards = removeGuards; release = null; removeGuards = null; try { guards?.(); } finally { held?.(); } }
function authorityIdentity() { return journal.authoritySignature ? JSON.stringify(parseAuthority(journal.authoritySignature)[0]) : null; }
function readable(identity: string) {
  if (!journal.authoritySignature) return false;
  const [scope, , scopes, aal] = parseAuthority(journal.authoritySignature);
  return JSON.stringify(scope) === identity && !scope[3] && aal === "aal2" && scopes.includes("clients.read") && scopes.includes("social_work_records.read");
}
function permitted(input: SocialWorkInput, identity: string, fresh = false) {
  if (!readable(identity) || !admission || admission.identity !== identity || !admission.clients.includes(input.clientId) || fresh && (Date.now() < Date.parse(admission.generatedAt) || Date.now() >= Date.parse(admission.staleAfter))) return false;
  const signing = input.action === "sign" || input.action === "correct";
  return parseAuthority(journal.authoritySignature!)[2].includes(signing ? "social_work_records.sign" : "social_work_records.manage") && (signing ? admission.capabilities.canSign && admission.capabilities.hasRecentAal2 : admission.capabilities.canManage);
}
function invalidate() { return journal.operation ? Object.freeze({ ...journal.operation, phase: "unknown" as const, everUnknown: true, attempt: Symbol() }) : null; }
export function observeSocialWorkAuthority(signature: string) {
  const next = parseAuthority(signature); if (signature === journal.authoritySignature) return journal.authorityEpoch;
  const previous = journal.authoritySignature ? parseAuthority(journal.authoritySignature) : null;
  const canRead = (value: ReturnType<typeof parseAuthority>) => !value[0][3] && value[3] === "aal2" && value[2].includes("clients.read") && value[2].includes("social_work_records.read");
  const boundary = previous && (JSON.stringify(previous[0]) !== JSON.stringify(next[0]) || canRead(previous) && !canRead(next));
  const sourceAt = admission?.generatedAt ?? journal.acceptedSnapshotAt;
  const floor = boundary && sourceAt && (!journal.snapshotFloor || Date.parse(sourceAt) > Date.parse(journal.snapshotFloor)) ? sourceAt : journal.snapshotFloor;
  admission = null; journal = { ...journal, snapshotFloor: floor, authoritySignature: signature, authorityEpoch: journal.authorityEpoch + 1, capabilityEpoch: journal.capabilityEpoch + 1, operation: invalidate() }; emit(); return journal.authorityEpoch;
}
export function getSocialWorkSnapshotAdmission(scope: SocialWorkScope, demo: boolean) {
  if (demo) return null; const identity = socialWorkScopeIdentity(scope, false);
  return identity === authorityIdentity() && readable(identity) ? journal.acceptedSnapshotAt : null;
}
export function tryAcquireSocialWorkRecoveryRead(scope: SocialWorkScope, demo: boolean): (() => void) | null {
  if (demo || hasViewTransition()) return null;
  const identity = socialWorkScopeIdentity(scope, false);
  if (identity !== authorityIdentity()) return null;
  if (!journal.operation) return tryAcquirePendingRecoveryRead();
  if (journal.operation.phase !== "unknown" || journal.operation.identity !== identity || !release) return null;
  return tryAcquirePendingRecoveryRead(release);
}
/** A denied authorized read cannot be repaired by remounting old server props.
 * Preserve the original write privately; invalidate attempts and require a
 * strictly newer authorized snapshot before revealing any clinical content. */
export function quarantineSocialWorkSnapshot(scope: SocialWorkScope, demo: boolean) {
  if (demo || socialWorkScopeIdentity(scope, false) !== authorityIdentity()) return false;
  const sourceAt = admission?.generatedAt ?? journal.acceptedSnapshotAt;
  const floor = sourceAt && (!journal.snapshotFloor || Date.parse(sourceAt) > Date.parse(journal.snapshotFloor)) ? sourceAt : journal.snapshotFloor;
  admission = null;
  journal = { ...journal, snapshotFloor: floor, capabilityEpoch: journal.capabilityEpoch + 1, operation: invalidate() };
  emit(); return true;
}
export function observeSocialWorkSnapshot(scope: SocialWorkScope, demo: boolean, snapshot: SocialWorkRecordSnapshot | null, capabilities: SocialWorkCapabilities) {
  const identity = demo ? null : socialWorkScopeIdentity(scope, false); if (identity !== authorityIdentity()) return false;
  let next: typeof admission = null;
  if (!demo && snapshot && !snapshot.demo && readable(identity!)) {
    const value = normalizeSocialWorkSnapshot(snapshot, scope);
    if (journal.snapshotFloor && Date.parse(value.generatedAt) <= Date.parse(journal.snapshotFloor) || journal.acceptedSnapshotAt && Date.parse(value.generatedAt) < Date.parse(journal.acceptedSnapshotAt)) return false;
    const clients = [...new Set([...value.clientOptions.map((client) => client.clientId), ...value.records.map((record) => record.clientId)])].sort();
    const flags = z.object({ canManage: z.boolean(), canSign: z.boolean(), hasRecentAal2: z.boolean() }).strict().parse(capabilities);
    next = { identity: identity!, generatedAt: value.generatedAt, staleAfter: value.staleAfter, clients, capabilities: flags, fingerprint: JSON.stringify([identity, clients, flags]), sources: new Map(value.records.map((record) => [record.recordKey, freeze(record)])) };
  }
  const lostClients = admission && next && admission.clients.some((clientId) => !next.clients.includes(clientId));
  // A same-generation visibility loss must not be followed by replaying the old
  // supplied props, including after a React remount. Keep only the time floor.
  if (lostClients && next && Date.parse(next.generatedAt) <= Date.parse(admission!.generatedAt)) {
    const sourceAt = admission!.generatedAt;
    const floor = !journal.snapshotFloor || Date.parse(sourceAt) > Date.parse(journal.snapshotFloor) ? sourceAt : journal.snapshotFloor;
    admission = null; journal = { ...journal, snapshotFloor: floor, capabilityEpoch: journal.capabilityEpoch + 1, operation: invalidate() }; emit(); return false;
  }
  const changed = admission?.fingerprint !== next?.fingerprint; const generation = next?.generatedAt ?? journal.acceptedSnapshotAt;
  const clearFloor = next !== null && journal.snapshotFloor !== null; admission = next;
  if (changed || clearFloor || generation !== journal.acceptedSnapshotAt) { journal = { ...journal, acceptedSnapshotAt: generation, snapshotFloor: clearFloor ? null : journal.snapshotFloor, capabilityEpoch: journal.capabilityEpoch + (changed ? 1 : 0), operation: changed ? invalidate() : journal.operation }; emit(); }
  return true;
}
export function beginSocialWork(scope: SocialWorkScope, demo: boolean, value: SocialWorkInput, snapshotAt: string, target?: SocialWorkServiceRecord): SocialWorkOperation | null {
  if (demo || journal.operation || journal.confirmed.length >= 32 || hasPendingOperations() || hasViewTransition()) return null;
  const normalized = scopeSchema.parse(scope); const identity = socialWorkScopeIdentity(normalized, false);
  const input = freeze(parseSocialWorkInput(socialWorkRequestBody(value), value.idempotencyKey)); const sourceAt = timestamp.parse(snapshotAt);
  if (!permitted(input, identity, true) || admission!.generatedAt !== sourceAt || journal.confirmed.some((entry) => entry.identity === identity && (input.action === "create_draft" ? entry.clientId === input.clientId : entry.recordKey === input.recordKey))) return null;
  const source = input.action === "create_draft" ? null : admission!.sources.get(input.recordKey) ?? null;
  const proof = source && target && JSON.stringify(source) === JSON.stringify(target) ? source : null;
  if (input.action === "create_draft" ? target !== undefined : !proof || proof.clientId !== input.clientId || ("previousVersionId" in input ? proof.versionId !== input.previousVersionId || proof.recordVersion !== input.expectedVersion || (input.action === "correct" ? proof.recordState === "draft" : proof.recordState !== "draft") : proof.versionId !== input.serviceVersionId || proof.followUpSequence !== input.expectedSequence || proof.recordState === "draft" || (input.action === "track" ? proof.followUpStatus === "pending" : proof.followUpStatus !== "pending"))) throw new Error("INVALID_SOCIAL_WORK_SOURCE_BINDING");
  const body = JSON.stringify(socialWorkRequestBody(input)); if (new TextEncoder().encode(body).byteLength > 16 * 1024) return null;
  const checkpoint = { privacyEpoch: journal.privacyEpoch, authorityEpoch: journal.authorityEpoch, capabilityEpoch: journal.capabilityEpoch };
  const lease = tryAcquirePendingOperation(); if (!lease) return null;
  if (journal.operation || checkpoint.privacyEpoch !== journal.privacyEpoch || checkpoint.authorityEpoch !== journal.authorityEpoch || checkpoint.capabilityEpoch !== journal.capabilityEpoch || !permitted(input, identity, true)) { lease(); return null; }
  const token = Symbol();
  try {
    const operation: SocialWorkOperation = Object.freeze({ token, attempt: Symbol(), identity, scope: Object.freeze(normalized), input, body, snapshotAt: sourceAt, target: proof, phase: "sending", everUnknown: false, ...checkpoint, authoritySignature: journal.authoritySignature! });
    release = lease; journal = { ...journal, operation, navigationBlocked: false };
    removeGuards = installPendingNavigationGuard({ hasPendingOperation: () => journal.operation !== null, permittedFormAttribute: "data-social-work-form", onBlocked: () => { journal = { ...journal, navigationBlocked: true }; emit(); } }); emit(); return journal.operation === operation ? operation : null;
  } catch (error) { if (journal.operation?.token === token) journal = { ...journal, operation: null, navigationBlocked: false }; if (release === lease) unlock(); else lease(); throw error; }
}
export function retrySocialWork(token: symbol, scope: SocialWorkScope, demo: boolean) {
  const current = journal.operation;
  if (!current || current.token !== token || current.phase !== "unknown" || demo || hasViewTransition() || current.identity !== socialWorkScopeIdentity(scope, false) || !permitted(current.input, current.identity)) return null;
  const operation = Object.freeze({ ...current, phase: "sending" as const, attempt: Symbol(), privacyEpoch: journal.privacyEpoch, authorityEpoch: journal.authorityEpoch, capabilityEpoch: journal.capabilityEpoch, authoritySignature: journal.authoritySignature! }); journal = { ...journal, operation }; emit(); return journal.operation === operation ? operation : null;
}
export function socialWorkExpectation(input: SocialWorkInput) {
  return { action: input.action, ...(input.action === "create_draft" ? {} : { recordKey: input.recordKey }), ...("expectedVersion" in input ? { expectedVersion: input.expectedVersion } : "expectedSequence" in input ? { expectedFollowUpSequence: input.expectedSequence } : {}) };
}
export function settleSocialWork(operation: SocialWorkOperation, result: "unknown" | "denied" | ReturnType<typeof parseSocialWorkActionSuccess>) {
  const current = journal.operation;
  if (current !== operation || current.privacyEpoch !== journal.privacyEpoch || current.authorityEpoch !== journal.authorityEpoch || current.capabilityEpoch !== journal.capabilityEpoch || current.authoritySignature !== journal.authoritySignature || current.identity !== authorityIdentity()) return false;
  if (result === "unknown" || !permitted(current.input, current.identity) || result === "denied" && current.everUnknown) { journal = { ...journal, operation: Object.freeze({ ...current, phase: "unknown", everUnknown: true, attempt: Symbol() }) }; emit(); return true; }
  let confirmed: SocialWorkConfirmed | null = null;
  if (typeof result === "object") {
    const receipt = parseSocialWorkActionSuccess(result, socialWorkExpectation(current.input), result.data.replayed ? 200 : 201).data;
    if (current.target && (receipt.receiptKind === "record" ? receipt.versionId === current.target.versionId : receipt.followUpEventId === current.target.followUpEventId)) throw new Error("INVALID_SOCIAL_WORK_RECEIPT_SOURCE_BINDING");
    confirmed = Object.freeze({ identity: current.identity, clientId: current.input.clientId, recordKey: receipt.recordKey, receiptKind: receipt.receiptKind, resultId: receipt.receiptKind === "record" ? receipt.versionId : receipt.followUpEventId, sequence: receipt.receiptKind === "record" ? receipt.recordVersion : receipt.followUpSequence, state: receipt.receiptKind === "record" ? receipt.recordState : receipt.followUpStatus, committedAt: receipt.committedAt, snapshotAt: current.snapshotAt });
  }
  journal = { ...journal, operation: null, navigationBlocked: false, confirmed: confirmed ? [...journal.confirmed, confirmed] : journal.confirmed }; unlock(); emit(); return true;
}
export function reconcileSocialWorkConfirmed(scope: SocialWorkScope, snapshot: SocialWorkRecordSnapshot, now: number) {
  if (!Number.isFinite(now) || snapshot.demo) return;
  const identity = socialWorkScopeIdentity(scope, false); if (!readable(identity)) return;
  let value: SocialWorkRecordSnapshot; try { value = normalizeSocialWorkSnapshot(snapshot, scope); } catch { return; }
  if (now < Date.parse(value.generatedAt) || now >= Date.parse(value.staleAfter) || journal.snapshotFloor && Date.parse(value.generatedAt) <= Date.parse(journal.snapshotFloor) || journal.acceptedSnapshotAt && Date.parse(value.generatedAt) < Date.parse(journal.acceptedSnapshotAt)) return;
  const confirmed = journal.confirmed.filter((entry) => entry.identity !== identity || Date.parse(value.generatedAt) < Math.max(Date.parse(entry.committedAt), Date.parse(entry.snapshotAt)) || !value.records.some((record) => record.clientId === entry.clientId && record.recordKey === entry.recordKey && (entry.receiptKind === "record" ? record.versionHistory.some((version) => version.versionId === entry.resultId && version.recordVersion === entry.sequence && version.recordState === entry.state && version.createdAt === entry.committedAt) : record.followUpHistory.some((event) => event.eventId === entry.resultId && event.sequence === entry.sequence && event.status === entry.state && event.committedAt === entry.committedAt))));
  if (confirmed.length !== journal.confirmed.length) { journal = { ...journal, confirmed }; emit(); }
}
export function clearSocialWorkPendingOnLogout() {
  const sourceAt = admission?.generatedAt ?? journal.acceptedSnapshotAt ?? journal.operation?.snapshotAt ?? null;
  const floor = sourceAt && (!journal.snapshotFloor || Date.parse(sourceAt) > Date.parse(journal.snapshotFloor)) ? sourceAt : journal.snapshotFloor;
  admission = null; journal = { ...EMPTY, snapshotFloor: floor, acceptedSnapshotAt: journal.acceptedSnapshotAt, privacyEpoch: journal.privacyEpoch + 1, authorityEpoch: journal.authorityEpoch + 1, capabilityEpoch: journal.capabilityEpoch + 1 }; unlock(); emit();
}
export function isConfirmedSocialWorkRejection(raw: unknown, status: number) {
  const envelope = parseSocialWorkActionError(raw);
  const allowed: Record<number, readonly string[]> = { 400: ["INVALID_SOCIAL_WORK_RECORD", "INVALID_JSON"], 401: ["AUTH_REQUIRED"], 403: ["DEMO_READ_ONLY", "SOCIAL_WORK_NOT_AUTHORIZED", "AAL2_REQUIRED"], 409: ["SOCIAL_WORK_VERSION_CONFLICT", "SOCIAL_WORK_IDEMPOTENCY_CONFLICT", "SOCIAL_WORK_STATE_CONFLICT"], 413: ["REQUEST_TOO_LARGE"] };
  return envelope !== null && envelope.errors.every((error) => allowed[status]?.includes(error.code));
}
