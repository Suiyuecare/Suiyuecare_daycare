"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { parseStaffAnnouncementAction, parseStaffAnnouncementApiEnvelope, parseStaffAnnouncementInput, STAFF_ANNOUNCEMENT_MAX_BYTES } from "@/lib/integrations/staff-announcements";
import { hasPendingOperations, tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";
import type { StaffAnnouncementMutationInput, StaffAnnouncementMutationResult, StaffAnnouncementSnapshot } from "./types";

export type StaffAnnouncementScope = { organizationId: string; branchId: string; userId: string };
export type StaffAnnouncementTarget = { announcementKey: string; version: number; versionId: string;
  activeReleaseVersionId: string | null; publishAt?: string; expiresAt?: string | null };
const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
const scopeSchema = z.object({ organizationId: uuid, branchId: uuid, userId: uuid }).strict();
const targetSchema = z.object({ announcementKey: uuid, version: z.number().int().positive().safe(), versionId: uuid,
  activeReleaseVersionId: uuid.nullable(),
  publishAt: timestamp.optional(), expiresAt: timestamp.nullable().optional() }).strict();
const authoritySchema = z.tuple([z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.boolean()]),
  z.array(z.string()), z.array(z.string()), z.enum(["aal1", "aal2"]), z.string().nullable()]);
function authorityIdentity(signature: string | null) {
  if (!signature) return null;
  const parsed = authoritySchema.parse(JSON.parse(signature));
  return JSON.stringify(parsed[0]);
}

export function staffAnnouncementScopeIdentity(scope: StaffAnnouncementScope, demo: boolean) {
  const value = scopeSchema.parse(scope);
  return JSON.stringify([value.organizationId, value.branchId, value.userId, demo]);
}
/** One canonical signature for the shell and all announcement consumers. Never
 * use generatedAt, filters or render identity as an authorization epoch. */
export function staffAnnouncementAuthoritySignature(context: TenantContext) {
  return JSON.stringify([[context.organizationId.toLowerCase(), context.branchId.toLowerCase(), context.userId.toLowerCase(), context.demo],
    [...new Set(context.roles)].sort(), [...new Set(context.scopes)].sort(),
    context.assuranceLevel, context.recentAal2At]);
}
export type StaffAnnouncementOperation = Readonly<{
  token: symbol; attempt: symbol; identity: string; scope: Readonly<StaffAnnouncementScope>;
  input: StaffAnnouncementMutationInput; body: string; snapshotAt: string;
  target: Readonly<StaffAnnouncementTarget> | null; phase: "sending" | "unknown"; everUnknown: boolean;
  privacyEpoch: number; authorityEpoch: number; authoritySignature: string;
}>;
export type StaffAnnouncementConfirmed = Readonly<{
  identity: string; action: StaffAnnouncementMutationInput["action"]; announcementKey: string;
  versionId: string | null; version: number | null; releaseVersionId: string | null; readAt: string | null;
  snapshotAt: string; committedAt: string | null; newAnnouncement: boolean;
}>;
type Journal = Readonly<{ operation: StaffAnnouncementOperation | null; confirmed: readonly StaffAnnouncementConfirmed[];
  navigationBlocked: boolean; privacyEpoch: number; authorityEpoch: number; authoritySignature: string | null }>;
