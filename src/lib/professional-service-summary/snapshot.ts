import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoProfessionalServiceSummary } from "./demo";
import {
  projectProfessionalServiceSummary,
  type ProfessionalServiceSummarySourceRow,
} from "./projection";
import type { ProfessionalServiceSummaryFilters } from "./types";

export class ProfessionalServiceSummarySnapshotError extends Error {
  constructor() {
    super("PROFESSIONAL_SERVICE_SUMMARY_SNAPSHOT_UNAVAILABLE");
    this.name = "ProfessionalServiceSummarySnapshotError";
  }
}

export async function loadProfessionalServiceSummarySnapshot(
  context: TenantContext,
  filters: ProfessionalServiceSummaryFilters,
) {
  if (context.demo) return buildDemoProfessionalServiceSummary(filters);
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ProfessionalServiceSummarySnapshotError();
  const { data, error } = await supabase.rpc(
    "professional_service_summary_snapshot",
    {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_month: `${filters.month}-01`,
      p_client_id: filters.clientId,
      p_professional_kind: filters.professionalKind,
      p_summary_status: filters.status,
    },
  ).maybeSingle<ProfessionalServiceSummarySourceRow>();
  if (error || !data) throw new ProfessionalServiceSummarySnapshotError();
  try {
    return projectProfessionalServiceSummary({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new ProfessionalServiceSummarySnapshotError();
  }
}
