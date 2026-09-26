// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TenantContext } from "@/lib/domain/types";
import { parseStaffAnnouncementInput } from "@/lib/integrations/staff-announcements";
import { hasPendingOperations, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";

import {
  beginStaffAnnouncement,
  clearStaffAnnouncementPendingOnLogout,
  getStaffAnnouncementPending,
  observeStaffAnnouncementAuthority,
  retryStaffAnnouncement,
  settleStaffAnnouncement,
  staffAnnouncementAuthoritySignature,
  type StaffAnnouncementScope,
  type StaffAnnouncementTarget,
} from "./pending";

const SOURCE_AT = "2026-09-26T10:00:00.000Z";
const PUBLISH_AT = "2026-09-26T10:01:00.000Z";
const KEY_A = "d1010000-0000-4000-8000-000000000001";
const KEY_B = "d1010000-0000-4000-8000-000000000002";
const VERSION_ID = "d1020000-0000-4000-8000-000000000001";
const RELEASE_ID = "d1020000-0000-4000-8000-000000000002";
const OTHER_ID = "d1020000-0000-4000-8000-000000000003";
const CHAIN_ID = "d1030000-0000-4000-8000-000000000001";
const REQUEST_ID = "d1040000-0000-4000-8000-000000000001";

const contextA: TenantContext = {
  organizationId: "d1050000-0000-4000-8000-000000000001",
  branchId: "d1060000-0000-4000-8000-000000000001",
  userId: "d1070000-0000-4000-8000-000000000001",
  organizationName: "獨立合成測試機構",
  branchName: "合成分支 A",
  displayName: "合成管理員 A",
  roles: ["organization_manager"],
  scopes: ["announcements.read", "announcements.manage", "announcements.publish"],
  assuranceLevel: "aal2",
  recentAal2At: SOURCE_AT,
  demo: false,
};
const contextB: TenantContext = {
  ...contextA,
  branchId: "d1060000-0000-4000-8000-000000000002",
  userId: "d1070000-0000-4000-8000-000000000002",
  branchName: "合成分支 B",
  displayName: "合成管理員 B",
};

function scopeOf(context: TenantContext): StaffAnnouncementScope {
  return {
    organizationId: context.organizationId,
    branchId: context.branchId,
    userId: context.userId,
  };
}

function observe(context: TenantContext) {
  observeStaffAnnouncementAuthority(staffAnnouncementAuthoritySignature(context));
}

function newDraft(context = contextA, key = KEY_A) {
  return parseStaffAnnouncementInput("draft", {
    previous_version_id: null,
    title: "獨立合成公告",
    body: "不包含任何真實個案或員工資料。",
    publish_at: PUBLISH_AT,
    expires_at: null,
    audience_user_ids: [context.userId],
    audience_role_ids: [],
    change_reason: null,
  }, key);
}

function savedDraft() {
  return {
    requestId: REQUEST_ID,
    data: {
      action: "draft" as const,
      versionId: VERSION_ID,
      announcementKey: CHAIN_ID,
      version: 1,
      previousVersionId: null,
      versionState: "draft" as const,
      publishAt: PUBLISH_AT,
      expiresAt: null,
      replayed: false,
      persisted: true as const,
      demo: false as const,
    },
  };
}

beforeEach(() => {
  clearStaffAnnouncementPendingOnLogout();
  observe(contextA);
});
afterEach(() => clearStaffAnnouncementPendingOnLogout());

describe("independent announcement boundary regression", () => {
  it("rejects stale A begin and retry while the actual observed actor and branch are B", () => {
    observe(contextB);
    expect(beginStaffAnnouncement(scopeOf(contextA), false, newDraft(), SOURCE_AT)).toBeNull();
    expect(getStaffAnnouncementPending().operation).toBeNull();
    expect(hasPendingOperations()).toBe(false);

    observe(contextA);
    const original = beginStaffAnnouncement(scopeOf(contextA), false, newDraft(), SOURCE_AT)!;
    expect(original).not.toBeNull();
    settleStaffAnnouncement(original, "unknown");
    observe(contextB);
    const held = getStaffAnnouncementPending().operation;
    expect(retryStaffAnnouncement(original.token, scopeOf(contextA), false)).toBeNull();
    expect(getStaffAnnouncementPending().operation).toBe(held);
    expect(held?.body).toBe(original.body);
    expect(held?.input.idempotencyKey).toBe(KEY_A);
    expect(hasPendingOperations()).toBe(true);

    observe(contextA);
    const resumed = retryStaffAnnouncement(original.token, scopeOf(contextA), false)!;
    expect(resumed.body).toBe(original.body);
    expect(resumed.input.idempotencyKey).toBe(KEY_A);
    expect(resumed.attempt).not.toBe(original.attempt);
  });

  it("cannot let any late A result settle or release B's new operation after explicit logout", () => {
    const oldOperation = beginStaffAnnouncement(scopeOf(contextA), false, newDraft(), SOURCE_AT)!;
    clearStaffAnnouncementPendingOnLogout();
    observe(contextB);
    const nextOperation = beginStaffAnnouncement(scopeOf(contextB), false, newDraft(contextB, KEY_B), SOURCE_AT)!;
    expect(nextOperation).not.toBeNull();
    expect(nextOperation.token).not.toBe(oldOperation.token);

    expect(settleStaffAnnouncement(oldOperation, savedDraft())).toBe(false);
    expect(settleStaffAnnouncement(oldOperation, "denied")).toBe(false);
    expect(settleStaffAnnouncement(oldOperation, "unknown")).toBe(false);
    expect(getStaffAnnouncementPending().operation).toBe(nextOperation);
    expect(getStaffAnnouncementPending().confirmed).toHaveLength(0);
    expect(nextOperation.scope).toEqual(scopeOf(contextB));
    expect(hasPendingOperations()).toBe(true);

    expect(settleStaffAnnouncement(nextOperation, "denied")).toBe(true);
    expect(hasPendingOperations()).toBe(false);
  });

  it("rejects mismatched source IDs for all four actions before acquiring an operation lease", () => {
    const source: StaffAnnouncementTarget = {
      announcementKey: CHAIN_ID,
      version: 3,
      versionId: VERSION_ID,
      activeReleaseVersionId: RELEASE_ID,
      publishAt: PUBLISH_AT,
      expiresAt: null,
    };
    const wrongDraft = parseStaffAnnouncementInput("draft", {
      previous_version_id: OTHER_ID,
      title: "合成修訂",
      body: "合成修訂內容",
      publish_at: PUBLISH_AT,
      expires_at: null,
      audience_user_ids: [contextA.userId],
      audience_role_ids: [],
      change_reason: "合成修訂理由",
    }, KEY_A);
    const wrongPublish = parseStaffAnnouncementInput("publish", { draft_version_id: OTHER_ID }, KEY_A);
    const wrongWithdraw = parseStaffAnnouncementInput("withdraw", {
      expected_latest_version_id: VERSION_ID,
      release_version_id: OTHER_ID,
      reason: "合成撤回理由",
    }, KEY_A);
    const wrongRead = parseStaffAnnouncementInput("read", { release_version_id: VERSION_ID }, KEY_A);
    const releaseSource = { ...source, version: 2, versionId: RELEASE_ID };

    for (const [input, target] of [
      [wrongDraft, source],
      [wrongPublish, source],
      [wrongWithdraw, source],
      [wrongRead, releaseSource],
    ] as const) {
      expect(() => beginStaffAnnouncement(scopeOf(contextA), false, input, SOURCE_AT, target))
        .toThrow("INVALID_STAFF_ANNOUNCEMENT_SOURCE_BINDING");
      expect(getStaffAnnouncementPending().operation).toBeNull();
      expect(getStaffAnnouncementPending().confirmed).toHaveLength(0);
      expect(hasPendingOperations()).toBe(false);
    }
    const viewLease = tryAcquireViewTransition();
    expect(viewLease).not.toBeNull();
    viewLease?.();
  });
});
