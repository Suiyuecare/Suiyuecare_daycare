import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoStaffSchedulingSnapshot } from "./demo";
import {
  projectStaffSchedulingSnapshot,
  type StaffSchedulingSnapshotSourceRow,
} from "./projection";
import type { StaffSchedulingFilters } from "./types";

export class StaffSchedulingSnapshotError extends Error {
  constructor() {
    super("STAFF_SCHEDULING_SNAPSHOT_UNAVAILABLE");
    this.name = "StaffSchedulingSnapshotError";
  }
}

export async function loadStaffSchedulingSnapshot(
  context: TenantContext,
  filters: StaffSchedulingFilters,
) {
  if (context.demo) return buildDemoStaffSchedulingSnapshot({
    organizationId: context.organizationId, branchId: context.branchId, filters,
  });
  if (!["staff_scheduling.read", "staff_certificates.read"].every((scope) =>
    context.scopes.includes(scope))) throw new StaffSchedulingSnapshotError();
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new StaffSchedulingSnapshotError();
  const { data, error } = await supabase.rpc("staff_scheduling_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_period_start: filters.periodStart, p_period_end: filters.periodEnd,
    p_staff_membership_id: filters.staffMembershipId, p_status: filters.status,
  }).maybeSingle<{ payload: StaffSchedulingSnapshotSourceRow }>();
  if (error || !data?.payload) throw new StaffSchedulingSnapshotError();
  try {
    return projectStaffSchedulingSnapshot({ row: data.payload,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false });
  } catch {
    throw new StaffSchedulingSnapshotError();
  }
}
