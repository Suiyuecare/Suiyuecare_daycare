"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquirePendingRecoveryRead } from "@/lib/navigation/pending-operation-lock";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";
import { canonicalNursingJson, nursingContentSchema, parseNursingReceipt, parseNursingRequest, projectNursingAssessmentSnapshot } from "./parser";
import type { NursingAssessmentSnapshot, NursingContent, NursingReceipt, NursingRequest, NursingVersion } from "./types";
import { nursingReadAuthoritySignature } from "./read-authority";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().max(64).refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
export type NursingAssessmentScope = { organizationId: string; branchId: string; userId: string };
const scopeSchema = z.object({ organizationId: uuid, branchId: uuid, userId: uuid }).strict();
const authoritySchema = z.tuple([z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.boolean()]),
  z.array(z.string()), z.array(z.string()), z.enum(["aal1", "aal2"]), timestamp.nullable()]);
export function nursingAssessmentScopeIdentity(scope: NursingAssessmentScope, demo: boolean) {
  const value = scopeSchema.parse(scope);
  return JSON.stringify([value.organizationId, value.branchId, value.userId, demo]);
}
/** The shell and workspace share one authority signature. Assignment and local
 * capability changes remain separate UI epochs, not competing global observers. */
export function nursingAssessmentAuthoritySignature(context: TenantContext) {
  return nursingReadAuthoritySignature(context);
}
function parseAuthority(signature: string) {
  if (!signature || signature.length > 20_000) throw new Error("INVALID_NURSING_AUTHORITY");
  const parsed = authoritySchema.parse(JSON.parse(signature));
  if (!parsed[0][3]) scopeSchema.parse({ organizationId: parsed[0][0], branchId: parsed[0][1], userId: parsed[0][2] });
  return parsed;
}
function authorityIdentity(signature: string | null) { return signature ? JSON.stringify(parseAuthority(signature)[0]) : null; }
function permitted(action: NursingRequest["action"] | "read", identity: string) {
  if (!journal.authoritySignature) return false;
  const [scope, roles, scopes, aal, recentAt] = parseAuthority(journal.authoritySignature);
  if (JSON.stringify(scope) !== identity || scope[3] || aal !== "aal2" ||
    !scopes.includes("clients.read") || !scopes.includes("nursing_assessments.read")) return false;
  if (action === "read") return true;
  if (!roles.includes("nurse")) return false;
  const signing = action === "sign" || action === "correct";
  if (!scopes.includes(signing ? "nursing_assessments.sign" : "nursing_assessments.manage")) return false;
  const age = recentAt === null ? Infinity : Date.now() - Date.parse(recentAt);
  return !signing || age >= 0 && age <= 15 * 60_000;
}
export type NursingAssessmentCapabilities = { canManage: boolean; canSign: boolean; hasRecentAal2: boolean };
const capabilitiesSchema = z.object({ canManage: z.boolean(), canSign: z.boolean(), hasRecentAal2: z.boolean() }).strict();
function admittedFor(action: NursingRequest["action"], identity: string, clientId: string) {
  if (!permitted(action, identity) || !admission || admission.identity !== identity || !admission.clients.includes(clientId) ||
    Date.now() < Date.parse(admission.generatedAt) || Date.now() >= Date.parse(admission.staleAfter)) return false;
  return action === "sign" || action === "correct" ? admission.capabilities.canSign && admission.capabilities.hasRecentAal2 : admission.capabilities.canManage;
}
export type NursingAssessmentInput = Readonly<{ request: NursingRequest; idempotencyKey: string }>;
export type NursingAssessmentTarget = Readonly<{ clientId: string; assessmentKey: string; versionId: string;
  version: number; contentHash: string; state: NursingVersion["state"]; content: NursingContent }>;
const targetSchema = z.object({ clientId: uuid, assessmentKey: uuid, versionId: uuid,
  version: z.number().int().positive().safe(), contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
  state: z.enum(["draft", "signed", "corrected"]), content: nursingContentSchema }).strict();
export type NursingAssessmentOperation = Readonly<{ token: symbol; attempt: symbol; identity: string;
  scope: Readonly<NursingAssessmentScope>; input: NursingAssessmentInput; body: string; snapshotAt: string;
  target: NursingAssessmentTarget | null; phase: "sending" | "unknown"; everUnknown: boolean;
  privacyEpoch: number; authorityEpoch: number; capabilityEpoch: number; authoritySignature: string }>;
