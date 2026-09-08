import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoSocialResourceSnapshot } from "./demo";
import {
  filterDemoSocialResourceSnapshot,
  projectSocialResourceSnapshot,
  type SocialResourceSnapshotSourceRow,
} from "./projection";
import type { SocialResourceFilters } from "./types";

export class SocialResourceSnapshotError extends Error {
  constructor() {
    super("SOCIAL_RESOURCE_SNAPSHOT_UNAVAILABLE");
    this.name = "SocialResourceSnapshotError";
  }
}

export async function loadSocialResourceSnapshot(
  context: TenantContext,
  filters: SocialResourceFilters,
) {
  if (context.demo) {
    return filterDemoSocialResourceSnapshot(
      buildDemoSocialResourceSnapshot(),
      filters,
    );
  }
  if (!context.scopes.includes("social_resources.read")) {
    throw new SocialResourceSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new SocialResourceSnapshotError();
  const { data, error } = await supabase.rpc("social_resource_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_reference_year: filters.referenceYear,
    p_resource_type: filters.resourceType,
    p_status: filters.status,
    p_audience: filters.audience,
    p_query: filters.query || null,
  }).maybeSingle<SocialResourceSnapshotSourceRow>();
  if (error || !data) throw new SocialResourceSnapshotError();
  try {
    return projectSocialResourceSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new SocialResourceSnapshotError();
  }
}
