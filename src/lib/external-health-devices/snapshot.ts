import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoExternalHealthDeviceSnapshot } from "./demo";
import { projectExternalHealthDeviceSnapshot } from "./projection";
import type { ExternalHealthDeviceFilters } from "./types";

export class ExternalHealthDeviceSnapshotError extends Error {
  constructor() {
    super("EXTERNAL_HEALTH_DEVICE_SNAPSHOT_UNAVAILABLE");
    this.name = "ExternalHealthDeviceSnapshotError";
  }
}

export async function loadExternalHealthDeviceSnapshot(
  context: TenantContext,
  filters: ExternalHealthDeviceFilters,
) {
  if (context.demo) return buildDemoExternalHealthDeviceSnapshot({
    organizationId: context.organizationId, branchId: context.branchId, filters,
  });
  if (context.assuranceLevel !== "aal2" ||
      !context.scopes.includes("external_health_devices.read")) {
    throw new ExternalHealthDeviceSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ExternalHealthDeviceSnapshotError();
  const filtered = filters.dateFrom !== null || filters.dateTo !== null ||
    filters.clientId !== null || filters.deviceId !== null ||
    filters.matchStatus !== "all" || filters.deviceStatus !== "all" ||
    filters.metricCode !== null;
  const { data, error } = await supabase.rpc("external_health_device_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_date_from: filters.dateFrom, p_date_to: filters.dateTo,
    p_client_id: filters.clientId, p_device_id: filters.deviceId,
    p_match_status: filters.matchStatus, p_device_status: filters.deviceStatus,
    p_metric_code: filters.metricCode,
    p_interaction: filtered ? "search" : "view",
  }).maybeSingle();
  if (error || !data) throw new ExternalHealthDeviceSnapshotError();
  try {
    return projectExternalHealthDeviceSnapshot({ row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false });
  } catch {
    throw new ExternalHealthDeviceSnapshotError();
  }
}
