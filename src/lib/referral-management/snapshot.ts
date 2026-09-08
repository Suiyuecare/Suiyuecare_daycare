import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoReferralManagementSnapshot } from "./demo";
import { projectReferralManagementSnapshot } from "./projection";
import type { ReferralManagementFilters } from "./types";

export class ReferralManagementSnapshotError extends Error {
  constructor() {
    super("REFERRAL_MANAGEMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "ReferralManagementSnapshotError";
  }
}

export async function loadReferralManagementSnapshot(
  context: TenantContext,
  filters: ReferralManagementFilters,
  recentAal2: boolean,
) {
  if (context.demo) return buildDemoReferralManagementSnapshot({
    organizationId: context.organizationId,
    branchId: context.branchId,
    filters,
  });
  if (!context.scopes.includes("clients.read") ||
      !context.scopes.includes("referral_management.read")) {
    throw new ReferralManagementSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ReferralManagementSnapshotError();
  const can = (permission: string) => recentAal2 && context.scopes.includes(permission);
  const expectedCanCreate = can("referral_management.create");
  const expectedCanSubmit = can("referral_management.submit");
  const expectedCanRegisterReceipt = can("referral_management.receive");
  const expectedCanRespond = can("referral_management.respond");
  const expectedCanClose = can("referral_management.close");
  const expectedCanCorrect = can("referral_management.correct");
  try {
    const { data, error } = await supabase.rpc("referral_management_snapshot", {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_client_id: filters.clientId,
      p_receiving_unit_mode: filters.receivingUnitMode,
      p_receiving_unit_code: filters.receivingUnitCode,
      p_status: filters.status,
      p_recent_from: filters.recentFrom,
      p_recent_to: filters.recentTo,
      p_query: filters.query || null,
    }).maybeSingle();
    if (error || !data) throw new ReferralManagementSnapshotError();
    return projectReferralManagementSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      expectedCanCreate,
      expectedCanSubmit,
      expectedCanRegisterReceipt,
      expectedCanRespond,
      expectedCanClose,
      expectedCanCorrect,
      demo: false,
    });
  } catch {
    throw new ReferralManagementSnapshotError();
  }
}
