import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoReassuranceCalendarSnapshot } from "./demo";
import { projectReassuranceCalendarSnapshot } from "./projection";
import type { ReassuranceCalendarFilters } from "./types";

export class ReassuranceCalendarSnapshotError extends Error {
  constructor() {
    super("REASSURANCE_CALENDAR_SNAPSHOT_UNAVAILABLE");
    this.name = "ReassuranceCalendarSnapshotError";
  }
}

export async function loadReassuranceCalendarSnapshot(
  context: TenantContext,
  filters: ReassuranceCalendarFilters,
  recentAal2: boolean,
) {
  if (context.demo) return buildDemoReassuranceCalendarSnapshot({
    organizationId: context.organizationId, branchId: context.branchId, filters,
  });
  if (!context.scopes.includes("reassurance_calendar.read") ||
      filters.organizationId !== context.organizationId) {
    throw new ReassuranceCalendarSnapshotError();
  }
  const expectedCanManage = recentAal2 &&
    context.scopes.includes("reassurance_calendar.manage");
  const expectedCanCancel = recentAal2 &&
    context.scopes.includes("reassurance_calendar.cancel");
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ReassuranceCalendarSnapshotError();
  try {
    const { data, error } = await supabase.rpc("reassurance_calendar_snapshot", {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_month: `${filters.month}-01`,
      p_organization_filter: filters.organizationId,
      p_category: filters.category,
      p_status: filters.status,
      p_today: filters.todayOnly,
      p_query: filters.query || null,
    }).maybeSingle();
    if (error || !data) throw new ReassuranceCalendarSnapshotError();
    return projectReassuranceCalendarSnapshot({
      row: data, expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, expectedMonth: filters.month,
      expectedCanManage, expectedCanCancel, demo: false,
    });
  } catch {
    throw new ReassuranceCalendarSnapshotError();
  }
}
