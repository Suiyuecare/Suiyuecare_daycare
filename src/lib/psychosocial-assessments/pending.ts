"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquirePendingRecoveryRead } from "@/lib/navigation/pending-operation-lock";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";
import { parseCreatePsychosocialDraft, parsePsychosocialActionError, parsePsychosocialActionSuccess, parsePsychosocialAssessmentMutation } from "./parser";
import { normalizePsychosocialSnapshot } from "./snapshot-contract";
import type { CreatePsychosocialDraftInput, PsychosocialAssessmentListItem, PsychosocialAssessmentMutationInput, PsychosocialAssessmentSnapshot, PsychosocialRecordState } from "./types";

export type PsychosocialInput = CreatePsychosocialDraftInput | PsychosocialAssessmentMutationInput;
export type PsychosocialScope = { organizationId: string; branchId: string; userId: string };
export type PsychosocialCapabilities = { canManage: boolean; canSign: boolean; hasRecentAal2: boolean };
const uuid = z.uuid().transform((value) => value.toLowerCase());
const scopeSchema = z.object({ organizationId: uuid, branchId: uuid, userId: uuid }).strict();
const capabilitiesSchema = z.object({ canManage: z.boolean(), canSign: z.boolean(), hasRecentAal2: z.boolean() }).strict();
const authoritySchema = z.tuple([z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.boolean()]), z.array(z.string()), z.array(z.string()), z.enum(["aal1", "aal2"])]);
export function psychosocialAssessmentAuthoritySignature(context: TenantContext) {
  return JSON.stringify([[context.organizationId.toLowerCase(), context.branchId.toLowerCase(), context.userId.toLowerCase(), context.demo], [...new Set(context.roles)].sort(), [...new Set(context.scopes)].sort(), context.assuranceLevel]);
}
function authority(signature: string) {
  if (signature.length > 20_000) throw new Error("INVALID_PSYCHOSOCIAL_AUTHORITY");
  const value = authoritySchema.parse(JSON.parse(signature));
  if (!value[0][3]) scopeSchema.parse({ organizationId: value[0][0], branchId: value[0][1], userId: value[0][2] });
  return value;
}
export function psychosocialAssessmentScopeIdentity(scope: PsychosocialScope, demo: boolean) {
  const normalized = scopeSchema.parse(scope); return JSON.stringify([normalized.organizationId, normalized.branchId, normalized.userId, demo]);
}
function currentIdentity() { return journal.authoritySignature ? JSON.stringify(authority(journal.authoritySignature)[0]) : null; }
function readable(identity: string) {
  if (!journal.authoritySignature) return false;
  const [scope, , scopes, aal] = authority(journal.authoritySignature);
  return JSON.stringify(scope) === identity && !scope[3] && aal === "aal2" && scopes.includes("clients.read") && scopes.includes("social_work_records.read");
}
const signing = (action: PsychosocialInput["action"]) => action === "sign" || action === "correct";
function permitted(action: PsychosocialInput["action"], identity: string, clientId: string, fresh = false) {
  if (!readable(identity) || !admission || admission.identity !== identity || !admission.clients.includes(clientId) ||
    fresh && (Date.now() < Date.parse(admission.generatedAt) || Date.now() >= Date.parse(admission.staleAfter))) return false;
  const scopes = authority(journal.authoritySignature!)[2];
  return signing(action) ? scopes.includes("social_work_records.sign") && admission.capabilities.canSign && admission.capabilities.hasRecentAal2
    : scopes.includes("social_work_records.manage") && admission.capabilities.canManage;
}
export function psychosocialAssessmentRequestBody(input: PsychosocialInput) {
  const { idempotencyKey: _key, ...body } = input; void _key; return body;
}
export type PsychosocialOperation = Readonly<{ token: symbol; attempt: symbol; identity: string; scope: Readonly<PsychosocialScope>; input: Readonly<PsychosocialInput>; body: string; snapshotAt: string;
  target: Readonly<PsychosocialAssessmentListItem> | null; phase: "sending" | "unknown"; everUnknown: boolean; privacyEpoch: number; authorityEpoch: number; capabilityEpoch: number; authoritySignature: string }>;
