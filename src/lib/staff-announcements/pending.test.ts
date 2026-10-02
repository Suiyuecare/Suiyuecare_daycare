// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { hasPendingOperations, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { parseStaffAnnouncementInput } from "@/lib/integrations/staff-announcements";
import { buildDemoStaffAnnouncementSnapshot } from "./demo";
import { beginStaffAnnouncement, clearStaffAnnouncementPendingOnLogout, getStaffAnnouncementPending,
  isConfirmedStaffAnnouncementRejection, observeStaffAnnouncementAuthority, reconcileStaffAnnouncementConfirmed,
  retryStaffAnnouncement, settleStaffAnnouncement, staffAnnouncementAuthoritySignature, staffAnnouncementScopeIdentity,
  hasStaffAnnouncementConfirmedTarget, beginStaffAnnouncementReceiptCheck, settleStaffAnnouncementReceiptCheck,
  failStaffAnnouncementReceiptCheck, type StaffAnnouncementConfirmed } from "./pending";
import { parseStaffAnnouncementReceipt } from "./receipt";

const org = "11111111-1111-4111-8111-111111111111";
const branch = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const key = "44444444-4444-4444-8444-444444444444";
const versionId = "55555555-5555-4555-8555-555555555555";
const announcementKey = "66666666-6666-4666-8666-666666666666";
const requestId = "77777777-7777-4777-8777-777777777777";
const sourceAt = "2026-09-26T10:00:00.000Z";
const freshAt = "2026-09-26T10:00:01.000Z";
const scope = { organizationId: org, branchId: branch, userId: actor };
const authority = (overrides: Partial<TenantContext> = {}) => staffAnnouncementAuthoritySignature({ ...scope,
  organizationName: "合成機構", branchName: "合成分支", displayName: "合成职員", roles: ["organization_manager"],
  scopes: ["announcements.read", "announcements.manage"], assuranceLevel: "aal2", recentAal2At: sourceAt, demo: false, ...overrides });
const target = { announcementKey, version: 1, versionId, activeReleaseVersionId: versionId };
const draft = () => parseStaffAnnouncementInput("draft", { previous_version_id: null, title: "合成公告", body: "合成內容",
  publish_at: freshAt, expires_at: null, audience_user_ids: [actor], audience_role_ids: [], change_reason: null }, key);
const savedDraft = () => ({ requestId, data: { action: "draft" as const, versionId, announcementKey, version: 1, previousVersionId: null,
  versionState: "draft" as const, publishAt: freshAt, expiresAt: null, replayed: false, persisted: true as const, demo: false as const } });
const demo = buildDemoStaffAnnouncementSnapshot({ organizationId: org, branchId: branch, selectedReleaseId: null });
function freshSnapshot() {
  const item = { ...demo.items[0], versionId, announcementKey, version: 1, versionState: "draft" as const,
    title: "合成公告", lifecycle: "draft" as const, activeReleaseVersionId: null };
  return { ...demo, demo: false, generatedAt: freshAt, staleAfter: "2026-09-26T10:01:01.000Z", items: [item] };
}
beforeEach(() => { clearStaffAnnouncementPendingOnLogout(); observeStaffAnnouncementAuthority(authority()); });
afterEach(() => { clearStaffAnnouncementPendingOnLogout(); vi.restoreAllMocks(); });

