import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { taipeiDayBoundsUtc } from "@/lib/core-care/date";
import { loadAllClientDirectoryRows } from "@/lib/clients/directory";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoBloodGlucoseSnapshot } from "./demo";
import {
  projectBloodGlucoseSnapshot,
  type BloodGlucoseClientSourceRow,
  type BloodGlucoseMeasurementSourceRow,
} from "./projection";

export class BloodGlucoseSnapshotError extends Error {
  constructor() {
    super("BLOOD_GLUCOSE_SNAPSHOT_UNAVAILABLE");
    this.name = "BloodGlucoseSnapshotError";
  }
}

export async function loadBloodGlucoseSnapshot(
  context: TenantContext,
  serviceDate: string,
) {
  if (context.demo) return buildDemoBloodGlucoseSnapshot(serviceDate);
  if (
    !context.scopes.includes("clients.read") ||
    !context.scopes.includes("health.read")
  ) {
    throw new BloodGlucoseSnapshotError();
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new BloodGlucoseSnapshotError();
  const { start, end } = taipeiDayBoundsUtc(serviceDate);
  const [clientRows, measurements] = await Promise.all([
    loadAllClientDirectoryRows(supabase, context, "blood_glucose").then(
      (rows): BloodGlucoseClientSourceRow[] =>
        rows
          .filter(
            (row) =>
              row.status === "active" &&
              row.admitted_on !== null &&
              row.ended_on === null,
          )
          .map((row) => ({
            id: row.id,
            client_code: row.client_code,
            display_name: row.display_name,
          })),
    ),
    supabase
      .from("measurements")
      .select("id, client_id, measured_at, numeric_value, unit, context, source")
      .eq("organization_id", context.organizationId)
      .eq("branch_id", context.branchId)
      .eq("measurement_kind", "blood_glucose")
      .gte("measured_at", start)
      .lt("measured_at", end)
      .order("measured_at", { ascending: false })
      .returns<BloodGlucoseMeasurementSourceRow[]>(),
  ]);

  if (measurements.error) {
    throw new BloodGlucoseSnapshotError();
  }

  try {
    return projectBloodGlucoseSnapshot({
      serviceDate,
      generatedAt: new Date().toISOString(),
      clients: clientRows,
      measurements: measurements.data ?? [],
    });
  } catch {
    throw new BloodGlucoseSnapshotError();
  }
}
