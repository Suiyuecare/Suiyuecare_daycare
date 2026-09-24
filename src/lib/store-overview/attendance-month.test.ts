import { describe, expect, it } from "vitest";
import { calendarMonthDays, projectAttendanceMonth } from "./attendance-month";
const scope = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
const now = new Date("2026-09-14T08:00:00Z");
function source() { return {
  organization_id: scope.organizationId, branch_id: scope.branchId, month: "2026-09", generated_at: now.toISOString(),
  days: calendarMonthDays("2026-09").map((date) => ({ date, present: 0, leave: 0, absent: 0 })),
  totals: { present: 0, leave: 0, absent: 0 }, distinct_present_clients: 0,
}; }
describe("month source validation", () => {
  it.each([["2026-02", 28], ["2024-02", 29], ["2026-09", 30], ["2026-12", 31]] as const)("%s includes every actual calendar day", (month, count) => {
    expect(calendarMonthDays(month)).toHaveLength(count);
    expect(calendarMonthDays(month).at(-1)).toBe(`${month}-${count}`);
  });
  it.each(["2026-13", "2026-2", "2026-09-01", "1999-12", "2201-01"])("rejects invalid %s", (month) => expect(() => calendarMonthDays(month)).toThrow());
  it("preserves factual zeros and releases no scope identifiers", () => {
    const result = projectAttendanceMonth(source(), scope, "2026-09", now);
    expect(result.totals).toEqual({ present: 0, leave: 0, absent: 0 });
    expect(result.days).toHaveLength(30);
    expect(JSON.stringify(result)).not.toContain(scope.organizationId);
  });
  it("counts person-days separately from distinct clients", () => {
    const input = source(); input.days[0].present = 2; input.days[1].present = 2;
    input.totals.present = 4; input.distinct_present_clients = 3;
    expect(projectAttendanceMonth(input, scope, "2026-09", now)).toMatchObject({ totals: { present: 4 }, distinctPresentClients: 3 });
  });
  it.each([
    { branch_id: scope.organizationId }, { organization_id: scope.branchId }, { month: "2026-10" },
    { generated_at: "2020-01-01T00:00:00Z" }, { generated_at: "2026-09-14T08:00:31Z" },
    { names: ["private"] }, { distinct_present_clients: 1 }, { totals: { present: 1, leave: 0, absent: 0 } },
  ])("fails closed on inconsistent %j", (change) => expect(() => projectAttendanceMonth({ ...source(), ...change }, scope, "2026-09", now)).toThrow());
  it("rejects truncated, duplicate, unordered dates and leaked daily fields", () => {
    for (const transform of [
      (input: ReturnType<typeof source>) => input.days.pop(),
      (input: ReturnType<typeof source>) => input.days.reverse(),
      (input: ReturnType<typeof source>) => { input.days[1].date = input.days[0].date; },
      (input: ReturnType<typeof source>) => Object.assign(input.days[0], { clientName: "private" }),
    ]) { const input = source(); transform(input); expect(() => projectAttendanceMonth(input, scope, "2026-09", now)).toThrow(); }
  });
});
