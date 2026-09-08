import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoStaffVaccinationSnapshot } from "./demo";
import {
  projectStaffVaccinationSnapshot,
  type StaffVaccinationSnapshotSourceRow,
} from "./projection";
import type { StaffVaccinationFilters } from "./types";

export class StaffVaccinationSnapshotError extends Error {
  constructor() {
    super("STAFF_VACCINATION_SNAPSHOT_UNAVAILABLE");
    this.name = "StaffVaccinationSnapshotError";
  }
}

export async function loadStaffVaccinationSnapshot(
  context: TenantContext,
  filters: StaffVaccinationFilters,
) {
  if (context.demo) return buildDemoStaffVaccinationSnapshot({
    organizationId: context.organizationId,
    branchId: context.branchId,
    filters,
  });
  if (context.assuranceLevel !== "aal2" ||
    !context.scopes.includes("staff_health.read")) {
    throw new StaffVaccinationSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new StaffVaccinationSnapshotError();
  const { data, error } = await supabase.rpc("staff_vaccination_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_staff_membership_id: filters.staffMembershipId,
    p_vaccine_name: filters.vaccineName,
    p_dose_number: filters.doseNumber,
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_status: filters.status,
    p_search: filters.query || null,
  }).maybeSingle<StaffVaccinationSnapshotSourceRow>();
  if (error || !data) throw new StaffVaccinationSnapshotError();
  try {
    return projectStaffVaccinationSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      filters,
      demo: false,
    });
  } catch {
    throw new StaffVaccinationSnapshotError();
  }
}
