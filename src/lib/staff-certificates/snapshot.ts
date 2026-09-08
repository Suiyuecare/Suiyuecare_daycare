import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoStaffCertificateSnapshot } from "./demo";
import {
  projectStaffCertificateSnapshot,
  type StaffCertificateSnapshotSourceRow,
} from "./projection";
import type { StaffCertificateFilters } from "./types";

export class StaffCertificateSnapshotError extends Error {
  constructor() {
    super("STAFF_CERTIFICATE_SNAPSHOT_UNAVAILABLE");
    this.name = "StaffCertificateSnapshotError";
  }
}

export async function loadStaffCertificateSnapshot(
  context: TenantContext,
  filters: StaffCertificateFilters,
) {
  if (context.demo) return buildDemoStaffCertificateSnapshot({
    organizationId: context.organizationId, branchId: context.branchId, filters,
  });
  if (context.assuranceLevel !== "aal2" ||
    !context.scopes.includes("staff_certificates.read")) {
    throw new StaffCertificateSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new StaffCertificateSnapshotError();
  const { data, error } = await supabase.rpc("staff_certificate_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_staff_membership_id: filters.staffMembershipId,
    p_certificate_type: filters.certificateType,
    p_status: filters.status, p_search: filters.query || null,
  }).maybeSingle<StaffCertificateSnapshotSourceRow>();
  if (error || !data) throw new StaffCertificateSnapshotError();
  try {
    return projectStaffCertificateSnapshot({ row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false });
  } catch {
    throw new StaffCertificateSnapshotError();
  }
}
