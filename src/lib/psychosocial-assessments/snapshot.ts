import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoPsychosocialAssessmentSnapshot } from "./demo";
import {
  filterDemoPsychosocialAssessmentSnapshot,
  projectPsychosocialAssessmentSnapshot,
  type PsychosocialAssessmentSnapshotSourceRow,
} from "./projection";
import type { PsychosocialAssessmentFilters } from "./types";

export class PsychosocialAssessmentSnapshotError extends Error {
  constructor() {
    super("PSYCHOSOCIAL_ASSESSMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "PsychosocialAssessmentSnapshotError";
  }
}

export async function loadPsychosocialAssessmentSnapshot(
  context: TenantContext,
  filters: PsychosocialAssessmentFilters,
) {
  if (context.demo) {
    return filterDemoPsychosocialAssessmentSnapshot(
      buildDemoPsychosocialAssessmentSnapshot(),
      filters,
    );
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new PsychosocialAssessmentSnapshotError();
  const { data, error } = await supabase.rpc(
    "psychosocial_assessment_snapshot",
    {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_client_id: filters.clientId,
      p_responsible_user_id: filters.responsibleUserId,
      p_service_status: filters.serviceStatus,
      p_due_status: filters.dueStatus,
    },
  ).maybeSingle<PsychosocialAssessmentSnapshotSourceRow>();
  if (error || !data) throw new PsychosocialAssessmentSnapshotError();
  try {
    return projectPsychosocialAssessmentSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new PsychosocialAssessmentSnapshotError();
  }
}
