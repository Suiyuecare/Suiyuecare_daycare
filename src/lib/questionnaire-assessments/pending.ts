"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquirePendingRecoveryRead } from "@/lib/navigation/pending-operation-lock";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";
import { questionnaireDraftSchema, questionnaireFormKeySchema, questionnaireReceiptSchema } from "./contract";
import { parseQuestionnaireMutation, type QuestionnaireMutationInput } from "./mutation-contract";
import { parseQuestionnaireOperationReceipt } from "./operation-receipt";
import { canAdmitQuestionnaireViewSource, getQuestionnaireViewState, questionnaireReadPermission } from "./readiness-view";

const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const authoritySchema = z.tuple([uuid, uuid, uuid, z.array(z.string().min(1).max(100)).max(100),
  z.array(z.string().min(1).max(100)).max(1000), z.enum(["aal1", "aal2"]),
  z.string().datetime({ offset: true }).nullable(), z.boolean()]);
const scopeSchema = z.object({ authority: z.string().min(1).max(20_000), epoch: z.number().int().nonnegative().safe(),
  organizationId: uuid, branchId: uuid, actorUserId: uuid, clientId: uuid, formKey: questionnaireFormKeySchema }).strict();
export type QuestionnairePendingScope = Readonly<z.infer<typeof scopeSchema>>;
export type QuestionnairePendingInput = Readonly<{ request: unknown; idempotencyKey: string }>;
export type QuestionnairePendingOperation = Readonly<{ token: symbol; attempt: symbol; identity: string;
  scope: QuestionnairePendingScope; input: QuestionnairePendingInput; body: string; sourceAt: string;
  authority: string; epoch: number; privacyEpoch: number; phase: "sending" | "unknown"; everUnknown: boolean }>;
export type QuestionnairePendingConfirmed = Readonly<{ identity: string; operation: QuestionnairePendingOperation;
  receipt: Readonly<z.infer<typeof questionnaireReceiptSchema>> }>;
export type QuestionnairePendingJournal = Readonly<{ operation: QuestionnairePendingOperation | null;
  confirmed: readonly QuestionnairePendingConfirmed[]; navigationBlocked: boolean }>;
const EMPTY: QuestionnairePendingJournal = Object.freeze({ operation: null, confirmed: Object.freeze([]), navigationBlocked: false });
let journal: QuestionnairePendingJournal = EMPTY;
let authority: string | null = null, epoch = -1, privacyEpoch = 0;
type PendingSource = Readonly<{ identity: string; generatedAt: string }>;
let source: PendingSource | null = null;
// Only denial watermarks: no payloads, eviction or production reset hook.
const sourceFloors = new Map<string, number>();
let floorsExhausted = false;
let writeLease: (() => void) | null = null, removeGuards: (() => void) | null = null;
const normalized = new WeakMap<QuestionnairePendingOperation, QuestionnaireMutationInput>();
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let projectionCache: { journal: QuestionnairePendingJournal; source: PendingSource; key: string; value: QuestionnairePendingJournal } | null = null;

