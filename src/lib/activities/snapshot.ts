import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoActivitySnapshot, filterDemoActivitySnapshot } from "./demo";
import { projectActivityManagementSnapshot, type ActivitySnapshotSourceRow } from "./projection";
import type { ActivityFilters } from "./types";

export class ActivitySnapshotError extends Error {
  constructor() { super("ACTIVITY_SNAPSHOT_UNAVAILABLE"); this.name = "ActivitySnapshotError"; }
}

export async function loadActivityManagementSnapshot(context: TenantContext, filters: ActivityFilters) {
  if (context.demo) return filterDemoActivitySnapshot(
    buildDemoActivitySnapshot(context.organizationId, context.branchId), filters,
  );
  if (!context.scopes.includes("activity.read") || !context.scopes.includes("clients.read")) {
    throw new ActivitySnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ActivitySnapshotError();
  const { data, error } = await supabase.rpc("activity_management_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_date_from: filters.dateFrom, p_date_to: filters.dateTo,
    p_activity_type: filters.activityType, p_status: filters.status,
    p_query: filters.query || null,
  }).maybeSingle<ActivitySnapshotSourceRow>();
  if (error || !data) throw new ActivitySnapshotError();
  try {
    return projectActivityManagementSnapshot({ row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, demo: false });
  } catch { throw new ActivitySnapshotError(); }
}
