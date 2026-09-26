"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";
import { canonicalNursingJson, nursingContentSchema, parseNursingReceipt, parseNursingRequest, projectNursingAssessmentSnapshot } from "./parser";
import type { NursingAssessmentSnapshot, NursingContent, NursingReceipt, NursingRequest, NursingVersion } from "./types";

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
  return JSON.stringify([[context.organizationId.toLowerCase(), context.branchId.toLowerCase(), context.userId.toLowerCase(), context.demo],
    [...new Set(context.roles)].sort(), [...new Set(context.scopes)].sort(), context.assuranceLevel,
    context.recentAal2At === null ? null : timestamp.parse(context.recentAal2At)]);
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
  if (JSON.stringify(scope) !== identity || scope[3] || !roles.includes("nurse") || aal !== "aal2" ||
    !scopes.includes("clients.read") || !scopes.includes("nursing_assessments.read")) return false;
  if (action === "read") return true;
  const signing = action === "sign" || action === "correct";
  if (!scopes.includes(signing ? "nursing_assessments.sign" : "nursing_assessments.manage")) return false;
  const age = recentAt === null ? Infinity : Date.now() - Date.parse(recentAt);
  return !signing || age >= 0 && age <= 15 * 60_000;
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
  privacyEpoch: number; authorityEpoch: number; authoritySignature: string }>;
export type NursingAssessmentConfirmed = Readonly<{ identity: string; clientId: string; assessmentKey: string;
  versionId: string; version: number; state: NursingVersion["state"]; committedAt: string; snapshotAt: string }>;
type Journal = Readonly<{ operation: NursingAssessmentOperation | null; confirmed: readonly NursingAssessmentConfirmed[];
  navigationBlocked: boolean; privacyEpoch: number; authorityEpoch: number; authoritySignature: string | null }>;
const EMPTY: Journal = { operation: null, confirmed: [], navigationBlocked: false, privacyEpoch: 0, authorityEpoch: 0, authoritySignature: null };
let journal: Journal = EMPTY;
let release: (() => void) | null = null;
let removeGuards: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getNursingAssessmentPending = () => journal;
export function useNursingAssessmentPending() { return useSyncExternalStore(subscribe, getNursingAssessmentPending, () => EMPTY); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  return value;
}
function unlock() {
  const held = release; const guards = removeGuards; release = null; removeGuards = null;
  try { guards?.(); } finally { held?.(); }
}
export function observeNursingAssessmentAuthority(signature: string) {
  parseAuthority(signature);
  if (signature === journal.authoritySignature) return journal.authorityEpoch;
  journal = { ...journal, authoritySignature: signature, authorityEpoch: journal.authorityEpoch + 1,
    operation: journal.operation ? Object.freeze({ ...journal.operation, phase: "unknown" as const, everUnknown: true, attempt: Symbol() }) : null };
  emit(); return journal.authorityEpoch;
}
/** One immutable tab-local clinical request. No browser storage, automatic
 * replay, offline queue, history mutation, or promise of full-reload recovery. */
export function beginNursingAssessment(scope: NursingAssessmentScope, demo: boolean, value: NursingAssessmentInput,
  snapshotAt: string, target?: NursingAssessmentTarget): NursingAssessmentOperation | null {
  if (demo || journal.operation || journal.confirmed.length >= 32 || hasPendingOperations() || hasViewTransition()) return null;
  const normalizedScope = scopeSchema.parse(scope); const identity = nursingAssessmentScopeIdentity(normalizedScope, false);
  const input = deepFreeze(parseNursingRequest(value.request, value.idempotencyKey));
  if (!permitted(input.request.action, identity) || journal.confirmed.some((entry) => entry.identity === identity && entry.clientId === input.request.clientId)) return null;
  const sourceAt = timestamp.parse(snapshotAt); const proof = target ? deepFreeze(targetSchema.parse(target)) : null;
  const request = input.request;
  if (request.action === "create_draft" ? proof !== null : !proof || proof.clientId !== request.clientId ||
    proof.assessmentKey !== request.assessmentKey || proof.versionId !== request.previousVersionId ||
    proof.version !== request.expectedVersion || proof.contentHash !== request.expectedContentHash ||
    (request.action === "correct" ? proof.state === "draft" : proof.state !== "draft")) throw new Error("INVALID_NURSING_SOURCE_BINDING");
  const body = JSON.stringify(request);
  if (new TextEncoder().encode(body).byteLength > 128 * 1024) return null;
  const checkpoint = { privacyEpoch: journal.privacyEpoch, authorityEpoch: journal.authorityEpoch, authoritySignature: journal.authoritySignature };
  const lease = tryAcquirePendingOperation(); if (!lease) return null;
  // Acquiring the shared lease notifies other consumers synchronously. A scope
  // or logout observer triggered there must invalidate admission before POST.
  if (journal.operation || checkpoint.privacyEpoch !== journal.privacyEpoch || checkpoint.authorityEpoch !== journal.authorityEpoch ||
    checkpoint.authoritySignature !== journal.authoritySignature || !permitted(request.action, identity)) { lease(); return null; }
  const token = Symbol();
  try {
    const operation: NursingAssessmentOperation = Object.freeze({ token, attempt: Symbol(), identity, scope: Object.freeze(normalizedScope), input,
      body, snapshotAt: sourceAt, target: proof, phase: "sending", everUnknown: false,
      privacyEpoch: journal.privacyEpoch, authorityEpoch: journal.authorityEpoch, authoritySignature: journal.authoritySignature! });
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
    current.identity !== nursingAssessmentScopeIdentity(scope, false) || !permitted(current.input.request.action, current.identity)) return null;
  const operation = Object.freeze({ ...current, phase: "sending" as const, attempt: Symbol(), privacyEpoch: journal.privacyEpoch,
    authorityEpoch: journal.authorityEpoch, authoritySignature: journal.authoritySignature! });
  journal = { ...journal, operation }; emit(); return journal.operation === operation ? operation : null;
}
export function settleNursingAssessment(operation: NursingAssessmentOperation, result: "unknown" | "denied" | NursingReceipt) {
  const current = journal.operation;
  if (current !== operation || current.privacyEpoch !== journal.privacyEpoch || current.authorityEpoch !== journal.authorityEpoch ||
    current.authoritySignature !== journal.authoritySignature || current.identity !== authorityIdentity(journal.authoritySignature)) return false;
  if (result === "unknown" || !permitted(current.input.request.action, current.identity) || result === "denied" && current.everUnknown) {
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
  if (now >= Date.parse(value.staleAfter)) return;
  const confirmed = journal.confirmed.filter((entry) => entry.identity !== identity ||
    Date.parse(value.generatedAt) < Math.max(Date.parse(entry.committedAt), Date.parse(entry.snapshotAt)) ||
    !value.clients.some((client) => client.clientId === entry.clientId && !client.versionsTruncated && client.versions.some((version) =>
      version.assessmentKey === entry.assessmentKey && (version.version > entry.version ||
        version.version === entry.version && version.versionId === entry.versionId && version.state === entry.state))));
  if (confirmed.length !== journal.confirmed.length) { journal = { ...journal, confirmed }; emit(); }
}
export function clearNursingAssessmentPendingOnLogout() {
  journal = { ...EMPTY, privacyEpoch: journal.privacyEpoch + 1, authorityEpoch: journal.authorityEpoch + 1 }; unlock(); emit();
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