function signature(value: string) {
  if (value.length > 20_000) throw new Error("Invalid authority.");
  const tuple = authoritySchema.parse(JSON.parse(value));
  if (JSON.stringify([tuple[0], tuple[1], tuple[2], [...tuple[3]].sort(), [...tuple[4]].sort(), tuple[5], tuple[6], tuple[7]]) !== value) throw new Error("Invalid authority.");
  return tuple;
}
function identity(scope: QuestionnairePendingScope) {
  return JSON.stringify([scope.organizationId, scope.branchId, scope.actorUserId, scope.formKey, scope.clientId]);
}
function allowed(scope: QuestionnairePendingScope, manage = false): boolean {
  try {
    const parsed = scopeSchema.parse(scope), tuple = signature(parsed.authority), view = getQuestionnaireViewState();
    const read = questionnaireReadPermission(parsed.formKey);
    return !tuple[7] && tuple[0] === parsed.organizationId && tuple[1] === parsed.branchId && tuple[2] === parsed.actorUserId &&
      tuple[4].includes("clients.read") && tuple[4].includes(read) && (!manage || tuple[4].includes(read.replace(/\.read$/u, ".manage"))) &&
      authority === parsed.authority && epoch === parsed.epoch && view.signature === authority && view.epoch === epoch && !view.exhausted;
  } catch { return false; }
}
function admitted(scope: QuestionnairePendingScope, manage = false) {
  return !floorsExhausted && allowed(scope, manage) && source?.identity === identity(scope) &&
    Date.parse(source.generatedAt) > (sourceFloors.get(source.identity) ?? -Infinity) &&
    // Retained ownership is not a new/fresh authorization snapshot. Initial
    // admission is real-clock bounded below; ongoing ownership checks only the
    // existing epoch/floor/watermark. Every API/RPC still rechecks authority.
    canAdmitQuestionnaireViewSource(scope.authority, source.generatedAt, Date.parse(source.generatedAt));
}
function raiseSourceFloor() {
  if (!source) return;
  if (!sourceFloors.has(source.identity) && sourceFloors.size >= 128) { floorsExhausted = true; return; }
  sourceFloors.set(source.identity, Math.max(sourceFloors.get(source.identity) ?? -Infinity, Date.parse(source.generatedAt)));
}
function copyOperation(operation: QuestionnairePendingOperation, changes: Partial<QuestionnairePendingOperation>) {
  const next = Object.freeze({ ...operation, ...changes }); normalized.set(next, normalized.get(operation)!); return next;
}
function invalidate() {
  if (journal.operation) journal = { ...journal, operation: copyOperation(journal.operation, { phase: "unknown", everUnknown: true, attempt: Symbol() }) };
}
function unlock() {
  const held = writeLease, guards = removeGuards; writeLease = null; removeGuards = null;
  try { guards?.(); } finally { held?.(); }
}

/** Bounded plain JSON clone before property access/stringification. It retains
 * original ordering and text; normalization is private comparison only. */
function cloneWire(value: unknown): unknown {
  let nodes = 0, chars = 0;
  const ancestors = new WeakSet<object>();
  function clone(item: unknown, depth: number): unknown {
    if (++nodes > 10_000 || depth > 16) throw new Error("Invalid request.");
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item === "string") { chars += item.length; if (item.length > 65_536 || chars > 2_097_152) throw new Error("Invalid request."); return item; }
    if (!item || typeof item !== "object" || Array.isArray(item) || ancestors.has(item)) throw new Error("Invalid request.");
    const prototype = Object.getPrototypeOf(item), keys = Reflect.ownKeys(item);
    if (prototype !== Object.prototype && prototype !== null || keys.length > 10_000 || keys.some(key => typeof key !== "string")) throw new Error("Invalid request.");
    ancestors.add(item);
    try {
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("Invalid request.");
        Object.defineProperty(result, key, { value: clone(descriptor.value, depth + 1), enumerable: true });
      }
      return Object.freeze(result);
    } finally { ancestors.delete(item); }
  }
  return clone(value, 0);
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}
function instantMicros(value: string): bigint | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  const parsed = z.string().datetime({ offset: true }).safeParse(value);
  if (!parsed.success || !match) return null;
  const millis = Date.parse(`${match[1]}${match[3]}`);
  return Number.isSafeInteger(millis) ? BigInt(millis) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0")) : null;
}
function current(operation: QuestionnairePendingOperation, read = true) {
  const view = getQuestionnaireViewState();
  return journal.operation === operation && operation.privacyEpoch === privacyEpoch && operation.authority === authority && operation.epoch === epoch &&
    view.signature === authority && view.epoch === epoch && (!read || admitted({ ...operation.scope, authority: operation.authority, epoch: operation.epoch }));
}

/** The global view observer owns epoch/floor changes. This journal only reacts
 * to that exact state, retaining hidden original intent until explicit logout. */
