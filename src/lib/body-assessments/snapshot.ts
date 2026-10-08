import "server-only";
import type { TenantContext } from "@/lib/domain/types";
import { recordClinicalSnapshotFailure } from "@/lib/clinical-snapshot/diagnostics";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildDemoBodyAssessmentSnapshot } from "./demo";
import { projectBodyAssessmentSnapshot } from "./projection";
import type { BodyAssessmentFilters } from "./types";
export class BodyAssessmentSnapshotError extends Error {
  constructor(readonly requestId?: string) { super("BODY_ASSESSMENT_SNAPSHOT_UNAVAILABLE"); this.name = "BodyAssessmentSnapshotError"; }
}
export async function loadBodyAssessmentSnapshot(context: TenantContext, filters: BodyAssessmentFilters) {
  if (context.demo) return buildDemoBodyAssessmentSnapshot(filters);
  const fail = (stage: "authorization" | "configuration" | "rpc" | "projection" | "unexpected", result?: { status?: unknown; error?: { code?: unknown } | null }) =>
    new BodyAssessmentSnapshotError(recordClinicalSnapshotFailure(context, "body_assessment", stage, result));
  if (!["clients.read", "body_assessments.read"].every((p) => context.scopes.includes(p))) throw fail("authorization");
  try {
    const supabase = await createServerSupabaseClient(); if (!supabase) throw fail("configuration");
    const result = await supabase.rpc("body_assessment_snapshot", {
      p_expected_organization_id: context.organizationId, p_expected_branch_id: context.branchId,
      p_client_id: filters.clientId, p_state: filters.state === "all" ? null : filters.state,
    }).maybeSingle();
    if (result.error || !result.data) throw fail("rpc", result);
    try { return projectBodyAssessmentSnapshot({ row: result.data, expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false }); } catch { throw fail("projection"); }
  } catch (error) {
    if (error instanceof BodyAssessmentSnapshotError) throw error;
    throw fail("unexpected");
  }
}
