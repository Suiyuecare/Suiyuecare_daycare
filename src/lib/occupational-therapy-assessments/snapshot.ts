import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoOccupationalTherapyAssessmentSnapshot } from "./demo";
import {
  filterDemoOccupationalTherapyAssessmentSnapshot,
  projectOccupationalTherapyAssessmentSnapshot,
  type OccupationalTherapyAssessmentSnapshotSourceRow,
} from "./projection";
import type { OccupationalTherapyAssessmentFilters } from "./types";

export class OccupationalTherapyAssessmentSnapshotError extends Error {
  constructor() {
    super("OCCUPATIONAL_THERAPY_ASSESSMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "OccupationalTherapyAssessmentSnapshotError";
  }
}

export async function loadOccupationalTherapyAssessmentSnapshot(
  context: TenantContext,
  filters: OccupationalTherapyAssessmentFilters,
) {
  if (context.demo) {
    return filterDemoOccupationalTherapyAssessmentSnapshot(
      buildDemoOccupationalTherapyAssessmentSnapshot(),
      filters,
    );
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new OccupationalTherapyAssessmentSnapshotError();
  const { data, error } = await supabase.rpc(
    "occupational_therapy_assessment_snapshot",
    {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_client_id: filters.clientId,
      p_therapist_user_id: filters.therapistUserId,
      p_service_status: filters.serviceStatus,
      p_due_status: filters.dueStatus,
    },
  ).maybeSingle<OccupationalTherapyAssessmentSnapshotSourceRow>();
  if (error || !data) throw new OccupationalTherapyAssessmentSnapshotError();
  try {
    return projectOccupationalTherapyAssessmentSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new OccupationalTherapyAssessmentSnapshotError();
  }
}
