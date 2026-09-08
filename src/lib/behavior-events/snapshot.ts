import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoBehaviorEventSnapshot } from "./demo";
import { projectBehaviorEventSnapshot, type BehaviorEventSnapshotSourceRow } from "./projection";
import type { BehaviorEventFilters } from "./types";

export class BehaviorEventSnapshotError extends Error {
  constructor() { super("BEHAVIOR_EVENT_SNAPSHOT_UNAVAILABLE"); this.name = "BehaviorEventSnapshotError"; }
}

export async function loadBehaviorEventSnapshot(context: TenantContext, filters: BehaviorEventFilters) {
  if (context.demo) return buildDemoBehaviorEventSnapshot(filters);
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new BehaviorEventSnapshotError();
  const { data, error } = await supabase.rpc("behavior_event_snapshot", {
    p_expected_organization_id: context.organizationId, p_expected_branch_id: context.branchId,
    p_date_from: filters.dateFrom, p_date_to: filters.dateTo, p_client_id: filters.clientId,
    p_event_type: filters.eventType, p_event_state: filters.state === "all" ? null : filters.state,
  }).maybeSingle<BehaviorEventSnapshotSourceRow>();
  if (error || !data) throw new BehaviorEventSnapshotError();
  try { return projectBehaviorEventSnapshot({ row: data, expectedOrganizationId: context.organizationId,
    expectedBranchId: context.branchId, filters, demo: false }); }
  catch { throw new BehaviorEventSnapshotError(); }
}
