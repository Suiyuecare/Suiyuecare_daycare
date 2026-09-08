import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoOrganizationProfileSnapshot } from "./demo";
import {
  projectOrganizationProfileSnapshot,
  type OrganizationProfileSnapshotSourceRow,
} from "./projection";
import type { OrganizationProfileFilters } from "./types";

export class OrganizationProfileSnapshotError extends Error {
  constructor() {
    super("ORGANIZATION_PROFILE_SNAPSHOT_UNAVAILABLE");
    this.name = "OrganizationProfileSnapshotError";
  }
}

export async function loadOrganizationProfileSnapshot(
  context: TenantContext,
  filters: OrganizationProfileFilters,
) {
  if (context.demo) return buildDemoOrganizationProfileSnapshot({
    organizationId: context.organizationId, branchId: context.branchId, filters,
  });
  if (context.assuranceLevel !== "aal2" ||
    !context.scopes.includes("organization_profile.read")) {
    throw new OrganizationProfileSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new OrganizationProfileSnapshotError();
  const { data, error } = await supabase.rpc("organization_profile_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
  }).maybeSingle<OrganizationProfileSnapshotSourceRow>();
  if (error || !data) throw new OrganizationProfileSnapshotError();
  try {
    return projectOrganizationProfileSnapshot({ row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false,
    });
  } catch {
    throw new OrganizationProfileSnapshotError();
  }
}
