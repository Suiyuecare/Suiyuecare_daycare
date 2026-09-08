import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoAbnormalEventSnapshot, filterDemoAbnormalEventSnapshot } from "./demo";
import { projectAbnormalEventSnapshot, type AbnormalEventSnapshotSourceRow } from "./projection";
import type { AbnormalEventFilters } from "./types";

export class AbnormalEventSnapshotError extends Error {
  constructor() {
    super("ABNORMAL_EVENT_SNAPSHOT_UNAVAILABLE");
    this.name = "AbnormalEventSnapshotError";
  }
}

export async function loadAbnormalEventSnapshot(
  context: TenantContext, filters: AbnormalEventFilters,
) {
  if (context.demo) {
    return filterDemoAbnormalEventSnapshot(buildDemoAbnormalEventSnapshot(), filters);
  }
  if (!context.scopes.includes("clients.read") || !context.scopes.includes("quality_events.read")) {
    throw new AbnormalEventSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new AbnormalEventSnapshotError();
  const { data, error } = await supabase.rpc("abnormal_event_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_event_type: filters.eventType,
    p_affected_target_kind: filters.affectedTargetKind,
    p_handling_status: filters.handlingStatus,
  }).maybeSingle<AbnormalEventSnapshotSourceRow>();
  if (error || !data) throw new AbnormalEventSnapshotError();
  try {
    return projectAbnormalEventSnapshot({ row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, demo: false });
  } catch {
    throw new AbnormalEventSnapshotError();
  }
}
