import { describe, expect, it } from "vitest";

import {
  bloodGlucoseDatabaseKey,
  parseBloodGlucoseMeasurement,
} from "./blood-glucose";
import { IntegrationError } from "./errors";

const clientId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const branchId = "24444444-4444-4444-8444-444444444444";
const userId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-09-01T04:00:00.000Z");

function validInput() {
  return {
    client_id: clientId,
    measured_at: "2026-09-01T11:30:00+08:00",
    meal_context: "pre_meal",
    value: 126,
    unit: "mg/dL",
  };
}

describe("dedicated blood-glucose input", () => {
  it("accepts an integer mg/dL value and derives a stable actor-scoped database key", () => {
    const input = parseBloodGlucoseMeasurement(
      validInput(),
      "glucose-request-0001",
      now,
    );

    expect(input).toMatchObject({
      clientId,
      measuredAt: "2026-09-01T03:30:00.000Z",
      mealContext: "pre_meal",
      value: 126,
      unit: "mg/dL",
    });
    expect(bloodGlucoseDatabaseKey(organizationId, branchId, userId, input)).toBe(
      bloodGlucoseDatabaseKey(organizationId, branchId, userId, input),
    );
  });

  it("accepts mmol/L with at most one decimal place", () => {
    expect(
      parseBloodGlucoseMeasurement(
        { ...validInput(), meal_context: "post_meal", value: 7.8, unit: "mmol/L" },
        "glucose-request-0002",
        now,
      ),
    ).toMatchObject({ mealContext: "post_meal", value: 7.8, unit: "mmol/L" });
  });

  it("rejects fractional or out-of-range mg/dL values", () => {
    for (const value of [19, 126.5, 601]) {
      expect(() =>
        parseBloodGlucoseMeasurement(
          { ...validInput(), value },
          "glucose-request-0003",
          now,
        ),
      ).toThrowError(/mg\/dL/u);
    }
  });

  it("rejects excess precision or out-of-range mmol/L values", () => {
    for (const value of [1, 7.85, 33.4]) {
      expect(() =>
        parseBloodGlucoseMeasurement(
          { ...validInput(), value, unit: "mmol/L" },
          "glucose-request-0004",
          now,
        ),
      ).toThrowError(/mmol\/L/u);
    }
  });

  it("accepts only the four meal contexts and two explicit units", () => {
    for (const patch of [
      { meal_context: "bedtime" },
      { unit: "mg%" },
    ]) {
      expect(() =>
        parseBloodGlucoseMeasurement(
          { ...validInput(), ...patch },
          "glucose-request-0005",
          now,
        ),
      ).toThrowError(IntegrationError);
    }
  });

  it("rejects caller-supplied scope, actor, source, hash, signature, and body token", () => {
    for (const field of [
      "organization_id",
      "branch_id",
      "actor_id",
      "source",
      "request_hash",
      "signature",
      "idempotency_key",
    ]) {
      expect(() =>
        parseBloodGlucoseMeasurement(
          { ...validInput(), [field]: "caller-value" },
          "glucose-request-0006",
          now,
        ),
      ).toThrowError(IntegrationError);
    }
  });

  it("requires a header idempotency token", () => {
    expect(() =>
      parseBloodGlucoseMeasurement(validInput(), null, now),
    ).toThrowError(/冪等鍵/u);
  });

  it("enforces the new-write time boundary but allows production replay to reach the database", () => {
    const old = { ...validInput(), measured_at: "2026-08-31T11:29:59+08:00" };
    const future = { ...validInput(), measured_at: "2026-09-01T12:06:00+08:00" };

    expect(() =>
      parseBloodGlucoseMeasurement(old, "glucose-request-0007", now),
    ).toThrowError(/超過允許範圍/u);
    expect(() =>
      parseBloodGlucoseMeasurement(future, "glucose-request-0008", now),
    ).toThrowError(/未來範圍/u);

    expect(
      parseBloodGlucoseMeasurement(
        old,
        "glucose-request-0007",
        now,
        { enforceTimeWindow: false },
      ).measuredAt,
    ).toBe("2026-08-31T03:29:59.000Z");
  });
});
