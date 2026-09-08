import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoInfectionEventSnapshot, filterDemoInfectionEventSnapshot } from "./demo";
import { projectInfectionEventSnapshot, type InfectionEventSnapshotSourceRow } from "./projection";
import type { InfectionEventFilters } from "./types";

export class InfectionEventSnapshotError extends Error {
  constructor() {
    super("INFECTION_EVENT_SNAPSHOT_UNAVAILABLE");
    this.name = "InfectionEventSnapshotError";
  }
}

export async function loadInfectionEventSnapshot(
  context: TenantContext,
  filters: InfectionEventFilters,
) {
  if (context.demo) {
    return filterDemoInfectionEventSnapshot(buildDemoInfectionEventSnapshot(), filters);
  }
  if (
    !context.scopes.includes("clients.read") ||
    !context.scopes.includes("quality_events.read")
  ) throw new InfectionEventSnapshotError();

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new InfectionEventSnapshotError();
  const { data, error } = await supabase.rpc("infection_event_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_infection_type: filters.infectionType,
    p_handling_status: filters.handlingStatus,
    p_client_id: filters.clientId,
    p_cluster_mode: filters.clusterMode,
    p_cluster_id: filters.clusterId,
  }).maybeSingle<InfectionEventSnapshotSourceRow>();
  if (error || !data) throw new InfectionEventSnapshotError();
  try {
    return projectInfectionEventSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new InfectionEventSnapshotError();
  }
}