export type NursingAssessmentConfirmed = Readonly<{ identity: string; clientId: string; assessmentKey: string;
  versionId: string; version: number; state: NursingVersion["state"]; committedAt: string; snapshotAt: string }>;
type Journal = Readonly<{ operation: NursingAssessmentOperation | null; confirmed: readonly NursingAssessmentConfirmed[];
  navigationBlocked: boolean; privacyEpoch: number; authorityEpoch: number; capabilityEpoch: number; authoritySignature: string | null;
  snapshotFloor: string | null; acceptedSnapshotAt: string | null }>;
const EMPTY: Journal = { operation: null, confirmed: [], navigationBlocked: false, privacyEpoch: 0, authorityEpoch: 0, capabilityEpoch: 0,
  authoritySignature: null, snapshotFloor: null, acceptedSnapshotAt: null };
let journal: Journal = EMPTY;
let admission: { identity: string; fingerprint: string; generatedAt: string; staleAfter: string; clients: string[];
  capabilities: NursingAssessmentCapabilities; sources: Map<string, NursingAssessmentSnapshot["clients"][number]> } | null = null;
let release: (() => void) | null = null;
let removeGuards: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getNursingAssessmentPending = () => journal;
export function useNursingAssessmentPending() { return useSyncExternalStore(subscribe, getNursingAssessmentPending, () => EMPTY); }
export function getNursingAssessmentSnapshotAdmission(scope: NursingAssessmentScope, demo: boolean) {
  if (demo) return null;
  const identity = nursingAssessmentScopeIdentity(scope, false);
  return permitted("read", identity) && admission?.identity === identity ? admission.generatedAt : null;
}
export function tryAcquireNursingAssessmentRecoveryRead(scope: NursingAssessmentScope, demo: boolean): (() => void) | null {
  if (demo || hasViewTransition()) return null;
  const identity = nursingAssessmentScopeIdentity(scope, false);
  if (identity !== authorityIdentity(journal.authoritySignature)) return null;
  const before = journal;
  if (journal.operation && (journal.operation.phase !== "unknown" || journal.operation.identity !== identity || !release)) return null;
  const lease = tryAcquirePendingRecoveryRead(journal.operation ? release! : undefined);
  if (lease && (before.operation !== journal.operation || before.privacyEpoch !== journal.privacyEpoch || before.authorityEpoch !== journal.authorityEpoch ||
    before.capabilityEpoch !== journal.capabilityEpoch || identity !== authorityIdentity(journal.authoritySignature))) { lease(); return null; }
  return lease;
}
function floorAt(source: string | null) {
  return source && (!journal.snapshotFloor || Date.parse(source) > Date.parse(journal.snapshotFloor)) ? source : journal.snapshotFloor;
}
function invalidate() {
  return journal.operation ? Object.freeze({ ...journal.operation, phase: "unknown" as const, everUnknown: true, attempt: Symbol() }) : null;
}
export function quarantineNursingAssessmentSnapshot(scope: NursingAssessmentScope, demo: boolean) {
  if (demo || nursingAssessmentScopeIdentity(scope, false) !== authorityIdentity(journal.authoritySignature)) return false;
  const hadAdmission = admission !== null;
  const source = admission?.generatedAt ?? journal.acceptedSnapshotAt ?? journal.operation?.snapshotAt ?? null;
  admission = null;
  const floor = floorAt(source);
  if (floor === journal.snapshotFloor && !hadAdmission) return true;
  journal = { ...journal, snapshotFloor: floor, capabilityEpoch: journal.capabilityEpoch + 1, operation: invalidate() }; emit(); return true;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  return value;
}
function unlock() {
  const held = release; const guards = removeGuards; release = null; removeGuards = null;
  try { guards?.(); } finally { held?.(); }
}
export function observeNursingAssessmentAuthority(signature: string) {
  const next = parseAuthority(signature);
  if (signature === journal.authoritySignature) return journal.authorityEpoch;
  const previous = journal.authoritySignature ? parseAuthority(journal.authoritySignature) : null;
  const canRead = (value: ReturnType<typeof parseAuthority>) => !value[0][3] && value[3] === "aal2" &&
    value[2].includes("clients.read") && value[2].includes("nursing_assessments.read");
  const boundary = previous && (JSON.stringify(previous[0]) !== JSON.stringify(next[0]) || canRead(previous) && !canRead(next));
  const source = admission?.generatedAt ?? journal.acceptedSnapshotAt ?? journal.operation?.snapshotAt ?? null;
  admission = null;
  journal = { ...journal, snapshotFloor: boundary ? floorAt(source) : journal.snapshotFloor, authoritySignature: signature,
    authorityEpoch: journal.authorityEpoch + 1, capabilityEpoch: journal.capabilityEpoch + 1, operation: invalidate() };
  emit(); return journal.authorityEpoch;
}
/** An admitted, fresh server projection is required for clinical visibility and
 * every write/retry. Generation floors survive remount, revoke/restore and logout. */
