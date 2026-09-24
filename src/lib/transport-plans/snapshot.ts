import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoTransportPlanSnapshot } from "./demo";
import {
  projectTransportPlanSnapshot,
  type TransportPlanSnapshotSourceRow,
} from "./projection";
import type { TransportPlanFilters } from "./types";

export class TransportPlanSnapshotError extends Error {
  constructor() {
    super("TRANSPORT_PLAN_SNAPSHOT_UNAVAILABLE");
    this.name = "TransportPlanSnapshotError";
  }
}

const REQUIRED_SCOPES = ["clients.read", "transport_plans.read"] as const;

export async function loadTransportPlanSnapshot(
  context: TenantContext,
  filters: TransportPlanFilters,
) {
  if (context.demo) return buildDemoTransportPlanSnapshot(filters);
  if (REQUIRED_SCOPES.some((scope) => !context.scopes.includes(scope))) {
    throw new TransportPlanSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new TransportPlanSnapshotError();
  const { data, error } = await supabase.rpc("transport_trip_plan_snapshot_v2", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId, p_service_date: filters.serviceDate,
    p_direction: filters.direction, p_vehicle_query: filters.vehicleQuery,
    p_driver_query: filters.driverQuery, p_status: filters.status,
  }).maybeSingle<TransportPlanSnapshotSourceRow>();
  if (error || !data) throw new TransportPlanSnapshotError();
  try {
    return projectTransportPlanSnapshot({ row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false });
  } catch {
    throw new TransportPlanSnapshotError();
  }
}
