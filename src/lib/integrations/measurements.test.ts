import { describe, expect, it } from "vitest";

import { IntegrationError } from "./errors";
import {
  parseVitalSet,
  storedVitalSetMatches,
  vitalMeasurementRows,
  vitalSetDatabaseKey,
} from "./measurements";

const clientId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-09-01T04:00:00.000Z");

function validInput() {
  return {
    client_id: clientId,
    measured_at: "2026-09-01T11:30:00+08:00",
    values: {
      systolic: 128,
      diastolic: 76,
      pulse: 72,
      temperature: 36.6,
      oxygen_saturation: 98,
    },
    idempotency_key: "vital-request-0001",
  };
}

describe("dedicated vital-sign input", () => {
  it("normalizes one set into stable per-kind idempotency rows", () => {
    const input = parseVitalSet(validInput(), null, now);
    const rows = vitalMeasurementRows(organizationId, userId, input);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(5);
    expect(vitalMeasurementRows(organizationId, userId, input)).toEqual(rows);
    expect(vitalSetDatabaseKey(organizationId, userId, input)).toBe(
      vitalSetDatabaseKey(organizationId, userId, input),
    );
  });

  it("requires a paired blood pressure and at least one technically valid value", () => {
    for (const values of [
      {},
      { systolic: 120 },
      { oxygen_saturation: 101 },
      { pulse: 72.5 },
      { temperature: 36.66 },
    ]) {
      expect(() =>
        parseVitalSet({ ...validInput(), values }, null, now),
      ).toThrowError(IntegrationError);
    }
  });

  it("enforces the 24-hour draft boundary and a five-minute clock allowance", () => {
    expect(() =>
      parseVitalSet(
        { ...validInput(), measured_at: "2026-08-31T11:29:59+08:00" },
        null,
        now,
      ),
    ).toThrowError(/超過允許範圍/u);
    expect(() =>
      parseVitalSet(
        { ...validInput(), measured_at: "2026-09-01T12:06:00+08:00" },
        null,
        now,
      ),
    ).toThrowError(/未來範圍/u);

    expect(
      parseVitalSet(
        { ...validInput(), measured_at: "2026-08-31T11:29:59+08:00" },
        null,
        now,
        { enforceTimeWindow: false },
      ).measuredAt,
    ).toBe("2026-08-31T03:29:59.000Z");
  });

  it("recognizes exact replay content and rejects partial or changed rows", () => {
    const input = parseVitalSet(validInput(), null, now);
    const rows = vitalMeasurementRows(organizationId, userId, input);
    const stored = rows.map((row) => ({
      client_id: input.clientId,
      measurement_kind: row.measurementKind,
      measured_at: input.measuredAt,
      numeric_value: String(row.numericValue),
      unit: row.unit,
      context: { _request: { idempotency_hash: input.contentHash } },
      idempotency_key: row.idempotencyKey,
    }));
    expect(storedVitalSetMatches(stored, rows, input)).toBe(true);
    expect(storedVitalSetMatches(stored.slice(1), rows, input)).toBe(false);
    expect(
      storedVitalSetMatches(
        stored.map((row, index) =>
          index === 0 ? { ...row, numeric_value: "999" } : row,
        ),
        rows,
        input,
      ),
    ).toBe(false);
  });
});
