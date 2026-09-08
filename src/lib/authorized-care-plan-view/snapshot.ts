import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoAuthorizedCarePlanViewSnapshot } from "./demo";
import {
  projectAuthorizedCarePlanViewSnapshot,
  type AuthorizedCarePlanViewSourceRow,
} from "./projection";
import type { AuthorizedCarePlanFilters } from "./types";

export class AuthorizedCarePlanViewSnapshotError extends Error {
  constructor() {
    super("AUTHORIZED_CARE_PLAN_VIEW_SNAPSHOT_UNAVAILABLE");
    this.name = "AuthorizedCarePlanViewSnapshotError";
  }
}

function canReadAuthorizedCarePlans(context: TenantContext) {
  return context.assuranceLevel === "aal2" &&
    context.scopes.includes("clients.read") &&
    context.scopes.includes("care_plans.read");
}

export async function loadAuthorizedCarePlanViewSnapshot(
  context: TenantContext,
  filters: AuthorizedCarePlanFilters,
) {
  if (context.demo) {
    return buildDemoAuthorizedCarePlanViewSnapshot({
      organizationId: context.organizationId,
      branchId: context.branchId,
      filters,
    });
  }
  if (!canReadAuthorizedCarePlans(context)) {
    throw new AuthorizedCarePlanViewSnapshotError();
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new AuthorizedCarePlanViewSnapshotError();
  const { data, error } = await supabase.rpc("authorized_care_plan_view_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_as_of: filters.asOf,
    p_client_id: filters.clientId,
    p_authorized_from: filters.authorizedFrom,
    p_authorized_to: filters.authorizedTo,
    p_effective_state: filters.effectiveState,
    p_source_system: filters.sourceSystem,
    p_page: filters.page,
    p_page_size: filters.pageSize,
  }).maybeSingle<AuthorizedCarePlanViewSourceRow>();
  if (error || !data) throw new AuthorizedCarePlanViewSnapshotError();

  try {
    return projectAuthorizedCarePlanViewSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      filters,
      demo: false,
    });
  } catch {
    throw new AuthorizedCarePlanViewSnapshotError();
  }
}
