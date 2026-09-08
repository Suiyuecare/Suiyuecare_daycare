import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoClientVaccinationSnapshot } from "./demo";
import { projectClientVaccinationSnapshot,
  type ClientVaccinationSnapshotSourceRow } from "./projection";
import type { ClientVaccinationFilters } from "./types";

export class ClientVaccinationSnapshotError extends Error {
  constructor() {
    super("CLIENT_VACCINATION_SNAPSHOT_UNAVAILABLE");
    this.name = "ClientVaccinationSnapshotError";
  }
}

export async function loadClientVaccinationSnapshot(
  context: TenantContext,
  filters: ClientVaccinationFilters,
) {
  if (context.demo) return buildDemoClientVaccinationSnapshot({
    organizationId: context.organizationId, branchId: context.branchId, filters,
  });
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ClientVaccinationSnapshotError();
  const { data, error } = await supabase.rpc("client_vaccination_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_client_id: filters.clientId,
    p_vaccine_name: filters.vaccineName,
    p_dose_number: filters.doseNumber,
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_status: filters.status === "all" ? null : filters.status,
    p_query: filters.query || null,
  }).maybeSingle<ClientVaccinationSnapshotSourceRow>();
  if (error || !data) throw new ClientVaccinationSnapshotError();
  try {
    return projectClientVaccinationSnapshot({ row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, filters, demo: false });
  } catch {
    throw new ClientVaccinationSnapshotError();
  }
}
