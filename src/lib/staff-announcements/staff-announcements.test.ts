import { describe, expect, it } from "vitest";

import { buildDemoStaffAnnouncementSnapshot } from "./demo";
import { filterStaffAnnouncementSnapshot, projectStaffAnnouncementManagementSnapshot } from "./projection";

const org = "11111111-1111-4111-8111-111111111111";
const branch = "22222222-2222-4222-8222-222222222222";
const release = "68111111-1111-4111-8111-111111111112";

describe("staff announcement projection", () => {
  it("keeps pending draft content distinct from active-release read totals", () => {
    const snapshot = buildDemoStaffAnnouncementSnapshot({ organizationId: org, branchId: branch, selectedReleaseId: release });
    const item = snapshot.items.find((value) => value.activeReleaseVersionId === release)!;
    expect(item.hasPendingDraft).toBe(true);
    expect(item.title).toContain("未發布草稿");
    expect(item.activeReleaseTitle).toBe("九月家訪交接");
    expect(item.readCount + item.unreadCount).toBe(item.recipientCount);
    expect(snapshot.selectedRecipients.filter((recipient) => recipient.readAt).length).toBe(item.readCount);
  });

  it("preserves full metrics while filtering only loaded rows", () => {
    const snapshot = buildDemoStaffAnnouncementSnapshot({ organizationId: org, branchId: branch, selectedReleaseId: null });
    const filtered = filterStaffAnnouncementSnapshot(snapshot, { query: "中秋", status: "all" });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.metrics).toEqual(snapshot.metrics);
    expect(filtered.availableTotal).toBe(snapshot.availableTotal);
  });

  it("fails closed on cross-tenant top-level correlation", () => {
    const snapshot = buildDemoStaffAnnouncementSnapshot({ organizationId: org, branchId: branch, selectedReleaseId: null });
    const row = {
      organization_id: "99999999-9999-4999-8999-999999999999",
      branch_id: branch, generated_at: snapshot.generatedAt,
      announcements: [],
      summary: { available_total: 0, items_truncated: false, draft_total: 0, unreleased_total: 0, scheduled_total: 0, published_total: 0, expired_total: 0, withdrawn_total: 0, unread_recipient_total: 0 },
      staff_options: [], role_options: [], selected_release_version_id: null,
      selected_recipients: [], can_manage: false,
      delivery_boundary: "staff_portal_read_receipts_only",
      expiry_rule: "explicit_datetime_or_explicit_no_expiry",
    };
    expect(() => projectStaffAnnouncementManagementSnapshot({ row, expectedOrganizationId: org, expectedBranchId: branch, expectedCanManage: false, expectedSelectedReleaseId: null, demo: false })).toThrow();
  });

  it("rejects aggregate/detail mismatches instead of guessing read totals", () => {
    const base = buildDemoStaffAnnouncementSnapshot({ organizationId: org, branchId: branch, selectedReleaseId: release });
    const announcement = base.items.find((item) => item.activeReleaseVersionId === release)!;
    const rawAnnouncement = {
      generated_at: base.generatedAt, version_id: announcement.versionId,
      announcement_key: announcement.announcementKey, version: announcement.version,
      version_state: announcement.versionState, title: announcement.title, body: announcement.body,
      publish_at: announcement.publishAt, expires_at: announcement.expiresAt,
      lifecycle: announcement.lifecycle, has_pending_draft: announcement.hasPendingDraft,
      audience_user_ids: announcement.audienceUserIds, audience_role_ids: announcement.audienceRoleIds,
      active_release_version_id: announcement.activeReleaseVersionId,
      active_release_version: announcement.activeReleaseVersion,
      active_release_title: announcement.activeReleaseTitle,
      active_release_body: announcement.activeReleaseBody,
      active_release_publish_at: announcement.activeReleasePublishAt,
      active_release_expires_at: announcement.activeReleaseExpiresAt,
      recipient_count: 3, read_count: 2, unread_count: 1,
      actor_is_recipient: true, actor_read_at: null, withdrawal_reason: null, can_manage: true,
    };
    const row = {
      organization_id: org, branch_id: branch, generated_at: base.generatedAt,
      announcements: [rawAnnouncement],
      summary: { available_total: 1, items_truncated: false, draft_total: 1, unreleased_total: 0, scheduled_total: 0, published_total: 1, expired_total: 0, withdrawn_total: 0, unread_recipient_total: 1 },
      staff_options: base.audienceStaff.map((item) => ({ user_id: item.userId, display_name: item.displayName, employee_code: item.employeeCode, profile_kind: item.profileKind })),
      role_options: base.audienceRoles.map((item) => ({ role_id: item.roleId, role_name: item.roleName })),
      selected_release_version_id: release,
      selected_recipients: base.selectedRecipients.map((item) => ({ recipient_user_id: item.userId, recipient_display_name: item.displayName, recipient_employee_code: item.employeeCode, recipient_profile_kind: item.profileKind, resolution_kind: item.resolutionKind, read_at: item.readAt })),
      can_manage: true, delivery_boundary: "staff_portal_read_receipts_only",
      expiry_rule: "explicit_datetime_or_explicit_no_expiry",
    };
    expect(() => projectStaffAnnouncementManagementSnapshot({ row, expectedOrganizationId: org, expectedBranchId: branch, expectedCanManage: true, expectedSelectedReleaseId: release, demo: false })).toThrow();
  });
});
