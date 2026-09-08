import {
  BLOOD_GLUCOSE_MEAL_CONTEXTS,
  BLOOD_GLUCOSE_UNITS,
  type BloodGlucoseMealContext,
  type BloodGlucoseUnit,
} from "./constants";

import type {
  BloodGlucoseClientSummary,
  BloodGlucoseFilters,
  BloodGlucoseRecord,
  BloodGlucoseSnapshot,
} from "./types";

export type BloodGlucoseClientSourceRow = {
  id: string;
  client_code: string;
  display_name: string;
};

export type BloodGlucoseMeasurementSourceRow = {
  id: string;
  client_id: string;
  measured_at: string;
  numeric_value: number | string | null;
  unit: string | null;
  context: unknown;
  source: string;
};

function isMealContext(value: unknown): value is BloodGlucoseMealContext {
  return BLOOD_GLUCOSE_MEAL_CONTEXTS.includes(
    value as BloodGlucoseMealContext,
  );
}

function isUnit(value: unknown): value is BloodGlucoseUnit {
  return BLOOD_GLUCOSE_UNITS.includes(value as BloodGlucoseUnit);
}

function parseRecord(row: BloodGlucoseMeasurementSourceRow): BloodGlucoseRecord {
  if (
    !row.context ||
    typeof row.context !== "object" ||
    Array.isArray(row.context) ||
    !isUnit(row.unit) ||
    typeof row.source !== "string" ||
    !row.source.trim() ||
    !Number.isFinite(new Date(row.measured_at).getTime())
  ) {
    throw new Error("INVALID_BLOOD_GLUCOSE_PROJECTION");
  }

  const mealContext = (row.context as Record<string, unknown>).meal_context;
  const value = Number(row.numeric_value);
  const precisionIsValid =
    row.unit === "mg/dL"
      ? Number.isInteger(value) && value >= 20 && value <= 600
      : Math.abs(value * 10 - Math.round(value * 10)) <= 1e-9 &&
        value >= 1.1 &&
        value <= 33.3;
  if (!isMealContext(mealContext) || !Number.isFinite(value) || !precisionIsValid) {
    throw new Error("INVALID_BLOOD_GLUCOSE_PROJECTION");
  }

  return {
    id: row.id,
    measuredAt: new Date(row.measured_at).toISOString(),
    mealContext,
    value,
    unit: row.unit,
    source: row.source,
  };
}

function countsFor(clients: readonly BloodGlucoseClientSummary[]) {
  const measuredClients = clients.filter(
    (client) => client.measurements.length > 0,
  ).length;
  return {
    accessibleClients: clients.length,
    measuredClients,
    unmeasuredClients: clients.length - measuredClients,
    measurements: clients.reduce(
      (total, client) => total + client.measurements.length,
      0,
    ),
  };
}

export function projectBloodGlucoseSnapshot(input: {
  serviceDate: string;
  generatedAt: string;
  clients: readonly BloodGlucoseClientSourceRow[];
  measurements: readonly BloodGlucoseMeasurementSourceRow[];
  demo?: boolean;
}): BloodGlucoseSnapshot {
  const clientIds = new Set(input.clients.map((client) => client.id));
  const recordsByClient = new Map<string, BloodGlucoseRecord[]>();

  for (const row of input.measurements) {
    if (!clientIds.has(row.client_id)) continue;
    const records = recordsByClient.get(row.client_id) ?? [];
    records.push(parseRecord(row));
    recordsByClient.set(row.client_id, records);
  }

  const clients = input.clients.map((client) => {
    const measurements = [...(recordsByClient.get(client.id) ?? [])].sort(
      (left, right) => right.measuredAt.localeCompare(left.measuredAt),
    );
    return {
      clientId: client.id,
      clientCode: client.client_code,
      displayName: client.display_name,
      measurements,
      latestMeasuredAt: measurements[0]?.measuredAt ?? null,
    } satisfies BloodGlucoseClientSummary;
  });

  return {
    serviceDate: input.serviceDate,
    generatedAt: input.generatedAt,
    staleAfter: new Date(
      new Date(input.generatedAt).getTime() + 60_000,
    ).toISOString(),
    clients,
    counts: countsFor(clients),
    demo: input.demo ?? false,
  };
}

export function filterBloodGlucoseSnapshot(
  snapshot: BloodGlucoseSnapshot,
  filters: BloodGlucoseFilters,
): BloodGlucoseSnapshot {
  const clients = snapshot.clients.flatMap((client) => {
    if (filters.clientId && client.clientId !== filters.clientId) return [];
    const measurements = filters.mealContext
      ? client.measurements.filter(
          (measurement) => measurement.mealContext === filters.mealContext,
        )
      : [...client.measurements];
    if (filters.measurementStatus === "measured" && measurements.length === 0) {
      return [];
    }
    if (filters.measurementStatus === "unmeasured" && measurements.length > 0) {
      return [];
    }
    return [
      {
        ...client,
        measurements,
        latestMeasuredAt: measurements[0]?.measuredAt ?? null,
      },
    ];
  });

  return { ...snapshot, clients, counts: countsFor(clients) };
}
