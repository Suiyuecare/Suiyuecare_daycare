import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoWeightSnapshot, filterDemoWeightSnapshot } from "./demo";
import { projectWeightManagementSnapshot, type WeightManagementSnapshotSourceRow } from "./projection";
import type { WeightManagementFilters } from "./types";

export class WeightManagementSnapshotError extends Error {
  constructor() { super("WEIGHT_MANAGEMENT_SNAPSHOT_UNAVAILABLE"); this.name = "WeightManagementSnapshotError"; }
}

export async function loadWeightManagementSnapshot(context: TenantContext, filters: WeightManagementFilters) {
  if (context.demo) return filterDemoWeightSnapshot(buildDemoWeightSnapshot(context.organizationId, context.branchId, filters.targetMonth), filters);
  if (!context.scopes.includes("clients.read") || !context.scopes.includes("quality_events.read")) throw new WeightManagementSnapshotError();
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new WeightManagementSnapshotError();
  const { data, error } = await supabase.rpc("weight_management_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_target_month: filters.targetMonth,
    p_client_id: filters.clientId,
    p_change_direction: filters.changeDirection,
    p_alert_status: filters.alertStatus,
  }).maybeSingle<WeightManagementSnapshotSourceRow>();
  if (error || !data) throw new WeightManagementSnapshotError();
  try {
    return projectWeightManagementSnapshot({ row: data, expectedOrganizationId: context.organizationId, expectedBranchId: context.branchId, expectedTargetMonth: filters.targetMonth, demo: false });
  } catch { throw new WeightManagementSnapshotError(); }
}
