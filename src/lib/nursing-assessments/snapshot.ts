import "server-only";
import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildDemoNursingAssessmentSnapshot } from "./demo";
import { projectNursingAssessmentSnapshot } from "./parser";
import type { NursingAssessmentSnapshot } from "./types";

export async function loadNursingAssessmentSnapshot(context: TenantContext): Promise<NursingAssessmentSnapshot> {
  if (context.demo) return buildDemoNursingAssessmentSnapshot(context.organizationId, context.branchId);
  if (context.assuranceLevel !== "aal2" || !context.scopes.includes("clients.read") ||
    !context.scopes.includes("nursing_assessments.read")) throw new Error("NURSING_SNAPSHOT_NOT_AUTHORIZED");
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("NURSING_SNAPSHOT_NOT_CONFIGURED");
  const { data, error } = await supabase.rpc("nursing_assessment_snapshot", {
    p_expected_organization_id: context.organizationId, p_expected_branch_id: context.branchId,
  });
  if (error || !data) throw new Error("NURSING_SNAPSHOT_UNAVAILABLE");
  return projectNursingAssessmentSnapshot(data, context.organizationId, context.branchId);
}
