import { describe, expect, it } from "vitest";
import { addDays, daySchema, emptyDay, emptyPlan, planSchema, previewWeeklyPlan, weeklyInputSchema, weeklySnapshotSchema } from "./schema";

describe("client weekly attendance intent", () => {
  const scheduled = { ...emptyDay(1), attending: true, startsAt: "09:00", endsAt: "16:00" };
  const need = { location: "合成接送點", contact: "合成聯絡人", windowStart: "08:30", windowEnd: "09:00", wheelchair: true };
  it("has seven distinct unselected days, never implied attendance", () => {
    const p = emptyPlan("2026-09-14");
    expect(p.days).toHaveLength(7); expect(p.days.every((d) => !d.attending && !d.outbound && !d.inbound)).toBe(true);
  });
  it.each(["24:00", "09:60", "9:00", "", "12:30:00"])("rejects invalid time %s", (startsAt) => expect(daySchema.safeParse({ ...scheduled, startsAt }).success).toBe(false));
  it("rejects reversed times and hidden transport on nonattendance", () => {
    expect(daySchema.safeParse({ ...scheduled, endsAt: "08:00" }).success).toBe(false);
    expect(daySchema.safeParse({ ...emptyDay(1), outbound: need }).success).toBe(false);
  });
  it("keeps separate outbound and inbound demand and checks both windows", () => {
    expect(daySchema.safeParse({ ...scheduled, outbound: need }).success).toBe(true);
    expect(daySchema.safeParse({ ...scheduled, inbound: need }).success).toBe(false);
    expect(daySchema.safeParse({ ...scheduled, outbound: { ...need, windowEnd: "09:30" } }).success).toBe(false);
    expect(daySchema.safeParse({ ...scheduled, outbound: { ...need, windowStart: "10:00" } }).success).toBe(false);
    expect(daySchema.safeParse({ ...scheduled, inbound: { ...need, windowStart: "16:00", windowEnd: "16:30" } }).success).toBe(true);
  });
  it("rejects unknown fields, duplicate days, missing contacts, and invalid dates", () => {
    const p = { ...emptyPlan("2026-09-14"), reason: "已確認固定安排" };
    expect(planSchema.safeParse({ ...p, days: Array(7).fill(emptyDay(1)) }).success).toBe(false);
    expect(planSchema.safeParse({ ...p, effectiveFrom: "2026-02-30" }).success).toBe(false);
    expect(daySchema.safeParse({ ...scheduled, outbound: { ...need, contact: "" } }).success).toBe(false);
    expect(daySchema.safeParse({ ...scheduled, executed: true }).success).toBe(false);
  });
  it("projects four exact Mondays across month boundary without local timezone arithmetic", () => {
    const p = emptyPlan("2026-09-14"); p.days[0] = scheduled;
    const days = previewWeeklyPlan(p, "2026-09-14");
    expect(days.filter((d) => d.status === "scheduled").map((d) => d.date)).toEqual(["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(days).toHaveLength(28); expect(days.every((d) => d.transportStatus === "unassigned_demand")).toBe(true);
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("honors inclusive effective dates and suppresses outside dates", () => {
    const p = { ...emptyPlan("2026-09-21"), effectiveTo: "2026-09-28" }; p.days[0] = scheduled;
    expect(previewWeeklyPlan(p, "2026-09-14").filter((d) => d.status === "scheduled").map((d) => d.date)).toEqual(["2026-09-21", "2026-09-28"]);
  });
  it("requires an optimistic version, UUID operation, and matching exception weekday", () => {
    const input = { action: "save_exception", clientId: "c1600000-0000-4000-8000-000000000001", expectedVersion: 0, serviceDate: "2026-09-14", day: scheduled, reason: "臨時安排到站", idempotency_key: "c1800000-0000-4000-8000-000000000001" };
    expect(weeklyInputSchema.safeParse(input).success).toBe(true);
    expect(weeklyInputSchema.safeParse({ ...input, day: { ...scheduled, weekday: 2 } }).success).toBe(false);
    expect(weeklyInputSchema.safeParse({ ...input, expectedVersion: -1 }).success).toBe(false);
  });
  it("accepts a complete empty persisted read without reporting fictitious plans", () => {
    expect(weeklySnapshotSchema.safeParse({ clientId: "c1600000-0000-4000-8000-000000000001", from: "2026-09-14", generatedAt: "2026-09-14T00:00:00Z", version: 0, plan: null, exceptions: [], days: previewWeeklyPlan(emptyPlan("2026-09-14"), "2026-09-14") }).success).toBe(true);
  });
});
