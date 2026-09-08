import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoBillingManagementSnapshot } from "./demo";
import { projectBillingManagementSnapshot, type BillingSnapshotSourceRow } from "./projection";
import type { BillingFilters } from "./types";

export class BillingManagementSnapshotError extends Error {
  constructor() { super("BILLING_MANAGEMENT_SNAPSHOT_UNAVAILABLE"); this.name = "BillingManagementSnapshotError"; }
}

export async function loadBillingManagementSnapshot(context: TenantContext, filters: BillingFilters) {
  if (context.demo) return buildDemoBillingManagementSnapshot({ organizationId: context.organizationId,
    branchId: context.branchId, filters });
  if (context.assuranceLevel !== "aal2" || !context.scopes.includes("billing.read"))
    throw new BillingManagementSnapshotError();
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new BillingManagementSnapshotError();
  const { data, error } = await supabase.rpc("billing_management_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId, p_period_start: filters.periodStart,
    p_period_end: filters.periodEnd, p_client_id: filters.clientId,
    p_payment_status: filters.paymentStatus,
  }).maybeSingle<BillingSnapshotSourceRow>();
  if (error || !data) throw new BillingManagementSnapshotError();
  try { return projectBillingManagementSnapshot({ row: data,
    expectedOrganizationId: context.organizationId, expectedBranchId: context.branchId,
    filters, demo: false }); } catch { throw new BillingManagementSnapshotError(); }
}
