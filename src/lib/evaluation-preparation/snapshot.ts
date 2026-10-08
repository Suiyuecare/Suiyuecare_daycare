import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSyntheticReadMode } from "@/lib/env";

import { evaluationPreparationSnapshotSchema, type EvaluationPreparationSnapshot } from "./contract";

export class EvaluationPreparationSnapshotError extends Error {
  constructor() { super("EVALUATION_PREPARATION_UNAVAILABLE"); this.name = "EvaluationPreparationSnapshotError"; }
}

export async function loadEvaluationPreparationSnapshot(
  context: TenantContext,
  page: number,
): Promise<EvaluationPreparationSnapshot> {
  if (!Number.isInteger(page) || page < 1 || page > 100 || !context.branchId ||
    !context.roles.some((role) => role === "organization_manager" || role === "branch_supervisor") ||
    (!context.demo && (context.assuranceLevel !== "aal2" || !context.scopes.includes("audit.view")))) {
    throw new EvaluationPreparationSnapshotError();
  }
  if (context.demo || isSyntheticReadMode()) {
    const now = new Date().toISOString();
    return { organizationId: context.organizationId, branchId: context.branchId,
      generatedAt: now, staleAfter: now, page, pageSize: 25, total: 0, items: [], owners: [],
      sourceStatus: "applicability_unapproved", formalSubmissionEnabled: false, demo: true };
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new EvaluationPreparationSnapshotError();
  const { data, error } = await supabase.rpc("evaluation_preparation_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_page: page,
  });
  if (error || !data) throw new EvaluationPreparationSnapshotError();
  const parsed = evaluationPreparationSnapshotSchema.safeParse(data);
  if (!parsed.success || parsed.data.organizationId !== context.organizationId ||
    parsed.data.branchId !== context.branchId || parsed.data.page !== page || parsed.data.demo) {
    throw new EvaluationPreparationSnapshotError();
  }
  return parsed.data;
}