const EMPTY: Journal = { operation: null, confirmed: [], navigationBlocked: false, privacyEpoch: 0, authorityEpoch: 0, authoritySignature: null };
let journal: Journal = EMPTY;
let release: (() => void) | null = null;
let removeGuards: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getStaffAnnouncementPending = () => journal;
export function useStaffAnnouncementPending() { return useSyncExternalStore(subscribe, getStaffAnnouncementPending, () => EMPTY); }
function unlock() {
  const held = release; const guards = removeGuards;
  release = null; removeGuards = null; guards?.(); held?.();
}
export function observeStaffAnnouncementAuthority(signature: string) {
  if (!signature || signature.length > 20_000) throw new Error("INVALID_STAFF_ANNOUNCEMENT_AUTHORITY");
  authorityIdentity(signature);
  if (signature === journal.authoritySignature) return journal.authorityEpoch;
  journal = { ...journal, authoritySignature: signature, authorityEpoch: journal.authorityEpoch + 1,
    operation: journal.operation ? Object.freeze({ ...journal.operation, phase: "unknown" as const,
      everUnknown: true, attempt: Symbol() }) : null };
  emit(); return journal.authorityEpoch;
}
function wirePayload(input: StaffAnnouncementMutationInput) {
  if (input.action === "draft") return { previous_version_id: input.previousVersionId, title: input.title, body: input.body,
    publish_at: input.publishAt, expires_at: input.expiresAt, audience_user_ids: [...input.audienceUserIds],
    audience_role_ids: [...input.audienceRoleIds], change_reason: input.changeReason };
  if (input.action === "publish") return { draft_version_id: input.draftVersionId };
  if (input.action === "withdraw") return { expected_latest_version_id: input.expectedLatestVersionId,
    release_version_id: input.releaseVersionId, reason: input.reason };
  return { release_version_id: input.releaseVersionId };
}
export function hasStaffAnnouncementConfirmedTarget(scope: StaffAnnouncementScope, demo: boolean,
  input: StaffAnnouncementMutationInput, target?: StaffAnnouncementTarget | null) {
  const identity = staffAnnouncementScopeIdentity(scope, demo);
  return journal.confirmed.some((entry) => entry.identity === identity && (
    entry.action === "read" ? input.action === "read" && entry.releaseVersionId === input.releaseVersionId
      : (input.action === "draft" && input.previousVersionId === null && entry.newAnnouncement) ||
        (!!target && entry.announcementKey === target.announcementKey.toLowerCase())
  ));
}
/** Single tab, immutable wire content; no localStorage/sessionStorage/history,
 * automated retries, offline queue or data-bearing shared navigation state. */
