import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoFallEventSnapshot, filterDemoFallEventSnapshot } from "./demo";
import { projectFallEventSnapshot, type FallEventSnapshotSourceRow } from "./projection";
import type { FallEventFilters } from "./types";

export class FallEventSnapshotError extends Error {
  constructor() {
    super("FALL_EVENT_SNAPSHOT_UNAVAILABLE");
    this.name = "FallEventSnapshotError";
  }
}

export async function loadFallEventSnapshot(
  context: TenantContext,
  filters: FallEventFilters,
) {
  if (context.demo) {
    return filterDemoFallEventSnapshot(buildDemoFallEventSnapshot(), filters);
  }
  if (
    !context.scopes.includes("clients.read") ||
    !context.scopes.includes("quality_events.read")
  ) throw new FallEventSnapshotError();

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new FallEventSnapshotError();
  const { data, error } = await supabase.rpc("fall_event_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_injury_degree: filters.injuryDegree,
    p_handling_status: filters.handlingStatus,
    p_client_id: filters.clientId,
  }).maybeSingle<FallEventSnapshotSourceRow>();
  if (error || !data) throw new FallEventSnapshotError();
  try {
    return projectFallEventSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new FallEventSnapshotError();
  }
}
