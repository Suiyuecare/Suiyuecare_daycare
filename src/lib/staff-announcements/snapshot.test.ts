import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { DEFAULT_STAFF_ANNOUNCEMENT_FILTERS } from "./query";

const mocks = vi.hoisted(() => ({ db: vi.fn(), rpc: vi.fn(), single: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.db }));
import { loadStaffAnnouncementSnapshot, StaffAnnouncementSnapshotError } from "./snapshot";

const context: TenantContext = {
  organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222",
  organizationName: "合成機構", branchName: "合成分支", userId: "33333333-3333-4333-8333-333333333333",
  displayName: "合成管理員", roles: ["organization_manager"], scopes: ["announcements.read", "announcements.manage"],
  assuranceLevel: "aal1", recentAal2At: null, demo: false,
};
function emptyRow() {
  return {
    organization_id: context.organizationId, branch_id: context.branchId, generated_at: "2026-09-26T09:00:00Z",
    announcements: [], summary: { available_total: 0, items_truncated: false, matching_total: 0, draft_total: 0, unreleased_total: 0, scheduled_total: 0, published_total: 0, expired_total: 0, withdrawn_total: 0, unread_recipient_total: 0 },
    staff_options: [], role_options: [], selected_release_version_id: null, selected_announcement: null, selected_recipients: [],
    can_manage: true, delivery_boundary: "staff_portal_read_receipts_only", expiry_rule: "explicit_datetime_or_explicit_no_expiry",
    pagination: { page: 1, page_size: 20, total_pages: 1, range_start: 0, range_end: 0 },
  };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.db.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockReturnValue({ maybeSingle: mocks.single });
  mocks.single.mockResolvedValue({ data: emptyRow(), error: null });
});
describe("announcement bounded snapshot loader", () => {
  it("queries the v2 server filter exactly and binds scope only from actor", async () => {
    const result = await loadStaffAnnouncementSnapshot(context, null, { ...DEFAULT_STAFF_ANNOUNCEMENT_FILTERS, query: " %_\\ ", status: "published", page: 10000 });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("staff_announcement_management_snapshot_v2", {
      p_expected_organization_id: context.organizationId, p_expected_branch_id: context.branchId,
      p_selected_release_version_id: null, p_query: " %_\\ ", p_status: "published", p_page: 10000, p_page_size: 20,
    });
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, matchingTotal: 0, totalPages: 1, rangeStart: 0, rangeEnd: 0 });
    expect(result.items).toEqual([]);
  });
  it("rejects lack of read permission before any database call", async () => {
    await expect(loadStaffAnnouncementSnapshot({ ...context, scopes: [] }, null)).rejects.toBeInstanceOf(StaffAnnouncementSnapshotError);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("never silently suppresses recipient-detail request for an ordinary reader", async () => {
    await expect(loadStaffAnnouncementSnapshot({ ...context, scopes: ["announcements.read"] }, context.userId)).rejects.toBeInstanceOf(StaffAnnouncementSnapshotError);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each([
    { query: "x".repeat(121) }, { status: "bogus" }, { page: 0 }, { pageSize: 10 },
  ])("rejects malformed direct loader filters before database %#", async (change) => {
    await expect(loadStaffAnnouncementSnapshot(context, null, { ...DEFAULT_STAFF_ANNOUNCEMENT_FILTERS, ...change } as typeof DEFAULT_STAFF_ANNOUNCEMENT_FILTERS)).rejects.toBeInstanceOf(StaffAnnouncementSnapshotError);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("rejects malformed direct selected release before database", async () => {
    await expect(loadStaffAnnouncementSnapshot(context, "invalid")).rejects.toBeInstanceOf(StaffAnnouncementSnapshotError);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each([
    { branch_id: context.organizationId }, { private_content: "secret" },
    { announcements: [{ private_content: "secret" }] }, { pagination: { page: 0 } },
  ])("fails closed on malformed/cross-scope snapshot without exposing internals %#", async (change) => {
    mocks.single.mockResolvedValue({ data: { ...emptyRow(), ...change }, error: null });
    await expect(loadStaffAnnouncementSnapshot(context, null)).rejects.toThrow("STAFF_ANNOUNCEMENT_SNAPSHOT_UNAVAILABLE");
  });
  it("does not fall back to capped v1 data on database or v2 deployment failure", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { message: "private DB error" } });
    await expect(loadStaffAnnouncementSnapshot(context, null)).rejects.toThrow("STAFF_ANNOUNCEMENT_SNAPSHOT_UNAVAILABLE");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("uses synthetic-only page semantics in demo without real backend calls", async () => {
    const result = await loadStaffAnnouncementSnapshot({ ...context, demo: true }, null, { ...DEFAULT_STAFF_ANNOUNCEMENT_FILTERS, query: "中秋", page: 99 });
    expect(result.pagination.matchingTotal).toBe(1); expect(result.pagination.page).toBe(1); expect(result.demo).toBe(true);
    expect(mocks.db).not.toHaveBeenCalled();
  });
});
