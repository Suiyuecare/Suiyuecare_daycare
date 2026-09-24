import "server-only";
import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildDemoDailySnapshot } from "./demo";
import { parseCoreDailySnapshot } from "./snapshot-contract";

export class CoreCareSnapshotError extends Error {
  constructor() { super("CORE_CARE_SNAPSHOT_UNAVAILABLE"); this.name = "CoreCareSnapshotError"; }
}

export async function loadDailyCareSnapshot(context: TenantContext, serviceDate: string) {
  if (context.demo) return buildDemoDailySnapshot(serviceDate);
  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase || !context.branchId || !context.scopes.includes("clients.read")) throw new CoreCareSnapshotError();
    const result = await supabase.rpc("core_daily_snapshot", {
      p_organization_id: context.organizationId, p_branch_id: context.branchId, p_date: serviceDate,
    }).maybeSingle<{ payload: unknown }>();
    if (result.error) throw new CoreCareSnapshotError();
    return parseCoreDailySnapshot(result.data?.payload, { organizationId: context.organizationId, branchId: context.branchId, serviceDate }, {
      clients: true, attendance: context.scopes.includes("attendance.read"), measurements: context.scopes.includes("health.read"),
      careDiaries: context.scopes.includes("care_records.read"), serviceEvents: context.scopes.includes("services.read"),
    });
  } catch { throw new CoreCareSnapshotError(); }
}
