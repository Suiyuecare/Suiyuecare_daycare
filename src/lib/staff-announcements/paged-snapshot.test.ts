import { describe, expect, it } from "vitest";
import { buildDemoStaffAnnouncementSnapshot } from "./demo";
import { filterStaffAnnouncementSnapshot, projectStaffAnnouncementPagedSnapshot, type StaffAnnouncementPagedSourceRow } from "./projection";
import { DEFAULT_STAFF_ANNOUNCEMENT_FILTERS } from "./query";
import type { StaffAnnouncementFilters, StaffAnnouncementItem } from "./types";

const org = "11111111-1111-4111-8111-111111111111";
const branch = "22222222-2222-4222-8222-222222222222";
const release = "68111111-1111-4111-8111-111111111112";
const demo = buildDemoStaffAnnouncementSnapshot({ organizationId: org, branchId: branch, selectedReleaseId: release });
function raw(item: StaffAnnouncementItem) {
  return {
    generated_at: demo.generatedAt, version_id: item.versionId, announcement_key: item.announcementKey,
    version: item.version, version_state: item.versionState, title: item.title, body: item.body,
    publish_at: item.publishAt, expires_at: item.expiresAt, lifecycle: item.lifecycle,
    has_pending_draft: item.hasPendingDraft, audience_user_ids: [...item.audienceUserIds], audience_role_ids: [...item.audienceRoleIds],
    active_release_version_id: item.activeReleaseVersionId, active_release_version: item.activeReleaseVersion,
    active_release_title: item.activeReleaseTitle, active_release_body: item.activeReleaseBody,
    active_release_publish_at: item.activeReleasePublishAt, active_release_expires_at: item.activeReleaseExpiresAt,
    recipient_count: item.recipientCount, read_count: item.readCount, unread_count: item.unreadCount,
    actor_is_recipient: item.actorIsRecipient, actor_read_at: item.actorReadAt,
    withdrawal_reason: item.withdrawalReason, can_manage: true,
  };
}
function fixture(): StaffAnnouncementPagedSourceRow {
  return {
    organization_id: org, branch_id: branch, generated_at: demo.generatedAt,
    announcements: [raw(demo.items[1])],
    summary: { available_total: 3, items_truncated: true, matching_total: 1, draft_total: 1, unreleased_total: 0, scheduled_total: 1, published_total: 1, expired_total: 0, withdrawn_total: 1, unread_recipient_total: 5 },
    staff_options: [], role_options: [], selected_release_version_id: release,
    selected_announcement: raw(demo.items[0]),
    selected_recipients: demo.selectedRecipients.map((item) => ({ recipient_user_id: item.userId, recipient_display_name: item.displayName, recipient_employee_code: item.employeeCode, recipient_profile_kind: item.profileKind, resolution_kind: item.resolutionKind, read_at: item.readAt })),
    can_manage: true, delivery_boundary: "staff_portal_read_receipts_only", expiry_rule: "explicit_datetime_or_explicit_no_expiry",
    pagination: { page: 1, page_size: 20, total_pages: 1, range_start: 1, range_end: 1 },
  };
}
const filters: StaffAnnouncementFilters = { ...DEFAULT_STAFF_ANNOUNCEMENT_FILTERS, query: "中秋" };
function project(row: unknown, overrides: Partial<StaffAnnouncementFilters> = {}) {
  return projectStaffAnnouncementPagedSnapshot({ row, expectedOrganizationId: org, expectedBranchId: branch, expectedCanManage: true, expectedSelectedReleaseId: release, expectedFilters: { ...filters, ...overrides }, demo: false });
}
describe("server-filtered announcement page proof", () => {
  it("projects off-page selected release counts independently of search results", () => {
    const result = project(fixture());
    expect(result.items).toHaveLength(1);
    expect(result.selectedAnnouncement?.activeReleaseVersionId).toBe(release);
    expect(result.selectedRecipients).toHaveLength(3);
    expect(result.pagination.matchingTotal).toBe(1);
    expect(result.availableTotal).toBe(3);
    expect(result.metrics.unreadRecipients).toBe(5);
  });
  it("clamps a valid excessive page to the final available page", () => {
    expect(project(fixture(), { page: 10000 }).pagination.page).toBe(1);
  });
  it("accepts a real sixth page after the old first-100 cap", () => {
    const row = fixture();
    const draft = raw(demo.items[0]);
    Object.assign(draft, { version_id: "68000101-1111-4111-8111-111111111111", announcement_key: "68000101-2222-4222-8222-222222222222", lifecycle: "draft", has_pending_draft: false, active_release_version_id: null, active_release_version: null, active_release_title: null, active_release_body: null, active_release_publish_at: null, active_release_expires_at: null, recipient_count: 0, read_count: 0, unread_count: 0, actor_is_recipient: false, actor_read_at: null });
    row.announcements = [draft];
    row.summary = { ...row.summary, available_total: 102, matching_total: 102, draft_total: 102, unreleased_total: 101, scheduled_total: 0, published_total: 1, withdrawn_total: 0, unread_recipient_total: 2 };
    row.announcements.push({ ...draft, version_id: "68000102-1111-4111-8111-111111111111", announcement_key: "68000102-2222-4222-8222-222222222222" });
    row.pagination = { page: 6, page_size: 20, total_pages: 6, range_start: 101, range_end: 102 };
    expect(project(row, { query: "", page: 6 }).pagination.rangeStart).toBe(101);
  });
  it.each([
    (row: StaffAnnouncementPagedSourceRow) => { row.branch_id = org; },
    (row: StaffAnnouncementPagedSourceRow) => { row.can_manage = false; },
    (row: StaffAnnouncementPagedSourceRow) => { row.pagination.page = 2; },
    (row: StaffAnnouncementPagedSourceRow) => { row.pagination.range_end = 2; },
    (row: StaffAnnouncementPagedSourceRow) => { row.pagination.page_size = 50; },
    (row: StaffAnnouncementPagedSourceRow) => { row.summary.matching_total = 4; },
    (row: StaffAnnouncementPagedSourceRow) => { row.summary.published_total = 0; },
    (row: StaffAnnouncementPagedSourceRow) => { row.announcements = []; },
    (row: StaffAnnouncementPagedSourceRow) => { row.announcements[0].title = "不符搜尋"; row.announcements[0].active_release_title = "不符搜尋"; },
    (row: StaffAnnouncementPagedSourceRow) => { row.selected_announcement = null; },
    (row: StaffAnnouncementPagedSourceRow) => { row.selected_announcement!.active_release_version_id = org; },
    (row: StaffAnnouncementPagedSourceRow) => { row.selected_announcement!.generated_at = "2026-09-01T00:00:00Z"; },
    (row: StaffAnnouncementPagedSourceRow) => { row.selected_recipients.pop(); },
    (row: StaffAnnouncementPagedSourceRow) => { row.selected_recipients[0].read_at = demo.generatedAt; },
  ])("rejects malformed/cross-scope/mixed-snapshot proof %#", (mutate) => {
    const row = fixture(); mutate(row);
    expect(() => project(row)).toThrow("INVALID_STAFF_ANNOUNCEMENT_PROJECTION");
  });
  it("fails closed if the selected row claims global counts that exclude it", () => {
    const row = fixture(); row.summary.draft_total = 0;
    expect(() => project(row)).toThrow();
  });
  it("keeps demo filtering, page clamp and off-page recipient ownership honest", () => {
    const result = buildDemoStaffAnnouncementSnapshot({ organizationId: org, branchId: branch, selectedReleaseId: release, filters: { ...filters, page: 10000 } });
    expect(result.items).toHaveLength(1);
    expect(result.selectedAnnouncement?.activeReleaseVersionId).toBe(release);
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, matchingTotal: 1, totalPages: 1, rangeStart: 1, rangeEnd: 1 });
    expect(result.demo).toBe(true);
  });
  it("does not silently drop an invalid selected demo release", () => {
    expect(() => buildDemoStaffAnnouncementSnapshot({ organizationId: org, branchId: branch, selectedReleaseId: org })).toThrow();
  });
  it("matches literal search exactly like SQL concat_ws when release fields are null", () => {
    const draft = { ...demo.items[0], title: "公告", body: "內容", activeReleaseTitle: null, activeReleaseBody: null };
    expect(filterStaffAnnouncementSnapshot({ ...demo, items: [draft] }, { query: "內容 ", status: "all" }).items).toHaveLength(0);
    expect(filterStaffAnnouncementSnapshot({ ...demo, items: [draft] }, { query: "公告 內容", status: "all" }).items).toHaveLength(1);
    expect(filterStaffAnnouncementSnapshot({ ...demo, items: [draft] }, { query: "%", status: "all" }).items).toHaveLength(0);
  });
});