type Confirmed = Readonly<{ identity: string; clientId: string; assessmentKey: string; versionId: string; version: number; state: PsychosocialRecordState; committedAt: string; snapshotAt: string }>;
type Journal = Readonly<{ operation: PsychosocialOperation | null; confirmed: readonly Confirmed[]; navigationBlocked: boolean; privacyEpoch: number; authorityEpoch: number; capabilityEpoch: number;
  authoritySignature: string | null; snapshotFloor: string | null; acceptedSnapshotAt: string | null }>;
const EMPTY: Journal = { operation: null, confirmed: [], navigationBlocked: false, privacyEpoch: 0, authorityEpoch: 0, capabilityEpoch: 0, authoritySignature: null, snapshotFloor: null, acceptedSnapshotAt: null };
let journal: Journal = EMPTY;
let admission: { identity: string; fingerprint: string; generatedAt: string; staleAfter: string; clients: string[]; capabilities: PsychosocialCapabilities; sources: Map<string, PsychosocialAssessmentListItem> } | null = null;
let release: (() => void) | null = null; let removeGuards: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getPsychosocialAssessmentPending = () => journal;
export function usePsychosocialAssessmentPending() { return useSyncExternalStore(subscribe, getPsychosocialAssessmentPending, () => EMPTY); }
export function getPsychosocialAssessmentSnapshotAdmission(scope: PsychosocialScope, demo: boolean) {
  if (demo) return null; const identity = psychosocialAssessmentScopeIdentity(scope, false);
  return readable(identity) ? journal.acceptedSnapshotAt : null;
}
export function tryAcquirePsychosocialAssessmentRecoveryRead(scope: PsychosocialScope, demo: boolean): (() => void) | null {
  if (demo || hasViewTransition()) return null;
  const identity = psychosocialAssessmentScopeIdentity(scope, false);
  if (identity !== currentIdentity()) return null;
  if (!journal.operation) return tryAcquirePendingRecoveryRead();
  if (journal.operation.phase !== "unknown" || journal.operation.identity !== identity || !release) return null;
  return tryAcquirePendingRecoveryRead(release);
}
export function quarantinePsychosocialAssessmentSnapshot(scope: PsychosocialScope, demo: boolean) {
  if (demo || psychosocialAssessmentScopeIdentity(scope, false) !== currentIdentity()) return false;
  const sourceAt = admission?.generatedAt ?? journal.acceptedSnapshotAt;
  admission = null;
  journal = { ...journal, snapshotFloor: floorAt(sourceAt), capabilityEpoch: journal.capabilityEpoch + 1, operation: invalidate() };
  emit(); return true;
}
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
function unlock() { const held = release; const guards = removeGuards; release = null; removeGuards = null; try { guards?.(); } finally { held?.(); } }
function invalidate() { return journal.operation ? Object.freeze({ ...journal.operation, phase: "unknown" as const, everUnknown: true, attempt: Symbol() }) : null; }
function floorAt(source: string | null) { return source && (!journal.snapshotFloor || Date.parse(source) > Date.parse(journal.snapshotFloor)) ? source : journal.snapshotFloor; }
export function observePsychosocialAssessmentAuthority(signature: string) {
  const next = authority(signature); if (journal.authoritySignature === signature) return journal.authorityEpoch;
  const previous = journal.authoritySignature ? authority(journal.authoritySignature) : null;
  const canRead = (value: ReturnType<typeof authority>) => !value[0][3] && value[3] === "aal2" && value[2].includes("clients.read") && value[2].includes("social_work_records.read");
  const boundary = previous && (JSON.stringify(previous[0]) !== JSON.stringify(next[0]) || canRead(previous) && !canRead(next));
  const source = admission?.generatedAt ?? journal.acceptedSnapshotAt; admission = null;
  journal = { ...journal, snapshotFloor: boundary ? floorAt(source) : journal.snapshotFloor, authoritySignature: signature, authorityEpoch: journal.authorityEpoch + 1,
    capabilityEpoch: journal.capabilityEpoch + 1, operation: invalidate() }; emit(); return journal.authorityEpoch;
}
export function observePsychosocialAssessmentSnapshot(scope: PsychosocialScope, demo: boolean, snapshot: PsychosocialAssessmentSnapshot | null, capabilities: PsychosocialCapabilities) {
  const identity = demo ? null : psychosocialAssessmentScopeIdentity(scope, false); if (identity !== currentIdentity()) return false;
  let next: typeof admission = null;
  if (snapshot && !demo && !snapshot.demo && readable(identity!)) {
    const value = normalizePsychosocialSnapshot(snapshot, scope);
    const allowed = capabilitiesSchema.parse(capabilities);
    if (journal.snapshotFloor && Date.parse(value.generatedAt) <= Date.parse(journal.snapshotFloor) || journal.acceptedSnapshotAt && Date.parse(value.generatedAt) < Date.parse(journal.acceptedSnapshotAt)) return false;
    const clients = [...new Set([...value.clientOptions.map((item) => item.clientId), ...value.items.map((item) => item.clientId)])].sort();
    next = { identity: identity!, fingerprint: JSON.stringify([identity, clients, allowed]), generatedAt: value.generatedAt, staleAfter: value.staleAfter, clients,
      capabilities: allowed, sources: new Map(value.items.map((item) => [item.clientId, deepFreeze(item)])) };
  }
  const lostClients = admission && next && admission.clients.some((clientId) => !next.clients.includes(clientId));
  // Assignment loss is a clinical visibility boundary even with unchanged scopes.
  if (lostClients && next && Date.parse(next.generatedAt) <= Date.parse(admission!.generatedAt)) {
    journal = { ...journal, snapshotFloor: floorAt(admission!.generatedAt), operation: invalidate(), capabilityEpoch: journal.capabilityEpoch + 1 }; admission = null; emit(); return false;
  }
  const changed = admission?.fingerprint !== next?.fingerprint; const floorCleared = next !== null && journal.snapshotFloor !== null;
  const generationChanged = next !== null && next.generatedAt !== journal.acceptedSnapshotAt; admission = next;
  if (changed || floorCleared || generationChanged) {
    journal = { ...journal, snapshotFloor: floorCleared ? null : journal.snapshotFloor, acceptedSnapshotAt: next?.generatedAt ?? journal.acceptedSnapshotAt,
      capabilityEpoch: journal.capabilityEpoch + Number(changed), operation: changed ? invalidate() : journal.operation }; emit();
  }
  return true;
}
export function beginPsychosocialAssessment(scope: PsychosocialScope, demo: boolean, value: PsychosocialInput, snapshotAt: string, target?: PsychosocialAssessmentListItem): PsychosocialOperation | null {
  if (demo || journal.operation || journal.confirmed.length >= 32 || hasPendingOperations() || hasViewTransition()) return null;
  const normalizedScope = scopeSchema.parse(scope); const identity = psychosocialAssessmentScopeIdentity(normalizedScope, false);
  const bodyInput = psychosocialAssessmentRequestBody(value);
  const input = deepFreeze(value.action === "create_draft" ? parseCreatePsychosocialDraft(bodyInput, value.idempotencyKey) : parsePsychosocialAssessmentMutation(bodyInput, value.idempotencyKey));
  if (!isStrictOffsetDateTime(snapshotAt)) throw new Error("INVALID_PSYCHOSOCIAL_SOURCE_TIME");
  const sourceAt = new Date(snapshotAt).toISOString(); const source = admission?.sources.get(input.clientId) ?? null;
  if (!permitted(input.action, identity, input.clientId, true) || admission!.generatedAt !== sourceAt ||
    journal.confirmed.some((entry) => entry.identity === identity && entry.clientId === input.clientId)) return null;
  const proof = target && source && JSON.stringify(source) === JSON.stringify(target) ? deepFreeze(structuredClone(source)) : null;
  if (input.action === "create_draft" ? target !== undefined : !proof || proof.versionId !== input.previousVersionId || proof.assessmentKey !== input.assessmentKey || proof.assessmentVersion !== input.expectedVersion ||
    (input.action === "correct" ? proof.recordState !== "signed" && proof.recordState !== "corrected" : proof.recordState !== "draft")) throw new Error("INVALID_PSYCHOSOCIAL_SOURCE_BINDING");
  const body = JSON.stringify(psychosocialAssessmentRequestBody(input)); if (new TextEncoder().encode(body).byteLength > 32 * 1024) return null;
  const checkpoint = { privacyEpoch: journal.privacyEpoch, authorityEpoch: journal.authorityEpoch, capabilityEpoch: journal.capabilityEpoch };
  const lease = tryAcquirePendingOperation(); if (!lease) return null;
  if (journal.operation || checkpoint.privacyEpoch !== journal.privacyEpoch || checkpoint.authorityEpoch !== journal.authorityEpoch || checkpoint.capabilityEpoch !== journal.capabilityEpoch || !permitted(input.action, identity, input.clientId, true)) { lease(); return null; }
  const token = Symbol();
  try {
    const operation: PsychosocialOperation = Object.freeze({ token, attempt: Symbol(), identity, scope: Object.freeze(normalizedScope), input, body, snapshotAt: sourceAt, target: proof,
      phase: "sending", everUnknown: false, ...checkpoint, authoritySignature: journal.authoritySignature! });
    release = lease; journal = { ...journal, operation, navigationBlocked: false };
    removeGuards = installPendingNavigationGuard({ hasPendingOperation: () => journal.operation !== null, permittedFormAttribute: "data-psychosocial-assessment-form",
      onBlocked: () => { journal = { ...journal, navigationBlocked: true }; emit(); } }); emit(); return journal.operation === operation ? operation : null;
  } catch (error) { if (journal.operation?.token === token) journal = { ...journal, operation: null, navigationBlocked: false }; if (release === lease) unlock(); else lease(); throw error; }
}
export function retryPsychosocialAssessment(token: symbol, scope: PsychosocialScope, demo: boolean) {
  const current = journal.operation;
  if (!current || current.token !== token || current.phase !== "unknown" || demo || hasViewTransition() || current.identity !== psychosocialAssessmentScopeIdentity(scope, false) || !permitted(current.input.action, current.identity, current.input.clientId)) return null;
  const operation = Object.freeze({ ...current, attempt: Symbol(), phase: "sending" as const, privacyEpoch: journal.privacyEpoch, authorityEpoch: journal.authorityEpoch,
    capabilityEpoch: journal.capabilityEpoch, authoritySignature: journal.authoritySignature! }); journal = { ...journal, operation }; emit(); return journal.operation === operation ? operation : null;
}
export function settlePsychosocialAssessment(operation: PsychosocialOperation, result: "unknown" | "denied" | ReturnType<typeof parsePsychosocialActionSuccess>) {
  const current = journal.operation;
  if (current !== operation || current.identity !== currentIdentity() || current.privacyEpoch !== journal.privacyEpoch || current.authorityEpoch !== journal.authorityEpoch || current.capabilityEpoch !== journal.capabilityEpoch || current.authoritySignature !== journal.authoritySignature) return false;
  if (result === "unknown" || !permitted(current.input.action, current.identity, current.input.clientId) || result === "denied" && current.everUnknown) {
    journal = { ...journal, operation: Object.freeze({ ...current, phase: "unknown", everUnknown: true, attempt: Symbol() }) }; emit(); return true;
  }
  let confirmed: Confirmed | null = null;
  if (typeof result === "object") {
    const receipt = parsePsychosocialActionSuccess(result, current.input, result.data.replayed ? 200 : 201).data;
    const source = current.target; const expectedDate = current.input.action === "sign" ? source!.assessedOn : current.input.assessedOn;
    const expectedDue = current.input.action === "sign" ? source!.reassessmentDueOn : current.input.reassessmentDueOn;
    if (receipt.assessedOn !== expectedDate || receipt.reassessmentDueOn !== expectedDue || receipt.responsibleUserId !== (source?.responsibleUserId ?? current.scope.userId) ||
      source && (receipt.versionId === source.versionId || receipt.serviceStatusAtAssessment !== source.serviceStatusAtAssessment)) throw new Error("INVALID_PSYCHOSOCIAL_RECEIPT_SOURCE_BINDING");
    confirmed = Object.freeze({ identity: current.identity, clientId: receipt.clientId, assessmentKey: receipt.assessmentKey, versionId: receipt.versionId, version: receipt.assessmentVersion,
      state: receipt.recordState, committedAt: receipt.committedAt, snapshotAt: current.snapshotAt });
  }
  journal = { ...journal, operation: null, navigationBlocked: false, confirmed: confirmed ? [...journal.confirmed, confirmed] : journal.confirmed }; unlock(); emit(); return true;
}
export function reconcilePsychosocialAssessmentConfirmed(scope: PsychosocialScope, snapshot: PsychosocialAssessmentSnapshot, now: number) {
  if (!Number.isFinite(now) || snapshot.demo) return; const identity = psychosocialAssessmentScopeIdentity(scope, false); if (!readable(identity)) return;
  let value: PsychosocialAssessmentSnapshot; try { value = normalizePsychosocialSnapshot(snapshot, scope); } catch { return; }
  if (now < Date.parse(value.generatedAt) || now >= Date.parse(value.staleAfter) || journal.snapshotFloor && Date.parse(value.generatedAt) <= Date.parse(journal.snapshotFloor) || journal.acceptedSnapshotAt && Date.parse(value.generatedAt) < Date.parse(journal.acceptedSnapshotAt)) return;
  const confirmed = journal.confirmed.filter((entry) => entry.identity !== identity || Date.parse(value.generatedAt) <= Date.parse(entry.snapshotAt) || Date.parse(value.generatedAt) < Date.parse(entry.committedAt) ||
    !value.items.some((item) => item.clientId === entry.clientId && item.assessmentKey === entry.assessmentKey && item.versionHistory.some((version) => version.versionId === entry.versionId &&
      version.assessmentVersion === entry.version && version.recordState === entry.state && version.createdAt === entry.committedAt)));
  if (confirmed.length !== journal.confirmed.length) { journal = { ...journal, confirmed }; emit(); }
}
export function clearPsychosocialAssessmentPendingOnLogout() {
  const snapshotFloor = floorAt(admission?.generatedAt ?? journal.acceptedSnapshotAt ?? journal.operation?.snapshotAt ?? null); admission = null;
  journal = { ...EMPTY, snapshotFloor, acceptedSnapshotAt: journal.acceptedSnapshotAt, privacyEpoch: journal.privacyEpoch + 1, authorityEpoch: journal.authorityEpoch + 1, capabilityEpoch: journal.capabilityEpoch + 1 }; unlock(); emit();
}
export function isConfirmedPsychosocialAssessmentRejection(raw: unknown, status: number) {
  const envelope = parsePsychosocialActionError(raw); const allowed: Record<number, readonly string[]> = {
    400: ["INVALID_PSYCHOSOCIAL_ASSESSMENT", "INVALID_JSON"], 401: ["AUTH_REQUIRED"], 403: ["DEMO_READ_ONLY", "PSYCHOSOCIAL_NOT_AUTHORIZED", "AAL2_REQUIRED"],
    409: ["PSYCHOSOCIAL_VERSION_CONFLICT", "PSYCHOSOCIAL_IDEMPOTENCY_CONFLICT", "PSYCHOSOCIAL_STATE_CONFLICT"], 413: ["REQUEST_TOO_LARGE"] };
  return !!envelope && envelope.errors.every((error) => allowed[status]?.includes(error.code));
}