export function observeQuestionnairePendingAuthority(value: string | null, nextEpoch: number) {
  const view = getQuestionnaireViewState();
  let valid: string | null = null;
  try { if (value && Number.isSafeInteger(nextEpoch) && nextEpoch >= 0 && view.signature === value && view.epoch === nextEpoch) { signature(value); valid = value; } } catch { /* Hide untrusted authority. */ }
  if (authority === valid && epoch === nextEpoch) return;
  raiseSourceFloor(); authority = valid; epoch = nextEpoch; source = null; invalidate();
  if (activeRead) cancelQuestionnaireRecoveryRead(activeRead);
  emit();
}
export function observeQuestionnairePendingSource(scope: QuestionnairePendingScope, generatedAt: string): boolean {
  if (source?.identity === identity(scope) && source.generatedAt === generatedAt && admitted(scope)) return true;
  if (floorsExhausted || !allowed(scope) || Date.parse(generatedAt) <= (sourceFloors.get(identity(scope)) ?? -Infinity) || !canAdmitQuestionnaireViewSource(scope.authority, generatedAt)) {
    if (source) { raiseSourceFloor(); source = null; invalidate(); if (activeRead) cancelQuestionnaireRecoveryRead(activeRead); emit(); }
    return false;
  }
  const next = { identity: identity(scope), generatedAt };
  source = Object.freeze(next); invalidate(); if (activeRead) cancelQuestionnaireRecoveryRead(activeRead); emit(); return true;
}
export function getQuestionnairePending(scope: QuestionnairePendingScope | null): QuestionnairePendingJournal {
  if (!scope || !admitted(scope)) return EMPTY;
  const key = `${scope.authority}|${scope.epoch}|${identity(scope)}`;
  if (projectionCache?.journal === journal && projectionCache.source === source && projectionCache.key === key) return projectionCache.value;
  const id = identity(scope), operation = journal.operation?.identity === id ? journal.operation : null;
  const confirmed = journal.confirmed.filter(item => item.identity === id);
  const value = Object.freeze({ operation, confirmed: Object.freeze(confirmed), navigationBlocked: journal.navigationBlocked && operation !== null });
  projectionCache = { journal, source: source!, key, value }; return value;
}
export function isQuestionnairePendingSourceAdmitted(scope: QuestionnairePendingScope | null, generatedAt: string): boolean {
  return scope !== null && admitted(scope) && source?.generatedAt === generatedAt;
}
/** Retain an already admitted same-owner editor during a vetted source handoff.
 * This is not admission of the incoming timestamp: writes still bind to the
 * exact current source, and authority/privacy floors still invalidate ownership. */
