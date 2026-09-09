import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { loadAllClientDirectoryRows } from "@/lib/clients/directory";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { taipeiDayBoundsUtc } from "./date";
import { isDailyWorkClient } from "./selection-query";
import { buildDemoDailySnapshot } from "./demo";
import {
  projectDailyCareSnapshot,
  type AttendanceSourceRow,
  type CareDiarySourceRow,
  type ClientSourceRow,
  type MeasurementSourceRow,
  type ServiceEventSourceRow,
} from "./projection";

export class CoreCareSnapshotError extends Error {
  constructor() {
    super("CORE_CARE_SNAPSHOT_UNAVAILABLE");
    this.name = "CoreCareSnapshotError";
  }
}

export async function loadDailyCareSnapshot(
  context: TenantContext,
  serviceDate: string,
) {
  if (context.demo) return buildDemoDailySnapshot(serviceDate);

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new CoreCareSnapshotError();
  const { start, end } = taipeiDayBoundsUtc(serviceDate);
  const sourceAccess = {
    clients: context.scopes.includes("clients.read"),
    attendance: context.scopes.includes("attendance.read"),
    measurements: context.scopes.includes("health.read"),
    careDiaries: context.scopes.includes("care_records.read"),
    serviceEvents: context.scopes.includes("services.read"),
  };
  const emptyResult = <T,>() => Promise.resolve({ data: [] as T[], error: null });

  const [clientRows, attendance, measurements, careDiaries, serviceEvents] =
    await Promise.all([
      sourceAccess.clients
        ? loadAllClientDirectoryRows(supabase, context, "core_daily").then(
            (rows): ClientSourceRow[] =>
              rows
                .filter((row) => isDailyWorkClient(row, serviceDate))
                .map((row) => ({
                  id: row.id,
                  client_code: row.client_code,
                  display_name: row.display_name,
                })),
          )
        : Promise.resolve([] as ClientSourceRow[]),
      sourceAccess.attendance
        ? supabase
        .from("attendance_records")
        .select("id, client_id, status, checked_in_at, checked_out_at, source")
        .eq("organization_id", context.organizationId)
        .eq("branch_id", context.branchId)
        .eq("service_date", serviceDate)
        .is("correction_of_id", null)
        .neq("status", "cancelled")
        .returns<AttendanceSourceRow[]>()
        : emptyResult<AttendanceSourceRow>(),
      sourceAccess.measurements
        ? supabase
        .from("measurements")
        .select("client_id, measurement_kind, measured_at, numeric_value")
        .eq("organization_id", context.organizationId)
        .eq("branch_id", context.branchId)
        .gte("measured_at", start)
        .lt("measured_at", end)
        .in("measurement_kind", [
          "blood_pressure_systolic",
          "blood_pressure_diastolic",
          "pulse",
          "temperature",
          "oxygen_saturation",
        ])
        .order("measured_at", { ascending: false })
        .returns<MeasurementSourceRow[]>()
        : emptyResult<MeasurementSourceRow>(),
      sourceAccess.careDiaries
        ? supabase
        .from("care_records")
        .select("id, client_id, status, occurred_at, data")
        .eq("organization_id", context.organizationId)
        .eq("branch_id", context.branchId)
        .eq("category", "staff/daily-care/care-diary")
        .gte("occurred_at", start)
        .lt("occurred_at", end)
        .neq("status", "voided")
        .order("occurred_at", { ascending: false })
        .returns<CareDiarySourceRow[]>()
        : emptyResult<CareDiarySourceRow>(),
      sourceAccess.serviceEvents
        ? supabase
        .from("service_events")
        .select("client_id, status")
        .eq("organization_id", context.organizationId)
        .eq("branch_id", context.branchId)
        .gte("started_at", start)
        .lt("started_at", end)
        .returns<ServiceEventSourceRow[]>()
        : emptyResult<ServiceEventSourceRow>(),
    ]);

  if (
    attendance.error ||
    measurements.error ||
    careDiaries.error ||
    serviceEvents.error
  ) {
    throw new CoreCareSnapshotError();
  }

  return projectDailyCareSnapshot({
    serviceDate,
    generatedAt: new Date().toISOString(),
    clients: clientRows,
    attendance: attendance.data ?? [],
    measurements: measurements.data ?? [],
    careDiaries: careDiaries.data ?? [],
    serviceEvents: serviceEvents.data ?? [],
    sourceAccess,
  });
}
