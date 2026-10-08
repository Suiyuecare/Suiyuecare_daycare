import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { recordClinicalSnapshotFailure } from "@/lib/clinical-snapshot/diagnostics";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoBehaviorEventSnapshot } from "./demo";
import { projectBehaviorEventSnapshot, type BehaviorEventSnapshotSourceRow } from "./projection";
import type { BehaviorEventFilters } from "./types";

export class BehaviorEventSnapshotError extends Error {
  constructor(readonly requestId?: string) { super("BEHAVIOR_EVENT_SNAPSHOT_UNAVAILABLE"); this.name = "BehaviorEventSnapshotError"; }
}

export async function loadBehaviorEventSnapshot(context: TenantContext, filters: BehaviorEventFilters) {
  if (context.demo) return buildDemoBehaviorEventSnapshot(filters);
  const fail = (stage: "configuration" | "rpc" | "projection" | "unexpected", result?: { status?: unknown; error?: { code?: unknown } | null }) =>
    new BehaviorEventSnapshotError(recordClinicalSnapshotFailure(context, "behavior_event", stage, result));
  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw fail("configuration");
    const result = await supabase.rpc("behavior_event_snapshot", {
      p_expected_organization_id: context.organizationId, p_expected_branch_id: context.branchId,
      p_date_from: filters.dateFrom, p_date_to: filters.dateTo, p_client_id: filters.clientId,
      p_event_type: filters.eventType, p_event_state: filters.state === "all" ? null : filters.state,
    }).maybeSingle<BehaviorEventSnapshotSourceRow>();
    if (result.error || !result.data) throw fail("rpc", result);
    try { return projectBehaviorEventSnapshot({ row: result.data, expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false }); }
    catch { throw fail("projection"); }
  } catch (error) {
    if (error instanceof BehaviorEventSnapshotError) throw error;
    throw fail("unexpected");
  }
}
