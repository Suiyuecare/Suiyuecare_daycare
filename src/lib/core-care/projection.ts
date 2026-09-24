import type {
  DailyAttendanceSummary,
  DailyCareDiarySummary,
  DailyCareSnapshot,
  DailyClientSummary,
  DailyVitalSummary,
  DailyApplicability,
} from "./types";

export type ClientSourceRow = {
  id: string;
  client_code: string;
  display_name: string;
  eligibility?: "eligible" | "inactive" | "not_admitted";
  scheduleStatus?: "scheduled" | "not_scheduled" | "unknown" | "ineligible";
  sourceAccess?: DailyClientSummary["sourceAccess"];
};

export type AttendanceSourceRow = {
  id: string;
  client_id: string;
  status: DailyAttendanceSummary["status"];
  checked_in_at: string | null;
  checked_out_at: string | null;
  source: string;
};

export type MeasurementSourceRow = {
  client_id: string;
  measurement_kind: string;
  measured_at: string;
  numeric_value: number | string | null;
};

export type CareDiarySourceRow = {
  id: string;
  record_key?: string;
  version?: number;
  client_id: string;
  status: DailyCareDiarySummary["status"];
  occurred_at: string;
  data: unknown;
};

export type ServiceEventSourceRow = {
  client_id: string;
  status: string;
  count?: number;
};

export function dailyApplicability(client: ClientSourceRow, attendance?: AttendanceSourceRow): DailyApplicability {
  if (client.eligibility && client.eligibility !== "eligible") return { attendance: "not_expected", care: "not_expected", reason: "history_only", eligible: false };
  if (client.sourceAccess?.attendance === false || !client.scheduleStatus) return { attendance: "unknown", care: "unknown", reason: "unknown", eligible: true };
  if (attendance?.status === "present") return { attendance: "expected", care: "expected", reason: "arrived", eligible: true };
  if (attendance?.status === "leave" || attendance?.status === "absent") return { attendance: client.scheduleStatus === "scheduled" ? "expected" : "not_expected", care: "not_expected", reason: "leave_or_absent", eligible: true };
  if (client.scheduleStatus === "scheduled") return { attendance: "expected", care: "expected", reason: "scheduled", eligible: true };
  if (client.scheduleStatus === "not_scheduled") return { attendance: "not_expected", care: "not_expected", reason: "not_scheduled", eligible: true };
  return { attendance: "unknown", care: "unknown", reason: "unknown", eligible: true };
}

const vitalFieldByKind = new Map<
  string,
  keyof Pick<
    DailyVitalSummary,
    "systolic" | "diastolic" | "pulse" | "temperature" | "oxygenSaturation"
  >
>([
  ["blood_pressure_systolic", "systolic"],
  ["blood_pressure_diastolic", "diastolic"],
  ["pulse", "pulse"],
  ["temperature", "temperature"],
  ["oxygen_saturation", "oxygenSaturation"],
]);

function hasAbnormalFlag(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  return record.abnormal === true || record.has_abnormal_flag === true;
}

