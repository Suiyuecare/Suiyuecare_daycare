import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoStaffToccSnapshot } from "./demo";
import { projectStaffToccSnapshot, type StaffToccSnapshotSourceRow } from "./projection";
import type { StaffToccFilters } from "./types";

export class StaffToccSnapshotError extends Error {
  constructor() {
    super("STAFF_TOCC_SNAPSHOT_UNAVAILABLE");
    this.name = "StaffToccSnapshotError";
  }
}

export async function loadStaffToccSnapshot(
  context: TenantContext,
  filters: StaffToccFilters,
) {
  if (context.demo) return buildDemoStaffToccSnapshot({
    organizationId: context.organizationId, branchId: context.branchId, filters,
  });
  if (context.assuranceLevel !== "aal2" ||
    !context.scopes.includes("staff_tocc.read")) throw new StaffToccSnapshotError();
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new StaffToccSnapshotError();
  const { data, error } = await supabase.rpc("staff_tocc_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_staff_membership_id: filters.staffMembershipId,
    p_validity_status: filters.validityStatus,
    p_attention_status: filters.attentionStatus,
    p_disposition_status: filters.dispositionStatus,
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_search: filters.query || null,
  }).maybeSingle<StaffToccSnapshotSourceRow>();
  if (error || !data) throw new StaffToccSnapshotError();
  try {
    return projectStaffToccSnapshot({ row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false,
    });
  } catch {
    throw new StaffToccSnapshotError();
  }
}
