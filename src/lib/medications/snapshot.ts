import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoMedicationAdministrationSnapshot } from "./demo";
import {
  projectMedicationAdministrationSnapshot,
  type MedicationAdministrationSourceRow,
} from "./projection";

export class MedicationAdministrationSnapshotError extends Error {
  constructor() {
    super("MEDICATION_ADMINISTRATION_SNAPSHOT_UNAVAILABLE");
    this.name = "MedicationAdministrationSnapshotError";
  }
}

export async function loadMedicationAdministrationSnapshot(
  context: TenantContext,
  serviceDate: string,
) {
  if (context.demo) {
    return buildDemoMedicationAdministrationSnapshot(serviceDate);
  }
  if (
    !context.scopes.includes("clients.read") ||
    !context.scopes.includes("medications.read")
  ) {
    throw new MedicationAdministrationSnapshotError();
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new MedicationAdministrationSnapshotError();
  const { data, error } = await supabase
    .rpc("medication_administration_day_snapshot", {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_service_date: serviceDate,
    });

  if (error) throw new MedicationAdministrationSnapshotError();
  try {
    return projectMedicationAdministrationSnapshot({
      serviceDate,
      generatedAt: new Date().toISOString(),
      rows: (data ?? []) as unknown as MedicationAdministrationSourceRow[],
    });
  } catch {
    throw new MedicationAdministrationSnapshotError();
  }
}
