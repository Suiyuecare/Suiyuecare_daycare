import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoAbcdAssessmentSnapshot } from "./demo";
import { projectAbcdAssessmentSnapshot, type AbcdAssessmentSnapshotSourceRow } from "./projection";
import type { AbcdAssessmentFilters } from "./types";

export class AbcdAssessmentSnapshotError extends Error {
  constructor() { super("ABCD_ASSESSMENT_SNAPSHOT_UNAVAILABLE"); this.name = "AbcdAssessmentSnapshotError"; }
}

export async function loadAbcdAssessmentSnapshot(context: TenantContext, filters: AbcdAssessmentFilters) {
  if (context.demo) return buildDemoAbcdAssessmentSnapshot(filters);
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new AbcdAssessmentSnapshotError();
  const { data, error } = await supabase.rpc("abcd_assessment_snapshot", {
    p_expected_organization_id: context.organizationId, p_expected_branch_id: context.branchId,
    p_client_id: filters.clientId, p_assessment_year: filters.assessmentYear,
    p_assessment_type: filters.assessmentType === "all" ? null : filters.assessmentType,
    p_reassessment_state: filters.reassessmentState === "all" ? null : filters.reassessmentState,
    p_assessment_state: filters.status === "all" ? null : filters.status,
    p_query: filters.query,
  }).maybeSingle<AbcdAssessmentSnapshotSourceRow>();
  if (error || !data) throw new AbcdAssessmentSnapshotError();
  try { return projectAbcdAssessmentSnapshot({ row: data,
    expectedOrganizationId: context.organizationId, expectedBranchId: context.branchId,
    filters, demo: false }); }
  catch { throw new AbcdAssessmentSnapshotError(); }
}
