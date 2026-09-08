import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoStaffTrainingSnapshot } from "./demo";
import {
  projectStaffTrainingSnapshot,
  type StaffTrainingSnapshotSourceRow,
} from "./projection";
import type { StaffTrainingFilters } from "./types";

export class StaffTrainingSnapshotError extends Error {
  constructor() {
    super("STAFF_TRAINING_SNAPSHOT_UNAVAILABLE");
    this.name = "StaffTrainingSnapshotError";
  }
}

export async function loadStaffTrainingSnapshot(
  context: TenantContext,
  filters: StaffTrainingFilters,
) {
  if (context.demo) return buildDemoStaffTrainingSnapshot({
    organizationId: context.organizationId, branchId: context.branchId, filters,
  });
  if (context.assuranceLevel !== "aal2" ||
    !context.scopes.includes("staff_training.read")) {
    throw new StaffTrainingSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new StaffTrainingSnapshotError();
  const { data, error } = await supabase.rpc("staff_training_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_date_from: filters.dateFrom, p_date_to: filters.dateTo,
    p_staff_membership_id: filters.staffMembershipId,
    p_course_type: filters.courseType, p_status: filters.status,
    p_search: filters.query || null,
  }).maybeSingle<StaffTrainingSnapshotSourceRow>();
  if (error || !data) throw new StaffTrainingSnapshotError();
  try {
    return projectStaffTrainingSnapshot({ row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false });
  } catch {
    throw new StaffTrainingSnapshotError();
  }
}
