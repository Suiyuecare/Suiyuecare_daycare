import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoOccupationalTherapyServiceSnapshot } from "./demo";
import {
  projectOccupationalTherapyServiceSnapshot,
  type OccupationalTherapyServiceSnapshotSourceRow,
} from "./projection";
import type { OccupationalTherapyServiceFilters } from "./types";

export class OccupationalTherapyServiceSnapshotError extends Error {
  constructor() {
    super("OCCUPATIONAL_THERAPY_SERVICE_SNAPSHOT_UNAVAILABLE");
    this.name = "OccupationalTherapyServiceSnapshotError";
  }
}

export async function loadOccupationalTherapyServiceSnapshot(
  context: TenantContext,
  filters: OccupationalTherapyServiceFilters,
) {
  if (context.demo) return buildDemoOccupationalTherapyServiceSnapshot(filters);
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new OccupationalTherapyServiceSnapshotError();
  const { data, error } = await supabase.rpc(
    "occupational_therapy_service_snapshot",
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
  ).maybeSingle<OccupationalTherapyServiceSnapshotSourceRow>();
  if (error || !data) throw new OccupationalTherapyServiceSnapshotError();
  try {
    return projectOccupationalTherapyServiceSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new OccupationalTherapyServiceSnapshotError();
  }
}
