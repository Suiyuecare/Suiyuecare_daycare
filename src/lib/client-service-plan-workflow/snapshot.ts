import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoClientServicePlanSnapshot } from "./demo";
import { projectClientServicePlanSnapshot, type ClientServicePlanSnapshotSourceRow } from "./projection";
import type { ClientServicePlanFilters } from "./types";

export class ClientServicePlanSnapshotError extends Error {
  constructor() { super("CLIENT_SERVICE_PLAN_SNAPSHOT_UNAVAILABLE"); this.name = "ClientServicePlanSnapshotError"; }
}

export async function loadClientServicePlanSnapshot(
  context: TenantContext,
  filters: ClientServicePlanFilters,
) {
  if (context.demo) return buildDemoClientServicePlanSnapshot(filters);
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ClientServicePlanSnapshotError();
  const { data, error } = await supabase.rpc("client_service_plan_workflow_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_client_id: filters.clientId,
    p_status: filters.status === "all" ? null : filters.status,
    p_as_of: filters.asOf,
    p_query: filters.query,
  }).maybeSingle<ClientServicePlanSnapshotSourceRow>();
  if (error || !data) throw new ClientServicePlanSnapshotError();
  try {
    return projectClientServicePlanSnapshot({ row: data,
      expectedOrganizationId: context.organizationId, expectedBranchId: context.branchId,
      filters, demo: false });
  } catch { throw new ClientServicePlanSnapshotError(); }
}
