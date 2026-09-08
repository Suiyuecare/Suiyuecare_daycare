import { describe, expect, it } from "vitest";

import { buildDemoBloodGlucoseSnapshot } from "./demo";
import {
  filterBloodGlucoseSnapshot,
  projectBloodGlucoseSnapshot,
  type BloodGlucoseMeasurementSourceRow,
} from "./projection";

const clients = [
  { id: "11111111-1111-4111-8111-111111111111", client_code: "C-001", display_name: "個案甲" },
  { id: "22222222-2222-4222-8222-222222222222", client_code: "C-002", display_name: "個案乙" },
];

const measurements: BloodGlucoseMeasurementSourceRow[] = [
  {
    id: "31111111-1111-4111-8111-111111111111",
    client_id: clients[0]!.id,
    measured_at: "2026-09-01T01:00:00.000Z",
    numeric_value: "105.0000",
    unit: "mg/dL",
    context: { meal_context: "fasting", private_note: "must not project" },
    source: "staff",
  },
  {
    id: "32222222-2222-4222-8222-222222222222",
    client_id: clients[0]!.id,
    measured_at: "2026-09-01T03:30:00.000Z",
    numeric_value: "7.2",
    unit: "mmol/L",
    context: { meal_context: "post_meal" },
    source: "device_import",
  },
];

function snapshot() {
  return projectBloodGlucoseSnapshot({
    serviceDate: "2026-09-01",
    generatedAt: "2026-09-01T04:00:00.000Z",
    clients,
    measurements,
  });
}

describe("blood-glucose read projection", () => {
  it("sorts records by occurrence time and exposes the latest valid time", () => {
    const result = snapshot();
    expect(result.clients[0]?.measurements.map((row) => row.id)).toEqual([
      measurements[1]!.id,
      measurements[0]!.id,
    ]);
    expect(result.clients[0]?.latestMeasuredAt).toBe(
      "2026-09-01T03:30:00.000Z",
    );
    expect(result.counts).toEqual({
      accessibleClients: 2,
      measuredClients: 1,
      unmeasuredClients: 1,
      measurements: 2,
    });
  });

  it("returns only the approved minimal record projection", () => {
    expect(Object.keys(snapshot().clients[0]!.measurements[0]!).sort()).toEqual([
      "id",
      "mealContext",
      "measuredAt",
      "source",
      "unit",
      "value",
    ]);
    expect(JSON.stringify(snapshot())).not.toContain("private_note");
  });

  it("filters by client, context, and measured state with matching counts", () => {
    const postMeal = filterBloodGlucoseSnapshot(snapshot(), {
      mealContext: "post_meal",
      measurementStatus: "measured",
    });
    expect(postMeal.clients).toHaveLength(1);
    expect(postMeal.clients[0]?.measurements).toHaveLength(1);
    expect(postMeal.counts.measurements).toBe(1);

    const unmeasured = filterBloodGlucoseSnapshot(snapshot(), {
      mealContext: "fasting",
      measurementStatus: "unmeasured",
    });
    expect(unmeasured.clients.map((client) => client.clientId)).toEqual([
      clients[1]!.id,
    ]);

    const selected = filterBloodGlucoseSnapshot(snapshot(), {
      clientId: clients[0]!.id,
      measurementStatus: "all",
    });
    expect(selected.clients).toHaveLength(1);
  });

  it("fails closed on malformed units, contexts, values, and timestamps", () => {
    for (const patch of [
      { unit: "mg%" },
      { context: { meal_context: "bedtime" } },
      { numeric_value: "7.25", unit: "mmol/L" },
      { measured_at: "not-a-time" },
    ]) {
      expect(() =>
        projectBloodGlucoseSnapshot({
          serviceDate: "2026-09-01",
          generatedAt: "2026-09-01T04:00:00.000Z",
          clients,
          measurements: [{ ...measurements[0]!, ...patch }],
        }),
      ).toThrowError("INVALID_BLOOD_GLUCOSE_PROJECTION");
    }
  });

  it("does not expose records outside the returned branch client set", () => {
    const result = projectBloodGlucoseSnapshot({
      serviceDate: "2026-09-01",
      generatedAt: "2026-09-01T04:00:00.000Z",
      clients,
      measurements: [
        ...measurements,
        {
          ...measurements[0]!,
          id: "33333333-3333-4333-8333-333333333333",
          client_id: "44444444-4444-4444-8444-444444444444",
        },
      ],
    });
    expect(result.counts.measurements).toBe(2);
  });

  it("builds a synthetic demo with both units, every context, and an honest unmeasured row", () => {
    const result = buildDemoBloodGlucoseSnapshot("2026-09-01");
    expect(result.demo).toBe(true);
    expect(new Set(result.clients.flatMap((client) => client.measurements.map((row) => row.unit)))).toEqual(
      new Set(["mg/dL", "mmol/L"]),
    );
    expect(
      new Set(
        result.clients.flatMap((client) =>
          client.measurements.map((row) => row.mealContext),
        ),
      ),
    ).toEqual(new Set(["fasting", "pre_meal", "post_meal", "random"]));
    expect(result.counts.unmeasuredClients).toBe(1);
  });
});
