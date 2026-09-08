import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoMealManagementSnapshot } from "./demo";
import {
  projectMealManagementSnapshot,
  type MealManagementSnapshotSourceRow,
} from "./projection";
import type { MealManagementFilters } from "./types";

export class MealManagementSnapshotError extends Error {
  constructor() {
    super("MEAL_MANAGEMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "MealManagementSnapshotError";
  }
}

const REQUIRED_SCOPES = [
  "clients.read", "attendance.read", "health.read", "meals.read",
] as const;

export async function loadMealManagementSnapshot(
  context: TenantContext,
  filters: MealManagementFilters,
) {
  if (context.demo) return buildDemoMealManagementSnapshot(filters);
  if (REQUIRED_SCOPES.some((scope) => !context.scopes.includes(scope))) {
    throw new MealManagementSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new MealManagementSnapshotError();
  const { data, error } = await supabase.rpc("meal_management_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_service_date: filters.serviceDate,
    p_meal_kind: filters.mealKind,
    p_texture_query: filters.textureQuery,
    p_conflict_filter: filters.conflict,
  }).maybeSingle<MealManagementSnapshotSourceRow>();
  if (error || !data) throw new MealManagementSnapshotError();
  try {
    return projectMealManagementSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      filters,
      demo: false,
    });
  } catch {
    throw new MealManagementSnapshotError();
  }
}