export function observeNursingAssessmentSnapshot(scope: NursingAssessmentScope, demo: boolean,
  snapshot: NursingAssessmentSnapshot | null, capabilities: NursingAssessmentCapabilities) {
  const identity = demo ? null : nursingAssessmentScopeIdentity(scope, false);
  if (identity !== authorityIdentity(journal.authoritySignature)) return false;
  if (!snapshot || demo || !permitted("read", identity!)) {
    if (admission) { const source = admission.generatedAt; admission = null;
      journal = { ...journal, snapshotFloor: floorAt(source), capabilityEpoch: journal.capabilityEpoch + 1, operation: invalidate() }; emit(); }
    return false;
  }
  const value = projectNursingAssessmentSnapshot(snapshot, scope.organizationId.toLowerCase(), scope.branchId.toLowerCase());
  const allowed = capabilitiesSchema.parse(capabilities);
  if (Date.now() < Date.parse(value.generatedAt) || journal.snapshotFloor && Date.parse(value.generatedAt) <= Date.parse(journal.snapshotFloor) ||
    journal.acceptedSnapshotAt && Date.parse(value.generatedAt) < Date.parse(journal.acceptedSnapshotAt)) return false;
  const clients = value.clients.map(item => item.clientId).sort();
  const lostClients = admission && admission.clients.some(clientId => !clients.includes(clientId));
  if (lostClients && Date.parse(value.generatedAt) <= Date.parse(admission!.generatedAt)) {
    const source = admission!.generatedAt; admission = null;
    journal = { ...journal, snapshotFloor: floorAt(source), capabilityEpoch: journal.capabilityEpoch + 1, operation: invalidate() }; emit(); return false;
  }
  const fingerprint = JSON.stringify([identity, clients, allowed]);
  const changed = admission?.fingerprint !== fingerprint;
  admission = { identity: identity!, fingerprint, generatedAt: value.generatedAt, staleAfter: value.staleAfter, clients, capabilities: allowed,
    sources: new Map(value.clients.map(item => [item.clientId, deepFreeze(item)])) };
  if (changed || journal.snapshotFloor !== null || journal.acceptedSnapshotAt !== value.generatedAt) {
    journal = { ...journal, snapshotFloor: null, acceptedSnapshotAt: value.generatedAt,
      capabilityEpoch: journal.capabilityEpoch + Number(changed), operation: changed ? invalidate() : journal.operation }; emit();
  }
  return true;
}
/** One immutable tab-local clinical request. No browser storage, automatic
 * replay, offline queue, history mutation, or promise of full-reload recovery. */
