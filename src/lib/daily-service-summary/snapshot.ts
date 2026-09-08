import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoDailyServiceSummary } from "./demo";
import {
  projectDailyServiceSummary,
  type DailyServiceSummarySourceRow,
} from "./projection";
import type { DailyServiceSummaryFilters } from "./types";

export class DailyServiceSummarySnapshotError extends Error {
  constructor() {
    super("DAILY_SERVICE_SUMMARY_SNAPSHOT_UNAVAILABLE");
    this.name = "DailyServiceSummarySnapshotError";
  }
}

export async function loadDailyServiceSummarySnapshot(
  context: TenantContext,
  filters: DailyServiceSummaryFilters,
) {
  if (context.demo) return buildDemoDailyServiceSummary(filters);
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new DailyServiceSummarySnapshotError();
  const { data, error } = await supabase.rpc("daily_service_summary_snapshot_v2", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_service_date: filters.serviceDate,
    p_client_id: filters.clientId,
    p_completeness_filter: filters.completeness,
  }).maybeSingle<DailyServiceSummarySourceRow>();
  if (error || !data) throw new DailyServiceSummarySnapshotError();
  try {
    return projectDailyServiceSummary({ row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, demo: false });
  } catch {
    throw new DailyServiceSummarySnapshotError();
  }
}
