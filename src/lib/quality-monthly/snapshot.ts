import "server-only";
import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { qualityMonthSchema, qualityMonthlySnapshotSchema } from "./contract";

export function canReadQualityMonthly(context: TenantContext) {
  return !context.demo && !!context.branchId && context.assuranceLevel === "aal2" &&
    context.roles.some((role) => ["organization_manager", "branch_supervisor", "branch_director"].includes(role)) &&
    ["audit.view", "reports.read", "clients.read", "attendance.read", "quality_events.read"].every((permission) => context.scopes.includes(permission));
}

export async function loadQualityMonthlySnapshot(context: TenantContext, month: string, snapshotId: string | null = null, download = false) {
  if (!canReadQualityMonthly(context) || !qualityMonthSchema.safeParse(month).success ||
    (snapshotId !== null && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(snapshotId))) throw new Error("QUALITY_MONTHLY_UNAVAILABLE");
  const client = await createServerSupabaseClient();
  if (!client) throw new Error("QUALITY_MONTHLY_UNAVAILABLE");
  if (download && (!snapshotId || !context.scopes.includes("quality_monthly.export"))) throw new Error("QUALITY_MONTHLY_UNAVAILABLE");
  const { data, error } = await client.rpc(download ? "quality_monthly_download" : "quality_monthly_snapshot", {
    p_expected_organization_id: context.organizationId, p_expected_branch_id: context.branchId,
    p_month: month, p_snapshot_id: snapshotId,
  });
  const parsed = qualityMonthlySnapshotSchema.safeParse(data);
  if (error || !parsed.success || parsed.data.organizationId !== context.organizationId ||
    parsed.data.branchId !== context.branchId || parsed.data.month !== month || parsed.data.snapshotId !== snapshotId) throw new Error("QUALITY_MONTHLY_UNAVAILABLE");
  return parsed.data;
}