export function beginNursingAssessment(scope: NursingAssessmentScope, demo: boolean, value: NursingAssessmentInput,
  snapshotAt: string, target?: NursingAssessmentTarget): NursingAssessmentOperation | null {
  if (demo || journal.operation || journal.confirmed.length >= 32 || hasPendingOperations() || hasViewTransition()) return null;
  const normalizedScope = scopeSchema.parse(scope); const identity = nursingAssessmentScopeIdentity(normalizedScope, false);
  const input = deepFreeze(parseNursingRequest(value.request, value.idempotencyKey));
  if (!admittedFor(input.request.action, identity, input.request.clientId) ||
    journal.confirmed.some((entry) => entry.identity === identity && entry.clientId === input.request.clientId)) return null;
  const sourceAt = timestamp.parse(snapshotAt); const proof = target ? deepFreeze(targetSchema.parse(target)) : null;
  const request = input.request;
  if (sourceAt !== admission!.generatedAt) return null;
  const source = admission!.sources.get(request.clientId)?.versions[0];
  if (request.action === "create_draft" ? proof !== null : !proof || proof.clientId !== request.clientId ||
    proof.assessmentKey !== request.assessmentKey || proof.versionId !== request.previousVersionId ||
    proof.version !== request.expectedVersion || proof.contentHash !== request.expectedContentHash ||
    (request.action === "correct" ? proof.state === "draft" : proof.state !== "draft") || !source ||
    source.versionId !== proof.versionId || source.assessmentKey !== proof.assessmentKey || source.version !== proof.version ||
    source.contentHash !== proof.contentHash || source.state !== proof.state ||
    canonicalNursingJson(source.content) !== canonicalNursingJson(proof.content)) throw new Error("INVALID_NURSING_SOURCE_BINDING");
  const body = JSON.stringify(request);
  if (new TextEncoder().encode(body).byteLength > 128 * 1024) return null;
  const sourceAdmission = admission;
  const checkpoint = { privacyEpoch: journal.privacyEpoch, authorityEpoch: journal.authorityEpoch,
    capabilityEpoch: journal.capabilityEpoch, authoritySignature: journal.authoritySignature };
  const lease = tryAcquirePendingOperation(); if (!lease) return null;
  // Acquiring the shared lease notifies other consumers synchronously. A scope
  // or logout observer triggered there must invalidate admission before POST.
  if (journal.operation || sourceAdmission !== admission || checkpoint.privacyEpoch !== journal.privacyEpoch || checkpoint.authorityEpoch !== journal.authorityEpoch ||
    checkpoint.capabilityEpoch !== journal.capabilityEpoch || checkpoint.authoritySignature !== journal.authoritySignature ||
    !admittedFor(request.action, identity, request.clientId)) { lease(); return null; }
  const token = Symbol();
  try {
    const operation: NursingAssessmentOperation = Object.freeze({ token, attempt: Symbol(), identity, scope: Object.freeze(normalizedScope), input,
      body, snapshotAt: sourceAt, target: proof, phase: "sending", everUnknown: false,
      privacyEpoch: journal.privacyEpoch, authorityEpoch: journal.authorityEpoch, capabilityEpoch: journal.capabilityEpoch,
      authoritySignature: journal.authoritySignature! });
    release = lease; journal = { ...journal, operation, navigationBlocked: false };
    removeGuards = installPendingNavigationGuard({ hasPendingOperation: () => journal.operation !== null,
      permittedFormAttribute: "data-nursing-assessment-form", onBlocked: () => { journal = { ...journal, navigationBlocked: true }; emit(); } });
    emit(); return journal.operation === operation ? operation : null;
  } catch (error) {
    if (journal.operation?.token === token) journal = { ...journal, operation: null, navigationBlocked: false };
    if (release === lease) unlock(); else lease();
    throw error;
  }
}
export function retryNursingAssessment(token: symbol, scope: NursingAssessmentScope, demo: boolean): NursingAssessmentOperation | null {
  const current = journal.operation;
  if (!current || current.token !== token || current.phase !== "unknown" || demo || hasViewTransition() ||
    current.identity !== nursingAssessmentScopeIdentity(scope, false) || !admittedFor(current.input.request.action, current.identity, current.input.request.clientId)) return null;
  const operation = Object.freeze({ ...current, phase: "sending" as const, attempt: Symbol(), privacyEpoch: journal.privacyEpoch,
    authorityEpoch: journal.authorityEpoch, capabilityEpoch: journal.capabilityEpoch, authoritySignature: journal.authoritySignature! });
  journal = { ...journal, operation }; emit(); return journal.operation === operation ? operation : null;
}
export function settleNursingAssessment(operation: NursingAssessmentOperation, result: "unknown" | "denied" | NursingReceipt) {
  const current = journal.operation;
  if (current !== operation || current.privacyEpoch !== journal.privacyEpoch || current.authorityEpoch !== journal.authorityEpoch ||
    current.capabilityEpoch !== journal.capabilityEpoch || current.authoritySignature !== journal.authoritySignature || current.identity !== authorityIdentity(journal.authoritySignature)) return false;
  if (result === "unknown" || !admittedFor(current.input.request.action, current.identity, current.input.request.clientId) || result === "denied" && current.everUnknown) {
    journal = { ...journal, operation: Object.freeze({ ...current, phase: "unknown", everUnknown: true, attempt: Symbol() }) }; emit(); return true;
  }
  let confirmed: NursingAssessmentConfirmed | null = null;
  if (typeof result === "object") {
    const receipt = parseNursingReceipt(result, { ...current.input, ...current.scope, actorUserId: current.scope.userId });
    if (current.target && (receipt.result.versionId === current.target.versionId ||
      current.input.request.action === "sign" && canonicalNursingJson(receipt.result.content) !== canonicalNursingJson(current.target.content))) {
      throw new Error("INVALID_NURSING_RECEIPT_SOURCE_BINDING");
    }
    confirmed = Object.freeze({ identity: current.identity, clientId: current.input.request.clientId,
      assessmentKey: receipt.result.assessmentKey, versionId: receipt.result.versionId, version: receipt.result.version,
      state: receipt.result.state, committedAt: timestamp.parse(receipt.result.createdAt), snapshotAt: current.snapshotAt });
  }
  journal = { ...journal, operation: null, navigationBlocked: false, confirmed: confirmed ? [...journal.confirmed, confirmed] : journal.confirmed };
  unlock(); emit(); return true;
}
/** Positive fresh same-chain evidence only. Missing/truncated lists and a queued
 * refresh never prove the saved record is absent or that it may be recreated. */
