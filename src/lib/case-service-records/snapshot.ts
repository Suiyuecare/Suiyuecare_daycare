import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoCaseServiceRecordSnapshot } from "./demo";
import {
  projectCaseServiceRecordSnapshot,
  type CaseServiceRecordSnapshotSourceRow,
} from "./projection";
import type { CaseServiceRecordFilters } from "./types";

export class CaseServiceRecordSnapshotError extends Error {
  constructor() {
    super("CASE_SERVICE_RECORD_SNAPSHOT_UNAVAILABLE");
    this.name = "CaseServiceRecordSnapshotError";
  }
}

export async function loadCaseServiceRecordSnapshot(
  context: TenantContext,
  filters: CaseServiceRecordFilters,
) {
  if (context.demo) return buildDemoCaseServiceRecordSnapshot(filters);
  if (context.assuranceLevel !== "aal2" ||
    !context.scopes.includes("clients.read") ||
    !context.scopes.includes("case_service_records.read") ||
    (context.roles.length > 0 && context.roles.every((role) => role === "family"))) {
    throw new CaseServiceRecordSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new CaseServiceRecordSnapshotError();
  const { data, error } = await supabase.rpc("case_service_record_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_client_id: filters.clientId,
    p_service_type: filters.serviceType,
    p_author_user_id: filters.authorUserId,
    p_record_state: filters.recordState === "all" ? null : filters.recordState,
  }).maybeSingle<CaseServiceRecordSnapshotSourceRow>();
  if (error || !data) throw new CaseServiceRecordSnapshotError();
  try {
    return projectCaseServiceRecordSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      filters,
      demo: false,
    });
  } catch {
    throw new CaseServiceRecordSnapshotError();
  }
}
