import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoPhysicalTherapyAssessmentSnapshot } from "./demo";
import {
  filterDemoPhysicalTherapyAssessmentSnapshot,
  projectPhysicalTherapyAssessmentSnapshot,
  type PhysicalTherapyAssessmentSnapshotSourceRow,
} from "./projection";
import type { PhysicalTherapyAssessmentFilters } from "./types";

export class PhysicalTherapyAssessmentSnapshotError extends Error {
  constructor() {
    super("PHYSICAL_THERAPY_ASSESSMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "PhysicalTherapyAssessmentSnapshotError";
  }
}

export async function loadPhysicalTherapyAssessmentSnapshot(
  context: TenantContext,
  filters: PhysicalTherapyAssessmentFilters,
) {
  if (context.demo) {
    return filterDemoPhysicalTherapyAssessmentSnapshot(
      buildDemoPhysicalTherapyAssessmentSnapshot(),
      filters,
    );
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new PhysicalTherapyAssessmentSnapshotError();
  const { data, error } = await supabase.rpc(
    "physical_therapy_assessment_snapshot",
    {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_client_id: filters.clientId,
      p_therapist_user_id: filters.therapistUserId,
      p_service_status: filters.serviceStatus,
      p_due_status: filters.dueStatus,
    },
  ).maybeSingle<PhysicalTherapyAssessmentSnapshotSourceRow>();
  if (error || !data) throw new PhysicalTherapyAssessmentSnapshotError();
  try {
    return projectPhysicalTherapyAssessmentSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new PhysicalTherapyAssessmentSnapshotError();
  }
}
