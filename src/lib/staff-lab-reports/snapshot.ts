import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoStaffLabReportSnapshot } from "./demo";
import {
  projectStaffLabReportSnapshot,
  type StaffLabReportSnapshotSourceRow,
} from "./projection";
import type { StaffLabReportFilters } from "./types";

export class StaffLabReportSnapshotError extends Error {
  constructor() {
    super("STAFF_LAB_REPORT_SNAPSHOT_UNAVAILABLE");
    this.name = "StaffLabReportSnapshotError";
  }
}

export async function loadStaffLabReportSnapshot(
  context: TenantContext,
  filters: StaffLabReportFilters,
  recentAal2: boolean,
) {
  if (context.demo) return buildDemoStaffLabReportSnapshot({
    organizationId: context.organizationId, branchId: context.branchId, filters,
  });
  if (context.assuranceLevel !== "aal2" || !recentAal2 ||
    !context.scopes.includes("staff_health.read")) {
    throw new StaffLabReportSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new StaffLabReportSnapshotError();
  const { data, error } = await supabase.rpc("staff_lab_report_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_staff_membership_id: filters.staffMembershipId,
    p_report_type: filters.reportType,
    p_validity_status: filters.validityStatus,
    p_duplicate_status: filters.duplicateStatus,
    p_evidence_status: filters.evidenceStatus,
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_search: filters.query || null,
  }).maybeSingle<StaffLabReportSnapshotSourceRow>();
  if (error || !data) throw new StaffLabReportSnapshotError();
  try {
    return projectStaffLabReportSnapshot({ row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false,
    });
  } catch {
    throw new StaffLabReportSnapshotError();
  }
}
