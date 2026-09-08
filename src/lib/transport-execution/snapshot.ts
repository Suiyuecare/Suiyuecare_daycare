import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoTransportExecutionSnapshot } from "./demo";
import {
  projectTransportExecutionSnapshot,
  type TransportExecutionSnapshotSourceRow,
} from "./projection";
import type { TransportExecutionFilters } from "./types";

export class TransportExecutionSnapshotError extends Error {
  constructor() {
    super("TRANSPORT_EXECUTION_SNAPSHOT_UNAVAILABLE");
    this.name = "TransportExecutionSnapshotError";
  }
}

const REQUIRED_SCOPES = ["clients.read", "transport_execution.read"] as const;

export async function loadTransportExecutionSnapshot(
  context: TenantContext,
  filters: TransportExecutionFilters,
) {
  if (context.demo) return buildDemoTransportExecutionSnapshot(filters);
  if (REQUIRED_SCOPES.some((scope) => !context.scopes.includes(scope))) {
    throw new TransportExecutionSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new TransportExecutionSnapshotError();
  const { data, error } = await supabase.rpc("transport_execution_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId, p_service_date: filters.serviceDate,
    p_vehicle_query: filters.vehicleQuery, p_driver_query: filters.driverQuery,
    p_completion_status: filters.completionStatus,
    p_exception_status: filters.exceptionStatus,
  }).maybeSingle<TransportExecutionSnapshotSourceRow>();
  if (error || !data) throw new TransportExecutionSnapshotError();
  try {
    return projectTransportExecutionSnapshot({ row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false });
  } catch {
    throw new TransportExecutionSnapshotError();
  }
}