export function isQuestionnairePendingOwnerAdmitted(scope: QuestionnairePendingScope | null): boolean {
  return scope !== null && admitted(scope);
}
export function useQuestionnairePending(scope: QuestionnairePendingScope | null) {
  return useSyncExternalStore(subscribe, () => getQuestionnairePending(scope), () => EMPTY);
}
export function beginQuestionnairePending(scope: QuestionnairePendingScope, value: QuestionnairePendingInput, generatedAt: string): QuestionnairePendingOperation | null {
  if (!admitted(scope, true) || source?.generatedAt !== generatedAt || journal.operation || journal.confirmed.length >= 32 ||
    journal.confirmed.some(item => item.identity === identity(scope)) || hasPendingOperations() || hasViewTransition()) return null;
  let input: QuestionnairePendingInput, body: string, normalizedInput: QuestionnaireMutationInput;
  try {
    const key = uuid.parse(value.idempotencyKey), request = cloneWire(value.request), parsed = parseQuestionnaireMutation(request, key);
    if (!parsed || parsed.client_id !== scope.clientId || parsed.form_key !== scope.formKey) return null;
    input = Object.freeze({ request, idempotencyKey: key }); body = JSON.stringify(request);
    if (new TextEncoder().encode(body).byteLength > 64 * 1024) return null;
    normalizedInput = parsed;
  } catch { return null; }
  const beforeSource = source, beforeJournal = journal, beforePrivacy = privacyEpoch;
  const lease = tryAcquirePendingOperation(); if (!lease) return null;
  if (source !== beforeSource || journal !== beforeJournal || privacyEpoch !== beforePrivacy || !admitted(scope, true)) { lease(); return null; }
  const operation: QuestionnairePendingOperation = Object.freeze({ token: Symbol(), attempt: Symbol(), identity: identity(scope),
    scope: Object.freeze(scopeSchema.parse(scope)), input, body, sourceAt: generatedAt, authority: scope.authority,
    epoch: scope.epoch, privacyEpoch, phase: "sending", everUnknown: false });
  normalized.set(operation, normalizedInput);
  writeLease = lease; journal = { ...journal, operation, navigationBlocked: false };
  try {
    removeGuards = installPendingNavigationGuard({ hasPendingOperation: () => journal.operation !== null,
      permittedFormAttribute: "data-questionnaire-write", onBlocked: () => { journal = { ...journal, navigationBlocked: true }; emit(); } });
    emit(); return journal.operation === operation ? operation : null;
  } catch {
    if (journal.operation === operation) journal = { ...journal, operation: null, navigationBlocked: false };
    if (writeLease === lease) unlock(); else lease(); return null;
  }
}
export function markQuestionnairePendingUnknown(operation: QuestionnairePendingOperation): boolean {
  if (!current(operation, false)) return false;
  journal = { ...journal, operation: copyOperation(operation, { phase: "unknown", everUnknown: true, attempt: Symbol() }) }; emit(); return true;
}
export function retryQuestionnairePending(token: symbol, scope: QuestionnairePendingScope): QuestionnairePendingOperation | null {
  const operation = journal.operation;
  if (!operation || operation.token !== token || operation.phase !== "unknown" || operation.identity !== identity(scope) || !admitted(scope, true) || hasViewTransition()) return null;
  const next = copyOperation(operation, { phase: "sending", attempt: Symbol(), authority: scope.authority, epoch: scope.epoch,
    privacyEpoch, sourceAt: source!.generatedAt }); journal = { ...journal, operation: next }; emit(); return journal.operation === next ? next : null;
}
export function markQuestionnairePendingDenied(operation: QuestionnairePendingOperation): boolean {
  if (!current(operation, false)) return false;
  if (operation.everUnknown) return markQuestionnairePendingUnknown(operation);
  journal = { ...journal, operation: null, navigationBlocked: false }; unlock(); emit(); return true;
}
export function markQuestionnairePendingCommitted(operation: QuestionnairePendingOperation, value: unknown): boolean {
  if (!current(operation) || journal.confirmed.length >= 32) return false;
  try {
    const receipt = questionnaireReceiptSchema.parse(cloneWire(value)), request = normalized.get(operation)!;
    const at = instantMicros(receipt.committedAt);
    if (receipt.action !== request.action || receipt.clientId !== operation.scope.clientId || receipt.formKey !== operation.scope.formKey ||
      receipt.assessedOn !== request.assessed_on || receipt.version > 1_000_000 || at === null || at > BigInt(Date.now() + 60_000) * BigInt(1000) ||
      (request.action === "create" ? receipt.version !== 1 : receipt.assessmentKey !== request.assessment_key ||
        receipt.version !== request.expected_version! + 1 || receipt.versionId === request.previous_version_id)) return false;
    const confirmed = Object.freeze({ identity: operation.identity, operation, receipt: Object.freeze(receipt) });
    journal = { ...journal, operation: null, navigationBlocked: false, confirmed: Object.freeze([...journal.confirmed, confirmed]) };
    unlock(); emit(); return true;
  } catch { return false; }
}

/** Positive exact historical readback only. Neither absence, a newer latest
 * record nor a receipt on its own removes the original-content guard. */
export function reconcileQuestionnairePendingExactHistory(scope: QuestionnairePendingScope, versions: unknown, generatedAt: string): boolean {
  if (!admitted(scope) || source?.generatedAt !== generatedAt || !Array.isArray(versions) || versions.length > 20) return false;
  let rows: z.infer<typeof questionnaireDraftSchema>[];
  try { rows = versions.map(row => questionnaireDraftSchema.parse(cloneWire(row))); } catch { return false; }
  if (new Set(rows.map(row => row.versionId)).size !== rows.length) return false;
  const id = identity(scope);
  const remaining = journal.confirmed.filter(item => {
    if (item.identity !== id) return true;
    const receipt = item.receipt, original = normalized.get(item.operation)!;
    return !rows.some(row => row.versionId === receipt.versionId && row.assessmentKey === receipt.assessmentKey && row.version === receipt.version &&
      row.assessedOn === receipt.assessedOn && row.formVersion === original.form_version && row.contentHash === receipt.contentHash &&
      instantMicros(row.createdAt) !== null && instantMicros(row.createdAt) === instantMicros(receipt.committedAt) &&
      canonical(row.answers) === canonical(original.answers) && canonical(row.context) === canonical(original.context));
  });
  if (remaining.length === journal.confirmed.length) return false;
  journal = { ...journal, confirmed: Object.freeze(remaining) }; emit(); return true;
}

