import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoSocialWorkRecordSnapshot } from "./demo";
import {
  filterDemoSocialWorkRecordSnapshot,
  projectSocialWorkRecordSnapshot,
  type SocialWorkSnapshotSourceRow,
} from "./projection";
import type { SocialWorkRecordFilters } from "./types";

export class SocialWorkRecordSnapshotError extends Error {
  constructor() {
    super("SOCIAL_WORK_RECORD_SNAPSHOT_UNAVAILABLE");
    this.name = "SocialWorkRecordSnapshotError";
  }
}

export async function loadSocialWorkRecordSnapshot(
  context: TenantContext,
  filters: SocialWorkRecordFilters,
) {
  if (context.demo) {
    return filterDemoSocialWorkRecordSnapshot(
      buildDemoSocialWorkRecordSnapshot(),
      filters,
    );
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new SocialWorkRecordSnapshotError();
  const { data, error } = await supabase.rpc("social_work_service_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_service_type: filters.serviceType,
    p_author_user_id: filters.authorUserId,
    p_client_id: filters.clientId,
  }).maybeSingle<SocialWorkSnapshotSourceRow>();
  if (error || !data) throw new SocialWorkRecordSnapshotError();
  try {
    return projectSocialWorkRecordSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new SocialWorkRecordSnapshotError();
  }
}
