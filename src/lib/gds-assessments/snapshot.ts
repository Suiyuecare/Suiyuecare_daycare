import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoGdsAssessmentSnapshot } from "./demo";
import {
  filterDemoGdsAssessmentSnapshot,
  projectGdsAssessmentSnapshot,
  type GdsAssessmentSnapshotSourceRow,
} from "./projection";
import type { GdsAssessmentFilters } from "./types";

export class GdsAssessmentSnapshotError extends Error {
  constructor() {
    super("GDS_ASSESSMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "GdsAssessmentSnapshotError";
  }
}

export async function loadGdsAssessmentSnapshot(
  context: TenantContext,
  filters: GdsAssessmentFilters,
) {
  if (context.demo) {
    return filterDemoGdsAssessmentSnapshot(
      buildDemoGdsAssessmentSnapshot(),
      filters,
    );
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new GdsAssessmentSnapshotError();
  const { data, error } = await supabase.rpc("gds_assessment_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_client_id: filters.clientId,
    p_preview_filter: filters.previewStatus,
    p_answer_filter: filters.answerState,
  }).maybeSingle<GdsAssessmentSnapshotSourceRow>();
  if (error || !data) throw new GdsAssessmentSnapshotError();
  try {
    return projectGdsAssessmentSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new GdsAssessmentSnapshotError();
  }
}
