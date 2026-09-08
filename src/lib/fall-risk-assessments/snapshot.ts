import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoFallRiskAssessmentSnapshot } from "./demo";
import {
  filterDemoFallRiskAssessmentSnapshot,
  projectFallRiskAssessmentSnapshot,
  type FallRiskAssessmentSnapshotSourceRow,
} from "./projection";
import type { FallRiskAssessmentFilters } from "./types";

export class FallRiskAssessmentSnapshotError extends Error {
  constructor() {
    super("FALL_RISK_ASSESSMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "FallRiskAssessmentSnapshotError";
  }
}

export async function loadFallRiskAssessmentSnapshot(
  context: TenantContext,
  filters: FallRiskAssessmentFilters,
) {
  if (context.demo) {
    return filterDemoFallRiskAssessmentSnapshot(
      buildDemoFallRiskAssessmentSnapshot(),
      filters,
    );
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new FallRiskAssessmentSnapshotError();
  const { data, error } = await supabase.rpc("fall_risk_assessment_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_client_id: filters.clientId,
    p_preview_filter: filters.previewStatus,
    p_answer_filter: filters.answerState,
  }).maybeSingle<FallRiskAssessmentSnapshotSourceRow>();
  if (error || !data) throw new FallRiskAssessmentSnapshotError();
  try {
    return projectFallRiskAssessmentSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new FallRiskAssessmentSnapshotError();
  }
}
