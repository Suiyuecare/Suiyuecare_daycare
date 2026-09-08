import "server-only";
import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildDemoBodyAssessmentSnapshot } from "./demo";
import { projectBodyAssessmentSnapshot } from "./projection";
import type { BodyAssessmentFilters } from "./types";
export class BodyAssessmentSnapshotError extends Error {
  constructor() { super("BODY_ASSESSMENT_SNAPSHOT_UNAVAILABLE"); this.name = "BodyAssessmentSnapshotError"; }
}
export async function loadBodyAssessmentSnapshot(context: TenantContext, filters: BodyAssessmentFilters) {
  if (context.demo) return buildDemoBodyAssessmentSnapshot(filters);
  if (!["clients.read", "body_assessments.read"].every((p) => context.scopes.includes(p))) throw new BodyAssessmentSnapshotError();
  const supabase = await createServerSupabaseClient(); if (!supabase) throw new BodyAssessmentSnapshotError();
  const { data, error } = await supabase.rpc("body_assessment_snapshot", {
    p_expected_organization_id: context.organizationId, p_expected_branch_id: context.branchId,
    p_client_id: filters.clientId, p_state: filters.state === "all" ? null : filters.state,
  }).maybeSingle();
  if (error || !data) throw new BodyAssessmentSnapshotError();
  try { return projectBodyAssessmentSnapshot({ row: data, expectedOrganizationId: context.organizationId,
    expectedBranchId: context.branchId, filters, demo: false }); } catch { throw new BodyAssessmentSnapshotError(); }
}
