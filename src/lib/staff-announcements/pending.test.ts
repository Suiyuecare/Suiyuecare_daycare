// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { hasPendingOperations, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { parseStaffAnnouncementInput } from "@/lib/integrations/staff-announcements";
import { buildDemoStaffAnnouncementSnapshot } from "./demo";
import { beginStaffAnnouncement, clearStaffAnnouncementPendingOnLogout, getStaffAnnouncementPending,
  isConfirmedStaffAnnouncementRejection, observeStaffAnnouncementAuthority, reconcileStaffAnnouncementConfirmed,
  retryStaffAnnouncement, settleStaffAnnouncement, staffAnnouncementAuthoritySignature, staffAnnouncementScopeIdentity,
  hasStaffAnnouncementConfirmedTarget } from "./pending";

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