export function projectDailyCareSnapshot(input: {
  serviceDate: string;
  generatedAt: string;
  clients: readonly ClientSourceRow[];
  attendance: readonly AttendanceSourceRow[];
  measurements: readonly MeasurementSourceRow[];
  careDiaries: readonly CareDiarySourceRow[];
  serviceEvents: readonly ServiceEventSourceRow[];
  sourceAccess?: DailyCareSnapshot["sourceAccess"];
  demo?: boolean;
}): DailyCareSnapshot {
  const attendanceByClient = new Map(
    input.attendance.map((row) => [row.client_id, row]),
  );
  const diaryByClient = new Map<string, CareDiarySourceRow>();
  for (const row of [...input.careDiaries].sort((a, b) =>
    b.occurred_at.localeCompare(a.occurred_at),
  )) {
    if (!diaryByClient.has(row.client_id)) diaryByClient.set(row.client_id, row);
  }

  const measurementsByClient = new Map<string, MeasurementSourceRow[]>();
  for (const row of input.measurements) {
    const current = measurementsByClient.get(row.client_id) ?? [];
    current.push(row);
    measurementsByClient.set(row.client_id, current);
  }

  const serviceCountByClient = new Map<string, number>();
  for (const row of input.serviceEvents) {
    if (row.status !== "completed") continue;
    serviceCountByClient.set(
      row.client_id,
      (serviceCountByClient.get(row.client_id) ?? 0) + (row.count ?? 1),
    );
  }

  const clients: DailyClientSummary[] = input.clients.map((client) => {
    const attendanceRow = attendanceByClient.get(client.id);
    const diaryRow = diaryByClient.get(client.id);
    const measurementRows = [...(measurementsByClient.get(client.id) ?? [])].sort(
      (a, b) => b.measured_at.localeCompare(a.measured_at),
    );
    const latestByKind = new Map<string, MeasurementSourceRow>();
    for (const row of measurementRows) {
      if (!latestByKind.has(row.measurement_kind)) {
        latestByKind.set(row.measurement_kind, row);
      }
    }
    const vitalSigns = measurementRows.length
      ? ([...latestByKind.entries()].reduce<DailyVitalSummary>(
          (result, [kind, row]) => {
            const field = vitalFieldByKind.get(kind);
            if (field && row.numeric_value !== null) {
              result[field] = Number(row.numeric_value);
            }
            return result;
          },
          {
            measuredAt: measurementRows[0]!.measured_at,
            systolic: null,
            diastolic: null,
            pulse: null,
            temperature: null,
            oxygenSaturation: null,
            capturedKinds: [...latestByKind.keys()].sort(),
          },
        ) satisfies DailyVitalSummary)
      : null;
    const completedServiceCount = serviceCountByClient.get(client.id) ?? 0;
    const sourceCoverage =
      Number(Boolean(attendanceRow)) +
      Number(Boolean(vitalSigns)) +
      Number(Boolean(diaryRow)) +
      Number(completedServiceCount > 0);

    return {
      clientId: client.id,
      clientCode: client.client_code,
      displayName: client.display_name,
      attendance: attendanceRow
        ? {
            id: attendanceRow.id,
            status: attendanceRow.status,
            checkedInAt: attendanceRow.checked_in_at,
            checkedOutAt: attendanceRow.checked_out_at,
            source: attendanceRow.source,
          }
        : null,
      vitalSigns,
      careDiary: diaryRow
        ? {
            id: diaryRow.id,
            status: diaryRow.status,
            occurredAt: diaryRow.occurred_at,
            hasAbnormalFlag: hasAbnormalFlag(diaryRow.data),
          }
        : null,
      completedServiceCount,
      sourceCoverage,
      applicability: dailyApplicability(client, attendanceRow),
      sourceAccess: client.sourceAccess,
    };
  });

  return {
    serviceDate: input.serviceDate,
    generatedAt: input.generatedAt,
    staleAfter: new Date(new Date(input.generatedAt).getTime() + 60_000).toISOString(),
    clients,
    sourceCounts: {
      activeClients: clients.length,
      attendanceRecords: clients.filter((client) => client.attendance).length,
      clientsWithMeasurements: clients.filter((client) => client.vitalSigns).length,
      careDiaryRecords: clients.filter((client) => client.careDiary).length,
      completedServiceEvents: clients.reduce((sum, client) => sum + client.completedServiceCount, 0),
    },
    sourceAccess: input.sourceAccess ?? {
      clients: true,
      attendance: true,
      measurements: true,
      careDiaries: true,
      serviceEvents: true,
    },
    demo: input.demo ?? false,
  };
}

export function filterDailyCareSnapshotByClient(
  snapshot: DailyCareSnapshot,
  clientId: string,
): DailyCareSnapshot {
  const clients = snapshot.clients.filter((client) => client.clientId === clientId);
  return {
    ...snapshot,
    clients,
    sourceCounts: {
      activeClients: clients.length,
      attendanceRecords: clients.filter((client) => client.attendance).length,
      clientsWithMeasurements: clients.filter((client) => client.vitalSigns).length,
      careDiaryRecords: clients.filter((client) => client.careDiary).length,
      completedServiceEvents: clients.reduce(
        (total, client) => total + client.completedServiceCount,
        0,
      ),
    },
  };
}