describe("independent memory-only announcement journal", () => {
  it("uses one stable canonical authority signature across shell/provider and role ordering", () => {
    const context: TenantContext = { ...scope, organizationName: "合成機構", branchName: "合成分支", displayName: "合成職員",
      roles: ["organization_manager", "branch_supervisor"], scopes: ["announcements.read", "announcements.manage"],
      assuranceLevel: "aal2", recentAal2At: sourceAt, demo: false };
    const signature = staffAnnouncementAuthoritySignature(context);
    expect(staffAnnouncementAuthoritySignature({ ...context, roles: [...context.roles].reverse(), scopes: [...context.scopes].reverse(), displayName: "另一名稱" })).toBe(signature);
    expect(staffAnnouncementAuthoritySignature({ ...context, scopes: ["announcements.read"] })).not.toBe(signature);
    expect(staffAnnouncementAuthoritySignature({ ...context, assuranceLevel: "aal1" })).not.toBe(signature);
    expect(staffAnnouncementAuthoritySignature({ ...context, recentAal2At: freshAt })).not.toBe(signature);
    expect(() => staffAnnouncementAuthoritySignature({ ...context, userId: "synthetic", branchId: "demo", organizationId: "fixture", demo: true })).not.toThrow();
  });
  it("freezes normalized payload, body and key across retries and excludes overlap", () => {
    const input = draft(); const first = beginStaffAnnouncement(scope, false, input, sourceAt)!;
    expect(Object.isFrozen(first.input)).toBe(true);
    if (input.action === "draft") { (input.audienceUserIds as string[]).push(org); input.body = "後改內容"; }
    expect(first.body).toContain("合成內容"); expect(first.body).not.toContain("後改內容");
    expect(beginStaffAnnouncement(scope, false, draft(), sourceAt)).toBeNull();
    settleStaffAnnouncement(first, "unknown");
    const retry = retryStaffAnnouncement(first.token, scope, false)!;
    expect(retry.body).toBe(first.body); expect(retry.input.idempotencyKey).toBe(key);
    expect(retry.token).toBe(first.token); expect(retry.attempt).not.toBe(first.attempt);
  });
  it("keeps unknown-after-denial and invalidates already settled attempt callbacks", () => {
    const first = beginStaffAnnouncement(scope, false, draft(), sourceAt)!;
    settleStaffAnnouncement(first, "unknown");
    expect(settleStaffAnnouncement(first, savedDraft())).toBe(false);
    const retry = retryStaffAnnouncement(first.token, scope, false)!;
    settleStaffAnnouncement(retry, "denied");
    expect(getStaffAnnouncementPending().operation?.phase).toBe("unknown"); expect(hasPendingOperations()).toBe(true);
  });
  it("releases only a first-attempt known denial", () => {
    const first = beginStaffAnnouncement(scope, false, draft(), sourceAt)!;
    expect(settleStaffAnnouncement(first, "denied")).toBe(true);
    expect(hasPendingOperations()).toBe(false); expect(getStaffAnnouncementPending().confirmed).toHaveLength(0);
  });
  it("global authority ABA invalidates responses even after a provider remount", () => {
    const first = beginStaffAnnouncement(scope, false, draft(), sourceAt)!;
    const epoch = getStaffAnnouncementPending().authorityEpoch;
    observeStaffAnnouncementAuthority(authority({ assuranceLevel: "aal1", scopes: ["announcements.read"] })); observeStaffAnnouncementAuthority(authority());
    expect(getStaffAnnouncementPending().authorityEpoch).toBe(epoch + 2);
    expect(getStaffAnnouncementPending().operation?.phase).toBe("unknown");
    expect(settleStaffAnnouncement(first, savedDraft())).toBe(false);
    const retry = retryStaffAnnouncement(first.token, scope, false)!;
    expect(retry.authorityEpoch).toBe(epoch + 2); expect(retry.body).toBe(first.body);
    expect(settleStaffAnnouncement(retry, savedDraft())).toBe(true);
  });
  it("duplicate authority observation is a remount no-op", () => {
    const first = beginStaffAnnouncement(scope, false, draft(), sourceAt)!;
    observeStaffAnnouncementAuthority(authority());
    expect(getStaffAnnouncementPending().operation).toBe(first);
  });
  it("rejects foreign scope, mode and stale retry without releasing its own lease", () => {
    const first = beginStaffAnnouncement(scope, false, draft(), sourceAt)!; settleStaffAnnouncement(first, "unknown");
    expect(retryStaffAnnouncement(first.token, { ...scope, userId: org }, false)).toBeNull();
    expect(retryStaffAnnouncement(first.token, { ...scope, branchId: org }, false)).toBeNull();
    expect(retryStaffAnnouncement(first.token, scope, true)).toBeNull(); expect(hasPendingOperations()).toBe(true);
  });
  it("binds the observed actor and tenant even when stale consumers still provide the old scope", () => {
    observeStaffAnnouncementAuthority(authority({ userId: org }));
    expect(beginStaffAnnouncement(scope, false, draft(), sourceAt)).toBeNull();
    expect(hasPendingOperations()).toBe(false);
    observeStaffAnnouncementAuthority(authority());
    const first = beginStaffAnnouncement(scope, false, draft(), sourceAt)!;
    settleStaffAnnouncement(first, "unknown");
    for (const context of [{ userId: org }, { branchId: org }, { organizationId: branch }, { demo: true }]) {
      observeStaffAnnouncementAuthority(authority(context));
      expect(retryStaffAnnouncement(first.token, scope, false)).toBeNull();
      expect(settleStaffAnnouncement(first, savedDraft())).toBe(false);
      expect(hasPendingOperations()).toBe(true);
    }
    observeStaffAnnouncementAuthority(authority());
    expect(retryStaffAnnouncement(first.token, scope, false)?.body).toBe(first.body);
  });
  it("rejects an arbitrary authority string without changing the existing epoch or attempt", () => {
    const first = beginStaffAnnouncement(scope, false, draft(), sourceAt)!;
    const before = getStaffAnnouncementPending();
    expect(() => observeStaffAnnouncementAuthority("not-an-authenticated-context")).toThrow();
    expect(getStaffAnnouncementPending()).toBe(before);
    expect(settleStaffAnnouncement(first, savedDraft())).toBe(true);
  });
  it("rejects a referenced input ID inconsistent with its frozen source proof before taking a lease", () => {
    const publish = parseStaffAnnouncementInput("publish", { draft_version_id: versionId }, key);
    expect(() => beginStaffAnnouncement(scope, false, publish, sourceAt,
      { ...target, versionId: org, publishAt: freshAt, expiresAt: null })).toThrow();
    const read = parseStaffAnnouncementInput("read", { release_version_id: versionId }, key);
    expect(() => beginStaffAnnouncement(scope, false, read, sourceAt, { ...target, activeReleaseVersionId: branch })).toThrow();
    expect(() => beginStaffAnnouncement(scope, false, read, sourceAt, { ...target, versionId: branch })).toThrow();
    const withdraw = parseStaffAnnouncementInput("withdraw", { expected_latest_version_id: versionId,
      release_version_id: branch, reason: "合成理由" }, key);
    expect(() => beginStaffAnnouncement(scope, false, withdraw, sourceAt, target)).toThrow();
    expect(hasPendingOperations()).toBe(false); expect(getStaffAnnouncementPending().operation).toBeNull();
  });
  it("logout forgets private values and late replies without releasing a foreign lease", () => {
    const first = beginStaffAnnouncement(scope, false, draft(), sourceAt)!;
    const before = getStaffAnnouncementPending().privacyEpoch;
    clearStaffAnnouncementPendingOnLogout(); const external = tryAcquirePendingOperation()!;
    expect(getStaffAnnouncementPending().privacyEpoch).toBe(before + 1);
    expect(getStaffAnnouncementPending().operation).toBeNull(); expect(settleStaffAnnouncement(first, savedDraft())).toBe(false);
    expect(hasPendingOperations()).toBe(true); external();
  });
  it("blocks synthetic, unknown-authority, foreign operations and active view transitions", () => {
    expect(beginStaffAnnouncement(scope, true, draft(), sourceAt)).toBeNull();
    clearStaffAnnouncementPendingOnLogout(); expect(beginStaffAnnouncement(scope, false, draft(), sourceAt)).toBeNull();
    observeStaffAnnouncementAuthority(authority());
    const external = tryAcquirePendingOperation()!; expect(beginStaffAnnouncement(scope, false, draft(), sourceAt)).toBeNull(); external();
    const view = tryAcquireViewTransition()!; expect(beginStaffAnnouncement(scope, false, draft(), sourceAt)).toBeNull(); view();
  });
  it("keeps confirmed markers for filtered absence, old time, wrong scope or expired source", () => {
    const first = beginStaffAnnouncement(scope, false, draft(), sourceAt)!; settleStaffAnnouncement(first, savedDraft());
    expect(hasPendingOperations()).toBe(false); expect(beginStaffAnnouncement(scope, false, draft(), freshAt)).toBeNull();
    const snapshot = freshSnapshot(); const now = Date.parse(freshAt);
    reconcileStaffAnnouncementConfirmed(scope, { ...snapshot, items: [] }, now);
    reconcileStaffAnnouncementConfirmed(scope, { ...snapshot, generatedAt: sourceAt }, now);
    reconcileStaffAnnouncementConfirmed(scope, { ...snapshot, branchId: org }, now);
    reconcileStaffAnnouncementConfirmed(scope, snapshot, Date.parse(snapshot.staleAfter) + 1);
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(1);
    reconcileStaffAnnouncementConfirmed(scope, snapshot, now); expect(getStaffAnnouncementPending().confirmed).toHaveLength(0);
  });
  it("accepts independently selected off-page positive proof, never conflicting UUID", () => {
    const first = beginStaffAnnouncement(scope, false, draft(), sourceAt)!; settleStaffAnnouncement(first, savedDraft());
    const snapshot = freshSnapshot(); const now = Date.parse(freshAt);
    reconcileStaffAnnouncementConfirmed(scope, { ...snapshot, items: [{ ...snapshot.items[0], versionId: org }] }, now);
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(1);
    reconcileStaffAnnouncementConfirmed(scope, { ...snapshot, items: [], selectedAnnouncement: snapshot.items[0] }, now);
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(0);
  });
  it("rejects unbound or malformed success receipts without losing the original operation", () => {
    const first = beginStaffAnnouncement(scope, false, draft(), sourceAt)!;
    expect(() => settleStaffAnnouncement(first, { ...savedDraft(), requestId: "bad" })).toThrow();
    expect(() => settleStaffAnnouncement(first, { ...savedDraft(), data: { ...savedDraft().data, version: 2 } })).toThrow();
    expect(getStaffAnnouncementPending().operation).toBe(first); expect(hasPendingOperations()).toBe(true);
  });
  it("requires target proof for an existing referenced version and binds receipt chain/version", () => {
    const input = parseStaffAnnouncementInput("publish", { draft_version_id: versionId }, key);
    expect(() => beginStaffAnnouncement(scope, false, input, sourceAt)).toThrow();
    const first = beginStaffAnnouncement(scope, false, input, sourceAt, { ...target, publishAt: freshAt, expiresAt: null })!;
    const data = { action: "publish" as const, versionId: branch, announcementKey, version: 2, draftVersionId: versionId,
      lifecycle: "scheduled" as const, publishAt: freshAt, expiresAt: null, recipientCount: 1, replayed: false, persisted: true as const, demo: false as const };
    expect(() => settleStaffAnnouncement(first, { requestId, data: { ...data, announcementKey: org } })).toThrow();
    expect(() => settleStaffAnnouncement(first, { requestId, data: { ...data, version: 3 } })).toThrow();
    expect(() => settleStaffAnnouncement(first, { requestId, data: { ...data, versionId } })).toThrow();
    expect(() => settleStaffAnnouncement(first, { requestId, data: { ...data, publishAt: sourceAt } })).toThrow();
    expect(settleStaffAnnouncement(first, { requestId, data })).toBe(true);
    const snapshot = freshSnapshot();
    const release = { ...snapshot.items[0], versionId: branch, version: 2, versionState: "release" as const,
      activeReleaseVersionId: branch, lifecycle: "scheduled" as const };
    reconcileStaffAnnouncementConfirmed(scope, { ...snapshot, items: [{ ...release, activeReleaseVersionId: versionId }] }, Date.parse(freshAt));
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(1);
    reconcileStaffAnnouncementConfirmed(scope, { ...snapshot, items: [release] }, Date.parse(freshAt));
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(0);
  });
  it("binds read receipts and only accepts this actor's same-release read evidence", () => {
    const input = parseStaffAnnouncementInput("read", { release_version_id: versionId }, key);
    const first = beginStaffAnnouncement(scope, false, input, sourceAt, target)!;
    const data = { action: "read" as const, releaseVersionId: versionId, announcementKey, readAt: freshAt,
      replayed: false, persisted: true as const, demo: false as const };
    expect(() => settleStaffAnnouncement(first, { requestId, data: { ...data, releaseVersionId: branch } })).toThrow();
    expect(() => settleStaffAnnouncement(first, { requestId, data: { ...data, announcementKey: org } })).toThrow();
    settleStaffAnnouncement(first, { requestId, data });
    expect(hasStaffAnnouncementConfirmedTarget(scope, false, input, target)).toBe(true);
    expect(hasStaffAnnouncementConfirmedTarget(scope, false, draft())).toBe(false);
    const snapshot = freshSnapshot();
    const release = { ...snapshot.items[0], versionState: "release" as const, activeReleaseVersionId: versionId,
      actorIsRecipient: true, actorReadAt: freshAt, readCount: 1 };
    for (const item of [{ ...release, actorIsRecipient: false }, { ...release, actorReadAt: null },
      { ...release, activeReleaseVersionId: branch }, { ...release, actorReadAt: sourceAt }]) {
      reconcileStaffAnnouncementConfirmed(scope, { ...snapshot, items: [item] }, Date.parse(freshAt));
      expect(getStaffAnnouncementPending().confirmed).toHaveLength(1);
    }
    reconcileStaffAnnouncementConfirmed(scope, { ...snapshot, items: [release] }, Date.parse(freshAt));
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(0);
  });
  it("requires withdrawal append lineage, trusted commit time and positive withdrawn state", () => {
    const input = parseStaffAnnouncementInput("withdraw", { expected_latest_version_id: versionId, release_version_id: branch, reason: "合成撤回理由" }, key);
    const first = beginStaffAnnouncement(scope, false, input, sourceAt, { ...target, version: 2, activeReleaseVersionId: branch })!;
    const committedAt = "2026-09-26T10:00:02.000Z";
    const data = { action: "withdraw" as const, versionId: actor, announcementKey, version: 3, previousVersionId: versionId,
      lifecycle: "withdrawn" as const, releaseVersionId: branch, reason: "合成撤回理由", withdrawnAt: committedAt,
      replayed: false, persisted: true as const, demo: false as const };
    expect(() => settleStaffAnnouncement(first, { requestId, data: { ...data, versionId } })).toThrow();
    expect(() => settleStaffAnnouncement(first, { requestId, data: { ...data, versionId: branch } })).toThrow();
    settleStaffAnnouncement(first, { requestId, data });
    const snapshot = freshSnapshot(); const item = { ...snapshot.items[0], versionId: actor, version: 3,
      versionState: "withdrawal" as const, lifecycle: "withdrawn" as const, activeReleaseVersionId: branch };
    reconcileStaffAnnouncementConfirmed(scope, { ...snapshot, items: [item] }, Date.parse(freshAt));
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(1);
    const current = { ...snapshot, generatedAt: committedAt };
    reconcileStaffAnnouncementConfirmed(scope, { ...current, items: [{ ...item, lifecycle: "published" }] }, Date.parse(committedAt));
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(1);
    reconcileStaffAnnouncementConfirmed(scope, { ...current, items: [item] }, Date.parse(committedAt));
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(0);
  });
  it("blocks any same-chain stale predecessor but not unrelated targets, and never clears wrong action state", () => {
    const first = beginStaffAnnouncement(scope, false, draft(), sourceAt)!; settleStaffAnnouncement(first, savedDraft());
    const input = parseStaffAnnouncementInput("read", { release_version_id: versionId }, key);
    expect(hasStaffAnnouncementConfirmedTarget(scope, false, input, target)).toBe(true);
    expect(hasStaffAnnouncementConfirmedTarget(scope, false, input, { ...target, announcementKey: org })).toBe(false);
    const snapshot = freshSnapshot();
    reconcileStaffAnnouncementConfirmed(scope, { ...snapshot, items: [{ ...snapshot.items[0], versionState: "release" }] }, Date.parse(freshAt));
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(1);
    reconcileStaffAnnouncementConfirmed(scope, { ...snapshot, items: [{ ...snapshot.items[0], version: 2, versionId: org }] }, Date.parse(freshAt));
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(0);
  });
  it("caps unreconciled success markers at 32 without removing older positive evidence", () => {
    for (let index = 0; index < 32; index += 1) {
      const nextActor = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
      const nextScope = { ...scope, userId: nextActor };
      observeStaffAnnouncementAuthority(authority({ userId: nextActor }));
      const first = beginStaffAnnouncement(nextScope, false, draft(), sourceAt)!;
      expect(first).not.toBeNull(); settleStaffAnnouncement(first, savedDraft());
    }
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(32);
    expect(beginStaffAnnouncement(scope, false, draft(), sourceAt)).toBeNull();
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(32);
    expect(hasPendingOperations()).toBe(false);
  });
  it("rolls back only its own lease on navigation guard installation failure", () => {
    const original = document.addEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation((type, listener, options) => {
      if (type === "click") throw new Error("synthetic install failure"); original(type, listener, options);
    });
    expect(() => beginStaffAnnouncement(scope, false, draft(), sourceAt)).toThrow();
    expect(getStaffAnnouncementPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(false);
  });
  it("uses existing zero-payload navigation guards until resolved across unmount", () => {
    beginStaffAnnouncement(scope, false, draft(), sourceAt);
    const link = document.createElement("a"); link.href = "https://finance.example.invalid/"; document.body.append(link);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true }); link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(getStaffAnnouncementPending().navigationBlocked).toBe(true); link.remove();
  });
  it("normalizes identities but never touches persistent payload storage", () => {
    const set = vi.spyOn(Storage.prototype, "setItem"); const get = vi.spyOn(Storage.prototype, "getItem");
    expect(staffAnnouncementScopeIdentity(scope, false)).toBe(staffAnnouncementScopeIdentity({ ...scope, userId: actor.toUpperCase() }, false));
    beginStaffAnnouncement(scope, false, draft(), sourceAt); expect(set).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });
  it.each([[400, "INVALID_STAFF_ANNOUNCEMENT"], [401, "AUTH_REQUIRED"], [403, "STAFF_ANNOUNCEMENT_NOT_AUTHORIZED"],
    [409, "STAFF_ANNOUNCEMENT_VERSION_CONFLICT"], [413, "REQUEST_TOO_LARGE"]])("classifies only exact known noncommit errors %s/%s", (status, code) => {
    const denied = { requestId, status: "error", data: null, errors: [{ code, message: "合成拒絕" }] };
    expect(isConfirmedStaffAnnouncementRejection(denied, Number(status))).toBe(true);
    expect(isConfirmedStaffAnnouncementRejection({ ...denied, private: "secret" }, Number(status))).toBe(false);
    expect(isConfirmedStaffAnnouncementRejection({ ...denied, errors: [{ code: "STAFF_ANNOUNCEMENT_SAVE_FAILED", message: "未知" }] }, 409)).toBe(false);
  });
});

