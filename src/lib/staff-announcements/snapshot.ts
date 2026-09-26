import "server-only";
import { z } from "zod";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoStaffAnnouncementSnapshot } from "./demo";
import { projectStaffAnnouncementPagedSnapshot } from "./projection";
import { DEFAULT_STAFF_ANNOUNCEMENT_FILTERS, validateStaffAnnouncementFilters } from "./query";
import type { StaffAnnouncementFilters } from "./types";

export class StaffAnnouncementSnapshotError extends Error {
  constructor() {
    super("STAFF_ANNOUNCEMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "StaffAnnouncementSnapshotError";
  }
}

export async function loadStaffAnnouncementSnapshot(
  context: TenantContext,
  selectedReleaseId: string | null,
  filters: StaffAnnouncementFilters = DEFAULT_STAFF_ANNOUNCEMENT_FILTERS,
) {
  if (!context.demo && !context.scopes.includes("announcements.read")) {
    throw new StaffAnnouncementSnapshotError();
  }
  const canManage = context.demo || context.scopes.includes("announcements.manage");
  if (selectedReleaseId !== null && !canManage) throw new StaffAnnouncementSnapshotError();
  const releaseId = selectedReleaseId;
  try {
    validateStaffAnnouncementFilters(filters);
    if (releaseId !== null && !z.uuid().safeParse(releaseId).success) throw new StaffAnnouncementSnapshotError();
    if (context.demo) return buildDemoStaffAnnouncementSnapshot({
      organizationId: context.organizationId, branchId: context.branchId,
      selectedReleaseId, filters,
    });
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new StaffAnnouncementSnapshotError();
    const { data, error } = await supabase.rpc(
      "staff_announcement_management_snapshot_v2",
      {
        p_expected_organization_id: context.organizationId,
        p_expected_branch_id: context.branchId,
        p_selected_release_version_id: releaseId,
        p_query: filters.query, p_status: filters.status,
        p_page: filters.page, p_page_size: filters.pageSize,
      },
    ).maybeSingle();
    if (error || !data) throw new StaffAnnouncementSnapshotError();
    return projectStaffAnnouncementPagedSnapshot({
      row: data, expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, expectedCanManage: canManage,
      expectedSelectedReleaseId: releaseId, expectedFilters: filters, demo: false,
    });
  } catch {
    throw new StaffAnnouncementSnapshotError();
  }
}
