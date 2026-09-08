import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isStrictOffsetDateTime, parseIsoDateTime } from "./datetime";

describe("strict offset calendar timestamps", () => {
  it.each([
    ["2024-02-29T23:59:59+08:00", "2024-02-29T15:59:59.000Z"],
    ["2000-02-29T00:00:00Z", "2000-02-29T00:00:00.000Z"],
    ["2026-09-08T00:00:00+08:00", "2026-09-07T16:00:00.000Z"],
    ["2026-09-08T00:00:00-05:30", "2026-09-08T05:30:00.000Z"],
    ["2026-09-08T10:30+08:00", "2026-09-08T02:30:00.000Z"],
    ["2026-09-08T10:30:15.123456Z", "2026-09-08T10:30:15.123Z"],
    ["2026-09-08t10:30:15z", "2026-09-08T10:30:15.000Z"],
    ["2026-09-08t10:30:15+08:00", "2026-09-08T02:30:15.000Z"],
  ])("normalizes a valid calendar timestamp %s", (input, expected) => {
    expect(isStrictOffsetDateTime(input)).toBe(true);
    expect(parseIsoDateTime(input, "occurred_at")).toBe(expected);
  });

  it.each([
    "2026-02-30T10:00:00+08:00", "2026-02-29T10:00:00+08:00", "1900-02-29T10:00:00Z",
    "2026-04-31T10:00:00+08:00", "2026-09-08T24:00:00Z", "2026-09-08T10:60:00Z",
    "2026-09-08T10:00:60Z", "2026-09-08T10:00:00+24:00", "2026-09-08T10:00:00+08:60",
    "2026-09-08", "2026-09-08T10:00:00", "September 8, 2026 10:00 GMT+0800",
    "2026-09-08 10:00:00Z", " 2026-09-08T10:00:00Z", "2026-09-08T10:00:00Z ",
    "2026-09-08T10:00:00Z\n", null, 1788825600000,
  ])("rejects invalid or ambiguous input without rolling dates %s", (input) => {
    expect(isStrictOffsetDateTime(input)).toBe(false);
    expect(() => parseIsoDateTime(input, "occurred_at")).toThrow(expect.objectContaining({
      code: "INVALID_DATETIME", field: "occurred_at", httpStatus: 400,
    }));
  });

  it("keeps inclusive min/max instant boundaries and their structured errors", () => {
    const options = { min: new Date("2026-09-07T16:00:00Z"), max: new Date("2026-09-08T16:00:00Z") };
    expect(parseIsoDateTime("2026-09-08T00:00:00+08:00", "at", options)).toBe(options.min.toISOString());
    expect(parseIsoDateTime("2026-09-09T00:00:00+08:00", "at", options)).toBe(options.max.toISOString());
    expect(() => parseIsoDateTime("2026-09-07T15:59:59.999Z", "at", options))
      .toThrow(expect.objectContaining({ code: "DATETIME_TOO_OLD" }));
    expect(() => parseIsoDateTime("2026-09-08T16:00:00.001Z", "at", options))
      .toThrow(expect.objectContaining({ code: "DATETIME_IN_FUTURE" }));
  });

  it("does not reintroduce the known weak timezone-only predicate in production library files", () => {
    const root = resolve(process.cwd(), "src/lib");
    const weak = String.raw`/[zZ]|[+-]\d{2}:\d{2}$/u.test(value)`;
    const offenders = readdirSync(root, { recursive: true }).filter((path) =>
      typeof path === "string" && path.endsWith(".ts") && !path.endsWith(".test.ts") &&
      readFileSync(resolve(root, path), "utf8").includes(weak));
    expect(offenders).toEqual([]);
  });
});