describe("confirmed-only original operation receipt checks", () => {
  const nonce = "88888888-8888-4888-8888-888888888888";
  const verifiedAt = "2026-09-26T10:00:03.000Z";
  const recordedAt = "2026-09-26T10:00:02.000Z";
  function confirmedDraft() {
    const operation = beginStaffAnnouncement(scope, false, draft(), sourceAt)!;
    settleStaffAnnouncement(operation, savedDraft()); return getStaffAnnouncementPending().confirmed[0];
  }
  function proof(check: NonNullable<ReturnType<typeof beginStaffAnnouncementReceiptCheck>>) {
    const entry = check.entry;
    return parseStaffAnnouncementReceipt({ schemaVersion: 1, status: "committed", persisted: true, demo: false,
      organizationId: org, branchId: branch, actorUserId: actor, action: entry.action, idempotencyKey: entry.idempotencyKey,
      nonce: check.request.nonce, verifiedAt, evidence: { announcementKey: entry.announcementKey,
        versionId: entry.versionId, version: entry.version, sourceVersionId: entry.sourceVersionId,
        releaseVersionId: entry.releaseVersionId, effectiveAt: entry.readAt ?? entry.committedAt, recordedAt } }, check.request);
  }
  it("retains original key/source and only marks verified, without clearing source guard or pretending list updated", () => {
    const entry = confirmedDraft(); expect(entry.idempotencyKey).toBe(key); expect(entry.sourceVersionId).toBeNull(); expect(entry.verifiedAt).toBeNull();
    const check = beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)!;
    expect(check).not.toBeNull(); expect(hasPendingOperations()).toBe(false);
    expect(settleStaffAnnouncementReceiptCheck(check, proof(check))).toBe(true);
    const current = getStaffAnnouncementPending().confirmed[0];
    expect(current.verifiedAt).toBe(verifiedAt); expect(current.versionId).toBe(versionId);
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(1); expect(getStaffAnnouncementPending().receiptCheck).toBeNull();
    expect(hasStaffAnnouncementConfirmedTarget(scope, false, draft())).toBe(true);
    expect(beginStaffAnnouncement(scope, false, draft(), freshAt)).toBeNull();
    expect(beginStaffAnnouncementReceiptCheck(current, scope, false, nonce)).toBeNull();
    reconcileStaffAnnouncementConfirmed(scope, freshSnapshot(), Date.parse(freshAt));
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(0);
  });
  it("never invents a marker from a forged, absent, stale-reference or foreign entry", () => {
    const entry = confirmedDraft();
    expect(beginStaffAnnouncementReceiptCheck({ ...entry }, scope, false, nonce)).toBeNull();
    expect(beginStaffAnnouncementReceiptCheck(entry, { ...scope, userId: org }, false, nonce)).toBeNull();
    expect(beginStaffAnnouncementReceiptCheck(entry, scope, true, nonce)).toBeNull();
    observeStaffAnnouncementAuthority(authority({ branchId: org }));
    expect(beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)).toBeNull();
    observeStaffAnnouncementAuthority(authority());
    reconcileStaffAnnouncementConfirmed(scope, freshSnapshot(), Date.parse(freshAt));
    expect(beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)).toBeNull();
  });
  it("holds at most one GET and blocks another write or retry without acquiring a mutation lease", () => {
    const entry = confirmedDraft(); const check = beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)!;
    expect(beginStaffAnnouncementReceiptCheck(entry, scope, false, org)).toBeNull();
    expect(beginStaffAnnouncement(scope, false, parseStaffAnnouncementInput("read", { release_version_id: org }, branch), sourceAt,
      { ...target, announcementKey: org, versionId: org, activeReleaseVersionId: org })).toBeNull();
    expect(retryStaffAnnouncement(Symbol(), scope, false)).toBeNull(); expect(hasPendingOperations()).toBe(false);
    expect(failStaffAnnouncementReceiptCheck(check)).toBe(true); expect(getStaffAnnouncementPending().confirmed[0]).toBe(entry);
    expect(failStaffAnnouncementReceiptCheck(check)).toBe(false);
  });
  it("does not trust a copied check that reuses an opaque token with replaced request or entry", () => {
    const entry = confirmedDraft(); const check = beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)!;
    const copied = { ...check, entry: { ...entry, announcementKey: org }, request: { ...check.request, nonce: org } };
    expect(settleStaffAnnouncementReceiptCheck(copied, proof(check))).toBe(false);
    expect(failStaffAnnouncementReceiptCheck(copied)).toBe(false);
    expect(getStaffAnnouncementPending().receiptCheck).toBe(check); expect(getStaffAnnouncementPending().confirmed[0]).toBe(entry);
  });
  it("not_found and transport failure leave the original marker unverified and cannot clear an unknown write", () => {
    const entry = confirmedDraft(); const check = beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)!;
    const missing = parseStaffAnnouncementReceipt({ ...proof(check), status: "not_found", persisted: false, evidence: null }, check.request);
    expect(settleStaffAnnouncementReceiptCheck(check, missing)).toBe(true);
    expect(getStaffAnnouncementPending().confirmed[0]).toBe(entry); expect(entry.verifiedAt).toBeNull();
    const next = beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)!; failStaffAnnouncementReceiptCheck(next);
    expect(getStaffAnnouncementPending().confirmed[0]).toBe(entry);
    reconcileStaffAnnouncementConfirmed(scope, freshSnapshot(), Date.parse(freshAt));
    const original = beginStaffAnnouncement(scope, false, draft(), sourceAt)!; settleStaffAnnouncement(original, "unknown");
    const held = getStaffAnnouncementPending().operation;
    expect(beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)).toBeNull();
    expect(settleStaffAnnouncementReceiptCheck(next, proof(next))).toBe(false);
    expect(getStaffAnnouncementPending().operation).toBe(held); expect(hasPendingOperations()).toBe(true);
  });
  it("preserves exact historical read ID/version/source/read_at even after another release replaces it", () => {
    const input = parseStaffAnnouncementInput("read", { release_version_id: versionId }, key);
    const operation = beginStaffAnnouncement(scope, false, input, sourceAt, { ...target, version: 7 })!;
    const oldReadAt = "2025-09-26T10:00:00.000Z";
    settleStaffAnnouncement(operation, { requestId, data: { action: "read", releaseVersionId: versionId, announcementKey,
      readAt: oldReadAt, replayed: true, persisted: true, demo: false } });
    const entry = getStaffAnnouncementPending().confirmed[0];
    expect(entry).toMatchObject({ idempotencyKey: key, versionId, version: 7, sourceVersionId: versionId, releaseVersionId: versionId });
    const snapshot = freshSnapshot(); reconcileStaffAnnouncementConfirmed(scope, { ...snapshot,
      items: [{ ...snapshot.items[0], version: 8, versionId: org, activeReleaseVersionId: org, actorIsRecipient: true, actorReadAt: freshAt }] }, Date.parse(freshAt));
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(1);
    const check = beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)!;
    const receipt = proof(check); expect(settleStaffAnnouncementReceiptCheck(check, receipt)).toBe(true);
    expect(getStaffAnnouncementPending().confirmed[0].verifiedAt).toBe(verifiedAt);
    expect(getStaffAnnouncementPending().confirmed[0].readAt).toBe(oldReadAt);
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(1);
  });
  it.each(["announcementKey", "versionId", "version", "sourceVersionId", "releaseVersionId", "effectiveAt"])(
    "rejects structurally valid but wrong exact original read %s", (field) => {
      const input = parseStaffAnnouncementInput("read", { release_version_id: versionId }, key);
      const operation = beginStaffAnnouncement(scope, false, input, sourceAt, target)!;
      settleStaffAnnouncement(operation, { requestId, data: { action: "read", releaseVersionId: versionId, announcementKey,
        readAt: freshAt, replayed: false, persisted: true, demo: false } });
      const entry = getStaffAnnouncementPending().confirmed[0]; const check = beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)!;
      const receipt = proof(check); if (receipt.status !== "committed") throw new Error("test requires committed");
      const evidence = { ...receipt.evidence, [field]: field === "version" ? 2 : field === "effectiveAt" ? sourceAt : org };
      if (["versionId", "sourceVersionId", "releaseVersionId"].includes(field)) {
        evidence.versionId = org; evidence.sourceVersionId = org; evidence.releaseVersionId = org;
      }
      expect(() => settleStaffAnnouncementReceiptCheck(check, { ...receipt, evidence })).toThrow();
      expect(getStaffAnnouncementPending().confirmed[0]).toBe(entry); expect(entry.verifiedAt).toBeNull();
      failStaffAnnouncementReceiptCheck(check);
    });
  it("retains publish and withdrawal sources and demands the original withdrawal time", () => {
    const publish = parseStaffAnnouncementInput("publish", { draft_version_id: versionId }, key);
    const operation = beginStaffAnnouncement(scope, false, publish, sourceAt, { ...target, publishAt: freshAt, expiresAt: null })!;
    settleStaffAnnouncement(operation, { requestId, data: { action: "publish", versionId: branch, announcementKey, version: 2,
      draftVersionId: versionId, lifecycle: "scheduled", publishAt: freshAt, expiresAt: null, recipientCount: 1,
      replayed: false, persisted: true, demo: false } });
    const entry = getStaffAnnouncementPending().confirmed[0]; expect(entry.sourceVersionId).toBe(versionId);
    const check = beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)!; settleStaffAnnouncementReceiptCheck(check, proof(check));
    expect(getStaffAnnouncementPending().confirmed[0].releaseVersionId).toBe(branch);
    clearStaffAnnouncementPendingOnLogout(); observeStaffAnnouncementAuthority(authority());
    const withdraw = parseStaffAnnouncementInput("withdraw", { expected_latest_version_id: versionId, release_version_id: branch, reason: "合成撤回" }, key);
    const withdrawal = beginStaffAnnouncement(scope, false, withdraw, sourceAt, { ...target, version: 2, activeReleaseVersionId: branch })!;
    settleStaffAnnouncement(withdrawal, { requestId, data: { action: "withdraw", versionId: actor, announcementKey, version: 3,
      previousVersionId: versionId, lifecycle: "withdrawn", releaseVersionId: branch, reason: "合成撤回", withdrawnAt: freshAt,
      replayed: false, persisted: true, demo: false } });
    const withdrawn = getStaffAnnouncementPending().confirmed[0]; expect(withdrawn.sourceVersionId).toBe(versionId);
    const withdrawalCheck = beginStaffAnnouncementReceiptCheck(withdrawn, scope, false, nonce)!;
    const receipt = proof(withdrawalCheck); if (receipt.status !== "committed") throw new Error("test requires committed");
    expect(() => settleStaffAnnouncementReceiptCheck(withdrawalCheck, { ...receipt,
      evidence: { ...receipt.evidence, effectiveAt: sourceAt } })).toThrow();
    expect(settleStaffAnnouncementReceiptCheck(withdrawalCheck, receipt)).toBe(true);
  });
  it("discards authority/scope ABA checks atomically and late callbacks cannot clear a newer GET", () => {
    const entry = confirmedDraft(); const original = beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)!;
    observeStaffAnnouncementAuthority(authority({ scopes: ["announcements.read"] }));
    expect(getStaffAnnouncementPending().receiptCheck).toBeNull();
    observeStaffAnnouncementAuthority(authority());
    const newer = beginStaffAnnouncementReceiptCheck(entry, scope, false, org)!;
    expect(settleStaffAnnouncementReceiptCheck(original, proof(original))).toBe(false);
    expect(failStaffAnnouncementReceiptCheck(original)).toBe(false); expect(getStaffAnnouncementPending().receiptCheck).toBe(newer);
    expect(settleStaffAnnouncementReceiptCheck(newer, proof(newer))).toBe(true);
  });
  it("logout rejects old proof and failure without releasing an unrelated lease or marking the new actor", () => {
    const entry = confirmedDraft(); const check = beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)!;
    clearStaffAnnouncementPendingOnLogout(); observeStaffAnnouncementAuthority(authority({ userId: org }));
    const external = tryAcquirePendingOperation()!;
    expect(settleStaffAnnouncementReceiptCheck(check, proof(check))).toBe(false); expect(failStaffAnnouncementReceiptCheck(check)).toBe(false);
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(0); expect(hasPendingOperations()).toBe(true); external();
  });
  it("a fresh snapshot removing the checked marker never lets late GET recreate it", () => {
    const entry = confirmedDraft(); const check = beginStaffAnnouncementReceiptCheck(entry, scope, false, nonce)!;
    reconcileStaffAnnouncementConfirmed(scope, freshSnapshot(), Date.parse(freshAt));
    expect(settleStaffAnnouncementReceiptCheck(check, proof(check))).toBe(true);
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(0); expect(getStaffAnnouncementPending().receiptCheck).toBeNull();
  });
  it("keeps the 32-marker cap after verification while still allowing one exact GET at the cap", () => {
    let last!: StaffAnnouncementConfirmed; let lastScope = scope;
    for (let index = 0; index < 32; index += 1) {
      const userId = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
      lastScope = { ...scope, userId }; observeStaffAnnouncementAuthority(authority({ userId }));
      const operation = beginStaffAnnouncement(lastScope, false, draft(), sourceAt)!; settleStaffAnnouncement(operation, savedDraft());
      last = getStaffAnnouncementPending().confirmed.at(-1)!;
    }
    const check = beginStaffAnnouncementReceiptCheck(last, lastScope, false, nonce)!; expect(check).not.toBeNull();
    const receipt = { schemaVersion: 1, status: "committed", persisted: true, demo: false,
      organizationId: org, branchId: branch, actorUserId: lastScope.userId, action: last.action,
      idempotencyKey: last.idempotencyKey, nonce, verifiedAt, evidence: { announcementKey, versionId, version: 1,
        sourceVersionId: null, releaseVersionId: null, effectiveAt: null, recordedAt } };
    settleStaffAnnouncementReceiptCheck(check, parseStaffAnnouncementReceipt(receipt, check.request));
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(32);
    expect(getStaffAnnouncementPending().confirmed.at(-1)?.verifiedAt).toBe(verifiedAt);
    expect(beginStaffAnnouncement(lastScope, false, draft(), freshAt)).toBeNull();
  });
});
