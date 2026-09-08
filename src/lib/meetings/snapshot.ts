import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoMeetingManagementSnapshot } from "./demo";
import {
  projectMeetingManagementSnapshot,
  type MeetingSnapshotSourceRow,
} from "./projection";

export class MeetingManagementSnapshotError extends Error {
  constructor() {
    super("MEETING_MANAGEMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "MeetingManagementSnapshotError";
  }
}

export async function loadMeetingManagementSnapshot(context: TenantContext) {
  if (context.demo) return buildDemoMeetingManagementSnapshot({
    organizationId: context.organizationId,
    branchId: context.branchId,
  });
  if (
    context.assuranceLevel !== "aal2" ||
    !context.scopes.includes("meetings.read")
  ) throw new MeetingManagementSnapshotError();

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new MeetingManagementSnapshotError();
  const { data, error } = await supabase.rpc("meeting_management_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
  }).maybeSingle<MeetingSnapshotSourceRow>();
  if (error || !data) throw new MeetingManagementSnapshotError();
  try {
    return projectMeetingManagementSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new MeetingManagementSnapshotError();
  }
}
