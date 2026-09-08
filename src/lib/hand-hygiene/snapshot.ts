import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoHandHygieneSnapshot } from "./demo";
import { projectHandHygieneSnapshot } from "./projection";
import type { HandHygieneFilters } from "./types";

export class HandHygieneSnapshotError extends Error {
  constructor() {
    super("HAND_HYGIENE_SNAPSHOT_UNAVAILABLE");
    this.name = "HandHygieneSnapshotError";
  }
}

export async function loadHandHygieneSnapshot(
  context: TenantContext,
  filters: HandHygieneFilters,
) {
  if (context.demo) return buildDemoHandHygieneSnapshot({
    organizationId: context.organizationId,
    branchId: context.branchId,
    filters,
  });
  if (context.assuranceLevel !== "aal2" ||
      !context.scopes.includes("hand_hygiene.read")) {
    throw new HandHygieneSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new HandHygieneSnapshotError();
  const filtered = filters.dateFrom !== null || filters.dateTo !== null ||
    filters.staffMembershipId !== null || filters.deviceCode !== null ||
    filters.matchStatus !== "all" || filters.eventKind !== "all";
  const { data, error } = await supabase.rpc("hand_hygiene_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_staff_membership_id: filters.staffMembershipId,
    p_device_code: filters.deviceCode,
    p_match_status: filters.matchStatus,
    p_event_kind: filters.eventKind,
    p_interaction: filtered ? "search" : "view",
  }).maybeSingle();
  if (error || !data) throw new HandHygieneSnapshotError();
  try {
    return projectHandHygieneSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      filters,
      demo: false,
    });
  } catch {
    throw new HandHygieneSnapshotError();
  }
}
