import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoSpmsqAssessmentSnapshot } from "./demo";
import {
  filterDemoSpmsqAssessmentSnapshot,
  projectSpmsqAssessmentSnapshot,
  type SpmsqAssessmentSnapshotSourceRow,
} from "./projection";
import type { SpmsqAssessmentFilters } from "./types";

export class SpmsqAssessmentSnapshotError extends Error {
  constructor() {
    super("SPMSQ_ASSESSMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "SpmsqAssessmentSnapshotError";
  }
}

export async function loadSpmsqAssessmentSnapshot(
  context: TenantContext,
  filters: SpmsqAssessmentFilters,
) {
  if (context.demo) {
    return filterDemoSpmsqAssessmentSnapshot(
      buildDemoSpmsqAssessmentSnapshot(),
      filters,
    );
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new SpmsqAssessmentSnapshotError();
  const { data, error } = await supabase.rpc("spmsq_assessment_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_client_id: filters.clientId,
    p_preview_filter: filters.previewStatus,
    p_education_filter: filters.educationState,
  }).maybeSingle<SpmsqAssessmentSnapshotSourceRow>();
  if (error || !data) throw new SpmsqAssessmentSnapshotError();
  try {
    return projectSpmsqAssessmentSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new SpmsqAssessmentSnapshotError();
  }
}
