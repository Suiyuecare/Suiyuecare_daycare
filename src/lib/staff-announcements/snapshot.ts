import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoStaffAnnouncementSnapshot } from "./demo";
import { projectStaffAnnouncementManagementSnapshot } from "./projection";

export class StaffAnnouncementSnapshotError extends Error {
  constructor() {
    super("STAFF_ANNOUNCEMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "StaffAnnouncementSnapshotError";
  }
}

export async function loadStaffAnnouncementSnapshot(
  context: TenantContext,
  selectedReleaseId: string | null,
) {
  if (context.demo) return buildDemoStaffAnnouncementSnapshot({
    organizationId: context.organizationId,
    branchId: context.branchId,
    selectedReleaseId,
  });
  if (!context.scopes.includes("announcements.read")) {
    throw new StaffAnnouncementSnapshotError();
  }
  const canManage = context.scopes.includes("announcements.manage");
  const releaseId = canManage ? selectedReleaseId : null;
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new StaffAnnouncementSnapshotError();
  try {
    const { data, error } = await supabase.rpc(
      "staff_announcement_management_snapshot",
      {
        p_expected_organization_id: context.organizationId,
        p_expected_branch_id: context.branchId,
        p_selected_release_version_id: releaseId,
      },
    ).maybeSingle();
    if (error || !data) throw new StaffAnnouncementSnapshotError();
    return projectStaffAnnouncementManagementSnapshot({
      row: data, expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, expectedCanManage: canManage,
      expectedSelectedReleaseId: releaseId, demo: false,
    });
  } catch {
    throw new StaffAnnouncementSnapshotError();
  }
}
