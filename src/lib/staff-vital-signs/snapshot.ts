import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoStaffVitalSignSnapshot } from "./demo";
import {
  projectStaffVitalSignSnapshot,
  type StaffVitalSignSnapshotSourceRow,
} from "./projection";
import type { StaffVitalSignFilters } from "./types";

export class StaffVitalSignSnapshotError extends Error {
  constructor() {
    super("STAFF_VITAL_SIGN_SNAPSHOT_UNAVAILABLE");
    this.name = "StaffVitalSignSnapshotError";
  }
}

export async function loadStaffVitalSignSnapshot(
  context: TenantContext,
  filters: StaffVitalSignFilters,
  recentAal2: boolean,
) {
  if (context.demo) return buildDemoStaffVitalSignSnapshot({
    organizationId: context.organizationId, branchId: context.branchId, filters,
  });
  if (context.assuranceLevel !== "aal2" || !recentAal2 ||
    !context.scopes.includes("staff_health.read")) {
    throw new StaffVitalSignSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new StaffVitalSignSnapshotError();
  const { data, error } = await supabase.rpc("staff_vital_sign_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_staff_membership_id: filters.staffMembershipId,
    p_measurement_type: filters.measurementType,
    p_state_status: filters.stateStatus,
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_search: filters.query || null,
  }).maybeSingle<StaffVitalSignSnapshotSourceRow>();
  if (error || !data) throw new StaffVitalSignSnapshotError();
  try {
    return projectStaffVitalSignSnapshot({ row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false,
    });
  } catch {
    throw new StaffVitalSignSnapshotError();
  }
}
