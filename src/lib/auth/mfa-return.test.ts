import { describe, expect, it } from "vitest";
import { safeMfaReturnPath } from "./mfa-return";

const route = "/app/staff/service-management/attendance";
const client = "c0800000-0000-4000-8000-000000000001";

describe("safe MFA return path", () => {
  it("returns only to the scoped attendance queue after staff reauthentication", () => {
    expect(safeMfaReturnPath(`${route}?date=2026-10-11&client=${client}`, "staff"))
      .toBe(`${route}?date=2026-10-11&client=${client}`);
    expect(safeMfaReturnPath(`${route}?date=2026-10-11&shift=morning`, "staff"))
      .toBe(`${route}?date=2026-10-11&shift=morning`);
    expect(safeMfaReturnPath(`${route}?date=2026-10-11&shift=full_day`, "staff"))
      .toBe(`${route}?date=2026-10-11&shift=full_day`);
  });

  it.each([
    "https://evil.example/app/staff/service-management/attendance?date=2026-10-11",
    "//evil.example/app/staff/service-management/attendance?date=2026-10-11",
    "/app/staff/service-management/attendance-else?date=2026-10-11",
    `${route}?date=2026-10-11&next=https%3A%2F%2Fevil.example`,
    `${route}?date=2026-10-11&date=2026-10-12`,
    `${route}?date=2026-02-30`,
    `${route}?date=2026-10-11&client=wrong`,
    `${route}?date=2026-10-11&shift=all`,
    `${route}?date=2026-10-11#outside`,
  ])("rejects untrusted or malformed return destination %s", (candidate) => {
    expect(safeMfaReturnPath(candidate, "staff")).toBe("/app/dashboard");
  });

  it("keeps family authentication on its own route", () => {
    expect(safeMfaReturnPath(`${route}?date=2026-10-11`, "family")).toBe("/family/home");
    expect(safeMfaReturnPath(null, "staff")).toBe("/app/dashboard");
  });
});