export function reconcileNursingAssessmentConfirmed(scope: NursingAssessmentScope, snapshot: NursingAssessmentSnapshot, now: number) {
  if (!Number.isFinite(now) || snapshot.demo || snapshot.clientsTruncated) return;
  const normalized = scopeSchema.parse(scope); const identity = nursingAssessmentScopeIdentity(normalized, false);
  if (!permitted("read", identity)) return;
  let value: NursingAssessmentSnapshot;
  try { value = projectNursingAssessmentSnapshot(snapshot, normalized.organizationId, normalized.branchId); } catch { return; }
  if (now < Date.parse(value.generatedAt) || now >= Date.parse(value.staleAfter) ||
    journal.snapshotFloor && Date.parse(value.generatedAt) <= Date.parse(journal.snapshotFloor) ||
    journal.acceptedSnapshotAt && Date.parse(value.generatedAt) < Date.parse(journal.acceptedSnapshotAt)) return;
  const confirmed = journal.confirmed.filter((entry) => entry.identity !== identity ||
    Date.parse(value.generatedAt) < Math.max(Date.parse(entry.committedAt), Date.parse(entry.snapshotAt)) ||
    !value.clients.some((client) => client.clientId === entry.clientId && !client.versionsTruncated && client.versions.some((version) =>
      version.assessmentKey === entry.assessmentKey && (version.version > entry.version ||
        version.version === entry.version && version.versionId === entry.versionId && version.state === entry.state))));
  if (confirmed.length !== journal.confirmed.length) { journal = { ...journal, confirmed }; emit(); }
}
export function clearNursingAssessmentPendingOnLogout() {
  const snapshotFloor = floorAt(admission?.generatedAt ?? journal.acceptedSnapshotAt ?? journal.operation?.snapshotAt ?? null); admission = null;
  journal = { ...EMPTY, snapshotFloor, acceptedSnapshotAt: journal.acceptedSnapshotAt, privacyEpoch: journal.privacyEpoch + 1,
    authorityEpoch: journal.authorityEpoch + 1, capabilityEpoch: journal.capabilityEpoch + 1 }; unlock(); emit();
}
export function isConfirmedNursingAssessmentRejection(raw: unknown, status: number) {
  const envelope = z.object({ requestId: uuid, status: z.literal("error"), data: z.null(), errors: z.array(z.object({
    code: z.string(), message: z.string().max(500), field: z.string().max(120).optional() }).strict()).min(1).max(20) }).strict().safeParse(raw);
  const allowed: Record<number, readonly string[]> = {
    400: ["INVALID_NURSING_ASSESSMENT", "INVALID_JSON"], 401: ["AUTH_REQUIRED"],
    403: ["DEMO_READ_ONLY", "NURSING_NOT_AUTHORIZED", "AAL2_REQUIRED"],
    409: ["NURSING_VERSION_CONFLICT", "NURSING_IDEMPOTENCY_CONFLICT", "NURSING_STATE_CONFLICT"],
    413: ["REQUEST_TOO_LARGE"],
  };
  return envelope.success && envelope.data.errors.every((error) => allowed[status]?.includes(error.code));
}
