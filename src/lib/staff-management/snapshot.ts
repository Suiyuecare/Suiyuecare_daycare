import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoStaffManagementSnapshot } from "./demo";
import {
  projectStaffManagementSnapshot,
  type StaffManagementSnapshotSourceRow,
} from "./projection";
import type { StaffManagementFilters } from "./types";

export class StaffManagementSnapshotError extends Error {
  constructor() {
    super("STAFF_MANAGEMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "StaffManagementSnapshotError";
  }
}

export async function loadStaffManagementSnapshot(
  context: TenantContext,
  filters: StaffManagementFilters,
) {
  if (context.demo) return buildDemoStaffManagementSnapshot({
    organizationId: context.organizationId, branchId: context.branchId, filters,
  });
  const required = ["staff_management.read", "staff_management.identity.read",
    "staff_management.employment.read", "staff_management.roles.read",
    "staff_management.qualifications.read", "staff_certificates.read"];
  if (context.assuranceLevel !== "aal2" ||
    !required.every((scope) => context.scopes.includes(scope))) {
    throw new StaffManagementSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new StaffManagementSnapshotError();
  const { data, error } = await supabase.rpc("staff_management_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_status: filters.status, p_role_id: filters.roleId,
    p_qualification: filters.qualification, p_search: filters.query || null,
  }).maybeSingle<{ payload: StaffManagementSnapshotSourceRow }>();
  if (error || !data?.payload) throw new StaffManagementSnapshotError();
  try {
    return projectStaffManagementSnapshot({ row: data.payload,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false });
  } catch {
    throw new StaffManagementSnapshotError();
  }
}