export type QuestionnaireRecoveryRead = Readonly<{ token: symbol; nonce: string; operation: QuestionnairePendingOperation }>;
const readOwners = new WeakMap<QuestionnaireRecoveryRead, { release: () => void; source: PendingSource;
  scope: QuestionnairePendingScope; privacyEpoch: number }>();
let activeRead: QuestionnaireRecoveryRead | null = null;
export function getQuestionnaireRecoveryReadLease(scope: QuestionnairePendingScope): QuestionnaireRecoveryRead | null {
  const operation = journal.operation;
  if (!operation || operation.phase !== "unknown" || operation.identity !== identity(scope) || !admitted(scope) || !writeLease || hasViewTransition()) return null;
  const beforeSource = source!, beforePrivacy = privacyEpoch;
  const lease = tryAcquirePendingRecoveryRead(writeLease); if (!lease) return null;
  if (source !== beforeSource || privacyEpoch !== beforePrivacy || journal.operation !== operation || !admitted(scope)) { lease(); return null; }
  try {
    const check = Object.freeze({ token: Symbol(), nonce: uuid.parse(crypto.randomUUID()), operation });
    readOwners.set(check, { release: lease, source: beforeSource, scope: Object.freeze({ ...scope }), privacyEpoch }); activeRead = check; return check;
  } catch { lease(); return null; }
}
export function isQuestionnaireRecoveryReadCurrent(check: QuestionnaireRecoveryRead): boolean {
  const owner = readOwners.get(check);
  return !!owner && owner.source === source && owner.privacyEpoch === privacyEpoch && check.operation === journal.operation &&
    check.operation.phase === "unknown" && admitted(owner.scope);
}
export function cancelQuestionnaireRecoveryRead(check: QuestionnaireRecoveryRead): boolean {
  const owner = readOwners.get(check); if (!owner) return false;
  readOwners.delete(check); if (activeRead === check) activeRead = null; owner.release(); return true;
}
export function settleQuestionnaireRecoveryRead(check: QuestionnaireRecoveryRead, value: unknown): "confirmed" | "not_found" | "unavailable" | "stale" {
  if (!isQuestionnaireRecoveryReadCurrent(check)) { cancelQuestionnaireRecoveryRead(check); return "stale"; }
  try {
    const owner = readOwners.get(check)!, operation = check.operation, request = normalized.get(operation)!;
    const proof = parseQuestionnaireOperationReceipt(value, { organizationId: operation.scope.organizationId, branchId: operation.scope.branchId,
      actorUserId: operation.scope.actorUserId, formKey: operation.scope.formKey, clientId: operation.scope.clientId,
      action: request.action, idempotencyKey: operation.input.idempotencyKey, nonce: check.nonce, request: operation.input.request });
    if (proof.status === "not_found") return "not_found";
    if (!isQuestionnaireRecoveryReadCurrent(check)) return "stale";
    // A renewed read authority can verify this historical write without gaining
    // manage/sign permission. Bind the settlement to this exact current epoch.
    const renewed = copyOperation(operation, { authority: owner.scope.authority, epoch: owner.scope.epoch, privacyEpoch });
    journal = { ...journal, operation: renewed };
    return markQuestionnairePendingCommitted(renewed, proof.receipt) ? "confirmed" : "unavailable";
  } catch { return "unavailable"; }
  finally { cancelQuestionnaireRecoveryRead(check); }
}
export function clearQuestionnairePendingOnLogout() {
  raiseSourceFloor(); journal = EMPTY; authority = null; epoch = -1; source = null; privacyEpoch += 1; projectionCache = null;
  if (activeRead) cancelQuestionnaireRecoveryRead(activeRead); unlock(); emit();
}
