import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoMnaAssessmentSnapshot } from "./demo";
import {
  filterDemoMnaAssessmentSnapshot,
  projectMnaAssessmentSnapshot,
  type MnaAssessmentSnapshotSourceRow,
} from "./projection";
import type { MnaAssessmentFilters } from "./types";

export class MnaAssessmentSnapshotError extends Error {
  constructor() {
    super("MNA_ASSESSMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "MnaAssessmentSnapshotError";
  }
}

export async function loadMnaAssessmentSnapshot(
  context: TenantContext,
  filters: MnaAssessmentFilters,
) {
  if (context.demo) {
    return filterDemoMnaAssessmentSnapshot(
      buildDemoMnaAssessmentSnapshot(),
      filters,
    );
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new MnaAssessmentSnapshotError();
  const { data, error } = await supabase.rpc("mna_assessment_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_client_id: filters.clientId,
    p_risk_filter: filters.risk,
    p_follow_up_filter: filters.followUp,
  }).maybeSingle<MnaAssessmentSnapshotSourceRow>();
  if (error || !data) throw new MnaAssessmentSnapshotError();
  try {
    return projectMnaAssessmentSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new MnaAssessmentSnapshotError();
  }
}

