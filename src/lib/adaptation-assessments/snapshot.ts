import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoAdaptationAssessmentSnapshot } from "./demo";
import {
  filterDemoAdaptationAssessmentSnapshot,
  projectAdaptationAssessmentSnapshot,
  type AdaptationAssessmentSnapshotSourceRow,
} from "./projection";
import type { AdaptationAssessmentFilters } from "./types";

export class AdaptationAssessmentSnapshotError extends Error {
  constructor() {
    super("ADAPTATION_ASSESSMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "AdaptationAssessmentSnapshotError";
  }
}

export async function loadAdaptationAssessmentSnapshot(
  context: TenantContext,
  filters: AdaptationAssessmentFilters,
) {
  if (context.demo) {
    return filterDemoAdaptationAssessmentSnapshot(
      buildDemoAdaptationAssessmentSnapshot(),
      filters,
    );
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new AdaptationAssessmentSnapshotError();
  const { data, error } = await supabase.rpc("adaptation_assessment_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_client_id: filters.clientId,
    p_service_status: filters.serviceStatus,
    p_assessment_presence: filters.assessmentPresence,
    p_reassessment_status: filters.reassessmentStatus,
    p_adaptation_status: filters.adaptationStatus,
    p_follow_up_filter: filters.followUpFilter,
  }).maybeSingle<AdaptationAssessmentSnapshotSourceRow>();
  if (error || !data) throw new AdaptationAssessmentSnapshotError();
  try {
    return projectAdaptationAssessmentSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new AdaptationAssessmentSnapshotError();
  }
}
