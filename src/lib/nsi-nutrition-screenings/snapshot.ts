import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoNsiNutritionScreeningSnapshot } from "./demo";
import {
  filterDemoNsiNutritionScreeningSnapshot,
  projectNsiNutritionScreeningSnapshot,
  type NsiNutritionScreeningSnapshotSourceRow,
} from "./projection";
import type { NsiNutritionScreeningFilters } from "./types";

export class NsiNutritionScreeningSnapshotError extends Error {
  constructor() {
    super("NSI_NUTRITION_SCREENING_SNAPSHOT_UNAVAILABLE");
    this.name = "NsiNutritionScreeningSnapshotError";
  }
}

export async function loadNsiNutritionScreeningSnapshot(
  context: TenantContext,
  filters: NsiNutritionScreeningFilters,
) {
  if (context.demo) {
    return filterDemoNsiNutritionScreeningSnapshot(
      buildDemoNsiNutritionScreeningSnapshot(),
      filters,
    );
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new NsiNutritionScreeningSnapshotError();
  const { data, error } = await supabase.rpc("nsi_nutrition_screening_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_client_id: filters.clientId,
    p_preview_filter: filters.previewStatus,
    p_answer_filter: filters.answerState,
  }).maybeSingle<NsiNutritionScreeningSnapshotSourceRow>();
  if (error || !data) throw new NsiNutritionScreeningSnapshotError();
  try {
    return projectNsiNutritionScreeningSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new NsiNutritionScreeningSnapshotError();
  }
}