export function beginStaffAnnouncement(scope: StaffAnnouncementScope, demo: boolean, value: StaffAnnouncementMutationInput,
  snapshotAt: string, target?: StaffAnnouncementTarget): StaffAnnouncementOperation | null {
  if (demo || journal.operation || journal.confirmed.length >= 32 || hasPendingOperations() || !journal.authoritySignature) return null;
  const normalizedScope = scopeSchema.parse(scope);
  const identity = staffAnnouncementScopeIdentity(normalizedScope, demo);
  if (identity !== authorityIdentity(journal.authoritySignature)) return null;
  const input = parseStaffAnnouncementInput(parseStaffAnnouncementAction(value.action), wirePayload(value), value.idempotencyKey);
  const sourceAt = timestamp.parse(snapshotAt);
  const proof = target ? targetSchema.parse(target) : null;
  const newAnnouncement = input.action === "draft" && input.previousVersionId === null;
  if ((newAnnouncement && proof) || (!newAnnouncement && !proof) ||
    (input.action === "publish" && (proof?.publishAt === undefined || proof.expiresAt === undefined))) {
    throw new Error("INVALID_STAFF_ANNOUNCEMENT_TARGET");
  }
  if (proof && (input.action === "draft" && input.previousVersionId !== proof.versionId ||
    input.action === "publish" && input.draftVersionId !== proof.versionId ||
    input.action === "withdraw" && (input.expectedLatestVersionId !== proof.versionId || input.releaseVersionId !== proof.activeReleaseVersionId) ||
    input.action === "read" && (input.releaseVersionId !== proof.activeReleaseVersionId || proof.versionId !== input.releaseVersionId))) {
    throw new Error("INVALID_STAFF_ANNOUNCEMENT_SOURCE_BINDING");
  }
  if (hasStaffAnnouncementConfirmedTarget(normalizedScope, demo, input, proof)) return null;
  const body = JSON.stringify(wirePayload(input));
  if (new TextEncoder().encode(body).byteLength > STAFF_ANNOUNCEMENT_MAX_BYTES) return null;
  if (input.action === "draft") { Object.freeze(input.audienceUserIds); Object.freeze(input.audienceRoleIds); }
  Object.freeze(input);
  const lease = tryAcquirePendingOperation(); if (!lease) return null;
  const token = Symbol();
  try {
    const operation: StaffAnnouncementOperation = Object.freeze({ token, attempt: Symbol(), identity,
      scope: Object.freeze(normalizedScope), input, body, snapshotAt: sourceAt,
      target: proof ? Object.freeze(proof) : null, phase: "sending", everUnknown: false,
      privacyEpoch: journal.privacyEpoch, authorityEpoch: journal.authorityEpoch, authoritySignature: journal.authoritySignature });
    release = lease; journal = { ...journal, operation, navigationBlocked: false };
    removeGuards = installPendingNavigationGuard({ hasPendingOperation: () => journal.operation !== null,
      permittedFormAttribute: "data-staff-announcement-form", onBlocked: () => {
        journal = { ...journal, navigationBlocked: true }; emit();
      } });
    emit(); return operation;
  } catch (error) {
    if (journal.operation?.token === token) journal = { ...journal, operation: null, navigationBlocked: false };
    if (release === lease) unlock(); else lease();
    throw error;
  }
}
export function retryStaffAnnouncement(token: symbol, scope: StaffAnnouncementScope, demo: boolean): StaffAnnouncementOperation | null {
  const current = journal.operation;
  if (!current || current.token !== token || current.phase !== "unknown" || demo || !journal.authoritySignature ||
    current.identity !== staffAnnouncementScopeIdentity(scope, demo) || current.identity !== authorityIdentity(journal.authoritySignature)) return null;
  const operation = Object.freeze({ ...current, phase: "sending" as const, attempt: Symbol(),
    authorityEpoch: journal.authorityEpoch, authoritySignature: journal.authoritySignature, privacyEpoch: journal.privacyEpoch });
  journal = { ...journal, operation }; emit(); return operation;
}
export function settleStaffAnnouncement(operation: StaffAnnouncementOperation,
  result: "unknown" | "denied" | { requestId: string; data: StaffAnnouncementMutationResult }) {
  const current = journal.operation;
  if (!current || current.token !== operation.token || current.attempt !== operation.attempt ||
    current.privacyEpoch !== journal.privacyEpoch || current.authorityEpoch !== journal.authorityEpoch ||
    current.authoritySignature !== journal.authoritySignature || current.identity !== authorityIdentity(journal.authoritySignature)) return false;
  if (result === "unknown" || result === "denied" && current.everUnknown) {
    journal = { ...journal, operation: Object.freeze({ ...current, phase: "unknown", everUnknown: true, attempt: Symbol() }) };
    emit(); return true;
  }
  let confirmed: StaffAnnouncementConfirmed | null = null;
  if (typeof result === "object") {
    const receipt = parseStaffAnnouncementApiEnvelope({ ...result, status: "ok", errors: [] }, current.input).data;
    const target = current.target;
    if ((target && receipt.announcementKey !== target.announcementKey) ||
      (receipt.action !== "read" && target && receipt.version !== target.version + 1) ||
      (receipt.action === "draft" && receipt.versionId === receipt.previousVersionId) ||
      (receipt.action === "publish" && (receipt.versionId === receipt.draftVersionId ||
        receipt.publishAt !== target!.publishAt || receipt.expiresAt !== target!.expiresAt)) ||
      (receipt.action === "withdraw" && (receipt.versionId === receipt.previousVersionId || receipt.versionId === receipt.releaseVersionId))) {
      throw new Error("INVALID_STAFF_ANNOUNCEMENT_RECEIPT_BINDING");
    }
    confirmed = Object.freeze({ identity: current.identity, action: receipt.action, announcementKey: receipt.announcementKey,
      versionId: receipt.action === "read" ? null : receipt.versionId, version: receipt.action === "read" ? null : receipt.version,
      releaseVersionId: receipt.action === "read" || receipt.action === "withdraw" ? receipt.releaseVersionId
        : receipt.action === "publish" ? receipt.versionId : null,
      readAt: receipt.action === "read" ? receipt.readAt : null, snapshotAt: current.snapshotAt,
      committedAt: receipt.action === "read" ? receipt.readAt : receipt.action === "withdraw" ? receipt.withdrawnAt : null,
      newAnnouncement: current.input.action === "draft" && current.input.previousVersionId === null });
  }
  journal = { ...journal, operation: null, navigationBlocked: false,
    confirmed: confirmed ? [...journal.confirmed, confirmed] : journal.confirmed };
  unlock(); emit(); return true;
}
/** A live page is not a complete dataset. Absence, a queued refresh and browser
 * ACK time prove nothing. Only returned same-chain positive evidence clears. */
