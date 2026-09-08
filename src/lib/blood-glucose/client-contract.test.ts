import { describe, expect, it } from "vitest";

import { BloodGlucoseClientContractError, parseBloodGlucoseSuccess } from "./client-contract";

const expected = {
  clientId: "04000000-0000-4000-8000-000000000001",
  measuredAt: "2026-09-01T00:30:00.000Z",
  mealContext: "pre_meal" as const,
  value: 105,
  unit: "mg/dL" as const,
};
const data = {
  id: "04000000-0000-4000-8000-000000000002",
  ...expected,
  source: "staff",
  replayed: false,
  persisted: true,
  demo: false,
};
const wrap = (value: unknown) => ({
  requestId: "04000000-0000-4000-8000-000000000003",
  status: "ok",
  data: value,
  errors: [],
});

describe("blood glucose browser success contract", () => {
  it("accepts a correlated persisted measurement", () => {
    expect(parseBloodGlucoseSuccess(wrap(data), 201, expected).data.value).toBe(105);
  });

  it("requires replayed measurements to use 200", () => {
    const replayed = wrap({ ...data, replayed: true });
    expect(() => parseBloodGlucoseSuccess(replayed, 201, expected)).toThrow(BloodGlucoseClientContractError);
    expect(parseBloodGlucoseSuccess(replayed, 200, expected).data.replayed).toBe(true);
  });

  it("rejects mismatched measurement facts and unknown fields", () => {
    expect(() => parseBloodGlucoseSuccess(wrap({ ...data, value: 106 }), 201, expected)).toThrow(BloodGlucoseClientContractError);
    expect(() => parseBloodGlucoseSuccess(wrap({ ...data, injected: true }), 201, expected)).toThrow(BloodGlucoseClientContractError);
    expect(() => parseBloodGlucoseSuccess(wrap({ ...data, clientId: "04000000-0000-4000-8000-000000000099" }), 201, expected)).toThrow(BloodGlucoseClientContractError);
  });
});
