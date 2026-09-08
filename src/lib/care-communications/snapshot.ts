import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoCareCommunicationSnapshot } from "./demo";
import { projectCareCommunicationSnapshot } from "./projection";
import type { CareCommunicationFilters } from "./types";

export class CareCommunicationSnapshotError extends Error {
  constructor() {
    super("CARE_COMMUNICATION_SNAPSHOT_UNAVAILABLE");
    this.name = "CareCommunicationSnapshotError";
  }
}

export async function loadCareCommunicationSnapshot(
  context: TenantContext,
  filters: CareCommunicationFilters,
  recentAal2: boolean,
) {
  if (context.demo) {
    return buildDemoCareCommunicationSnapshot({
      organizationId: context.organizationId,
      branchId: context.branchId,
      filters,
    });
  }
  if (!context.scopes.includes("care_communications.read")) {
    throw new CareCommunicationSnapshotError();
  }
  const expectedCanManage = recentAal2 &&
    context.scopes.includes("care_communications.manage");
  const expectedCanCorrect = recentAal2 &&
    context.scopes.includes("care_communications.correct");
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new CareCommunicationSnapshotError();
  try {
    const interaction = filters.query || filters.clientId ||
      filters.authorUserId || filters.dateFrom || filters.dateTo ||
      filters.deliveryStatus !== "all" || filters.confirmationStatus !== "all"
      ? "search"
      : "view";
    const { data, error } = await supabase.rpc(
      "care_communication_snapshot",
      {
        p_expected_organization_id: context.organizationId,
        p_expected_branch_id: context.branchId,
        p_client_id: filters.clientId,
        p_date_from: filters.dateFrom,
        p_date_to: filters.dateTo,
        p_author_user_id: filters.authorUserId,
        p_delivery_status: filters.deliveryStatus,
        p_confirmation_status: filters.confirmationStatus,
        p_query: filters.query,
        p_interaction: interaction,
      },
    ).maybeSingle();
    if (error || !data) throw new CareCommunicationSnapshotError();
    return projectCareCommunicationSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      expectedCanManage,
      expectedCanCorrect,
      demo: false,
    });
  } catch {
    throw new CareCommunicationSnapshotError();
  }
}
