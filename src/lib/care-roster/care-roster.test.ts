import { describe, expect, it } from "vitest";
import { parseRosterInput } from "./parser";
import type { CareRosterSnapshot } from "./types";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { buildTodayWorkRows, scopeTodayWorkShift } from "@/lib/core-care/today-work";
const date = "2026-09-12";
const base = { clientId: "a1111111-1111-4111-8111-111111111111", serviceDate: date, shift: "morning", staffUserId: null,
  expectedVersion: 0, state: "scheduled", sourceNote: "已確認之照顧計畫", tasks: ["temperature"], approved: true, idempotency_key: "f1111111-1111-4111-8111-111111111111" };
describe("daily allocation validation", () => {
  it("requires explicit human plan approval", () => { expect(parseRosterInput(base).tasks).toEqual(["temperature"]); expect(() => parseRosterInput({ ...base, approved: false })).toThrow(); });
  it.each([{ serviceDate: "2026-02-30" }, { tasks: ["temperature", "temperature"] }, { tasks: ["insulin"] }, { expectedVersion: -1 }, { staffUserId: "name" }, { sourceNote: "" }, { autoApprove: true }])("rejects malformed or unsafe input %j", (change) => { expect(() => parseRosterInput({ ...base, ...change })).toThrow(); });
});
describe("planned roster projection", () => {
  const snapshot = buildDemoDailySnapshot(date);
  const roster: CareRosterSnapshot = { manager: false, status: "ready", staffOptions: [], demo: false, assignments: [{
    id: base.idempotency_key, clientId: base.clientId, staffUserId: base.idempotency_key, staffName: "合成人員", serviceDate: date,
    shift: "afternoon", version: 1, state: "scheduled", isServiceEligible: true, serviceEligibility: "eligible", sourceNote: base.sourceNote, tasks: [{ kind: "temperature", status: "pending", evidenceAt: null }],
  }] };
  it("uses explicit planned client IDs, not all active clients", () => { const rows = buildTodayWorkRows(snapshot, roster); expect(rows).toHaveLength(1); expect(rows[0].id).toBe(base.clientId); });
  it("does not satisfy afternoon measurement from a morning daily summary", () => { const row = buildTodayWorkRows(snapshot, roster)[0]; expect(row.measurements).toBe("0／1 項已有紀錄"); expect(row.tasks).toContain("measurements"); });
  it("retains honest fallback if roster service unavailable", () => { expect(buildTodayWorkRows(snapshot, { ...roster, status: "unavailable", assignments: [] })).toHaveLength(6); });
  it("does not resurrect cancelled allocations", () => { expect(buildTodayWorkRows(snapshot, { ...roster, assignments: [{ ...roster.assignments[0], state: "cancelled" }] })).toHaveLength(0); });
  it.each(["not_admitted", "inactive"] as const)("does not count %s allocations as attendance, measurements, diaries or alerts", (serviceEligibility) => {
    const blocked = { ...roster.assignments[0], isServiceEligible: false, serviceEligibility };
    expect(buildTodayWorkRows(snapshot, { ...roster, manager: true, assignments: [blocked] })).toEqual([]);
    expect(blocked.state).toBe("scheduled");
  });
  it("treats an explicitly empty roster as no allocations, not all active clients", () => {
    expect(buildTodayWorkRows(snapshot, { ...roster, status: "empty", assignments: [] })).toEqual([]);
  });
  it("counts only eligible shifts when one client has both eligible and blocked assignments", () => {
    const mixed: CareRosterSnapshot = { ...roster, manager: true, assignments: [{ ...roster.assignments[0], shift: "morning",
      isServiceEligible: false, serviceEligibility: "inactive" }, roster.assignments[0]] };
    const row = buildTodayWorkRows(snapshot, mixed)[0];
    expect(row.plannedShifts).toHaveLength(1);
    expect(row.plannedShifts?.[0].shift).toBe("afternoon");
    expect(row.measurements).toBe("0／1 項已有紀錄");
  });
  it("does not reveal a roster client absent from authorized directory", () => { expect(buildTodayWorkRows({ ...snapshot, clients: [] }, roster)).toEqual([]); });
  it("keeps shift count and next action aligned, never satisfying afternoon from morning", () => {
    const r: CareRosterSnapshot = { ...roster, assignments: [{ ...roster.assignments[0], shift: "morning", tasks: [{ kind: "temperature", status: "recorded", evidenceAt: `${date}T09:00:00+08:00` }] }, roster.assignments[0]] };
    const row = buildTodayWorkRows(snapshot, r)[0];
    expect(scopeTodayWorkShift(row, "morning").tasks).not.toContain("measurements");
    expect(scopeTodayWorkShift(row, "morning").measurements).toBe("1／1 項已有紀錄");
    expect(scopeTodayWorkShift(row, "afternoon").tasks).toContain("measurements");
  });
});
