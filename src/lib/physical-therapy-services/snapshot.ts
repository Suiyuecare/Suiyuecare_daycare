import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoPhysicalTherapyServiceSnapshot } from "./demo";
import {
  projectPhysicalTherapyServiceSnapshot,
  type PhysicalTherapyServiceSnapshotSourceRow,
} from "./projection";
import type { PhysicalTherapyServiceFilters } from "./types";

export class PhysicalTherapyServiceSnapshotError extends Error {
  constructor() {
    super("PHYSICAL_THERAPY_SERVICE_SNAPSHOT_UNAVAILABLE");
    this.name = "PhysicalTherapyServiceSnapshotError";
  }
}

export async function loadPhysicalTherapyServiceSnapshot(
  context: TenantContext,
  filters: PhysicalTherapyServiceFilters,
) {
  if (context.demo) return buildDemoPhysicalTherapyServiceSnapshot(filters);
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new PhysicalTherapyServiceSnapshotError();
  const { data, error } = await supabase.rpc(
    "physical_therapy_service_snapshot",
    {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_date_from: filters.dateFrom,
      p_date_to: filters.dateTo,
      p_client_id: filters.clientId,
      p_therapist_user_id: filters.therapistUserId,
      p_record_state: filters.recordState,
      p_keyword: filters.keyword,
    },
  ).maybeSingle<PhysicalTherapyServiceSnapshotSourceRow>();
  if (error || !data) throw new PhysicalTherapyServiceSnapshotError();
  try {
    return projectPhysicalTherapyServiceSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new PhysicalTherapyServiceSnapshotError();
  }
}