export function reconcileStaffAnnouncementConfirmed(scope: StaffAnnouncementScope, snapshot: StaffAnnouncementSnapshot, now: number) {
  const identity = staffAnnouncementScopeIdentity(scope, snapshot.demo);
  const generated = timestamp.safeParse(snapshot.generatedAt); const stale = timestamp.safeParse(snapshot.staleAfter);
  if (snapshot.demo || snapshot.organizationId.toLowerCase() !== scope.organizationId.toLowerCase() ||
    snapshot.branchId.toLowerCase() !== scope.branchId.toLowerCase() || !generated.success || !stale.success ||
    !Number.isFinite(now) || Date.parse(stale.data) < Date.parse(generated.data) || now > Date.parse(stale.data)) return;
  const candidates = snapshot.selectedAnnouncement ? [...snapshot.items, snapshot.selectedAnnouncement] : snapshot.items;
  const confirmed = journal.confirmed.filter((entry) => entry.identity !== identity ||
    Date.parse(generated.data) <= Date.parse(entry.snapshotAt) ||
    (entry.committedAt !== null && Date.parse(generated.data) < Date.parse(entry.committedAt)) ||
    !candidates.some((item) => item.announcementKey === entry.announcementKey && (
      entry.action === "read" ? item.activeReleaseVersionId === entry.releaseVersionId && item.actorIsRecipient &&
        item.actorReadAt !== null && timestamp.safeParse(item.actorReadAt).success &&
        new Date(item.actorReadAt).toISOString() === entry.readAt
        : Number.isSafeInteger(item.version) && item.version >= entry.version! &&
          (item.version > entry.version! || item.versionId === entry.versionId && (
            entry.action === "draft" ? item.versionState === "draft"
              : entry.action === "publish" ? item.versionState === "release" && item.activeReleaseVersionId === entry.versionId
                : item.versionState === "withdrawal" && item.lifecycle === "withdrawn" && item.activeReleaseVersionId === entry.releaseVersionId
          ))
    )));
  if (confirmed.length !== journal.confirmed.length) { journal = { ...journal, confirmed }; emit(); }
}
/** Unconditional privacy/logout boundary; only this journal's lease is released. */
export function clearStaffAnnouncementPendingOnLogout() {
  journal = { ...EMPTY, privacyEpoch: journal.privacyEpoch + 1, authorityEpoch: journal.authorityEpoch + 1 };
  unlock(); emit();
}
export function isConfirmedStaffAnnouncementRejection(raw: unknown, status: number) {
  const parsed = z.object({ requestId: uuid, status: z.literal("error"), data: z.null(),
    errors: z.array(z.object({ code: z.string(), message: z.string().max(500), field: z.string().max(120).optional() }).strict()).min(1).max(20) }).strict().safeParse(raw);
  const allowed: Record<number, readonly string[]> = {
    400: ["INVALID_STAFF_ANNOUNCEMENT", "INVALID_STAFF_ANNOUNCEMENT_ACTION", "INVALID_JSON"],
    401: ["AUTH_REQUIRED"], 403: ["DEMO_READ_ONLY", "STAFF_ANNOUNCEMENT_NOT_AUTHORIZED", "AAL2_REQUIRED"],
    409: ["STAFF_ANNOUNCEMENT_VERSION_CONFLICT", "STAFF_ANNOUNCEMENT_IDEMPOTENCY_CONFLICT"], 413: ["REQUEST_TOO_LARGE"],
  };
  return parsed.success && parsed.data.errors.every((error) => allowed[status]?.includes(error.code));
}
