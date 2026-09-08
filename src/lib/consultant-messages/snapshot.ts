import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoConsultantMessageSnapshot } from "./demo";
import { projectConsultantMessageSnapshot } from "./projection";
import type { ConsultantMessageFilters } from "./types";

export class ConsultantMessageSnapshotError extends Error {
  constructor() {
    super("CONSULTANT_MESSAGE_SNAPSHOT_UNAVAILABLE");
    this.name = "ConsultantMessageSnapshotError";
  }
}

export async function loadConsultantMessageSnapshot(
  context: TenantContext,
  filters: ConsultantMessageFilters,
) {
  if (context.demo) {
    return buildDemoConsultantMessageSnapshot({
      organizationId: context.organizationId,
      branchId: context.branchId,
      filters,
    });
  }
  if (!context.scopes.includes("consultant_messages.read")) {
    throw new ConsultantMessageSnapshotError();
  }
  const canManage = context.scopes.includes("consultant_messages.manage");
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ConsultantMessageSnapshotError();
  try {
    const interaction = filters.query || filters.consultantUserId ||
      filters.dateFrom || filters.dateTo || filters.status !== "all"
      ? "search"
      : "view";
    const { data, error } = await supabase.rpc(
      "consultant_message_snapshot",
      {
        p_expected_organization_id: context.organizationId,
        p_expected_branch_id: context.branchId,
        p_consultant_user_id: filters.consultantUserId,
        p_date_from: filters.dateFrom,
        p_date_to: filters.dateTo,
        p_status: filters.status,
        p_query: filters.query,
        p_interaction: interaction,
      },
    ).maybeSingle();
    if (error || !data) throw new ConsultantMessageSnapshotError();
    return projectConsultantMessageSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      expectedCanManage: canManage,
      demo: false,
    });
  } catch {
    throw new ConsultantMessageSnapshotError();
  }
}
