import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { recordClinicalSnapshotFailure } from "@/lib/clinical-snapshot/diagnostics";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoMedicationAdministrationSnapshot } from "./demo";
import {
  projectMedicationAdministrationSnapshot,
  type MedicationAdministrationSourceRow,
} from "./projection";

export class MedicationAdministrationSnapshotError extends Error {
  constructor(readonly requestId?: string) {
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
  const fail = (stage: "authorization" | "configuration" | "rpc" | "projection" | "unexpected", result?: { status?: unknown; error?: { code?: unknown } | null }) =>
    new MedicationAdministrationSnapshotError(recordClinicalSnapshotFailure(context, "medication_administration", stage, result));
  if (
    !context.scopes.includes("clients.read") ||
    !context.scopes.includes("medications.read")
  ) {
    throw fail("authorization");
  }
  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw fail("configuration");
    const result = await supabase.rpc("medication_administration_day_snapshot", {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_service_date: serviceDate,
    });
    if (result.error) throw fail("rpc", result);
    try {
      return projectMedicationAdministrationSnapshot({
        serviceDate,
        generatedAt: new Date().toISOString(),
        rows: (result.data ?? []) as unknown as MedicationAdministrationSourceRow[],
      });
    } catch { throw fail("projection"); }
  } catch (error) {
    if (error instanceof MedicationAdministrationSnapshotError) throw error;
    throw fail("unexpected");
  }
}
