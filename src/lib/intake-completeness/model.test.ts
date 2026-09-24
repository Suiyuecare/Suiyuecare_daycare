import { describe, expect, it } from "vitest";
import { CHECK_KEYS, FILTERS, filterRows, hasFreshReportTimestamp, intakeDrilldown, isResolved, reportCounts, snapshotSchema, type CheckState, type CompletenessRow, type IntakeCompletenessSnapshot } from "./model";

export function row(index = 1, changes: Partial<Record<typeof CHECK_KEYS[number], CheckState>> = {}): CompletenessRow { return { clientId: `c1000000-0000-4000-8000-${String(index).padStart(12, "0")}`, displayName: `合成個案${index}`, clientCode: `SYN-${index}`, clientStatus: "active", profileVersion: 1, checks: CHECK_KEYS.map((key) => ({ key, state: changes[key] ?? "complete" })) }; }
export function snapshot(rows = [row()]): IntakeCompletenessSnapshot { return { organizationId: "a1000000-0000-4000-8000-000000000001", branchId: "b1000000-0000-4000-8000-000000000001", asOf: "2026-09-14", generatedAt: "2026-09-14T05:00:00.000Z", rows }; }
describe("intake completeness projection", () => {
  it("keeps unavailable, denied, pending and missing distinct from resolved", () => {
    for (const state of ["denied", "unknown", "pending", "missing", "expired", "replacement", "declined"] as const) expect(isResolved(state)).toBe(false);
    expect(isResolved("not_applicable")).toBe(true);
  });
  it("derives every card and corresponding list from exactly the same snapshot", () => {
    const data = snapshot([row(1, { consent: "pending", health_exam: "expired" }), row(2, { identity: "missing", medication_plan: "denied" }), row(3, { health_exam: "not_applicable" }), row(4, { consent: "declined" })]);
    const counts = reportCounts(data);
    for (const filter of FILTERS) expect(counts[filter]).toBe(filterRows(data, filter).length);
    expect(counts).toEqual({ attention: 3, missing: 1, pending: 2, expired: 1, unknown: 1, resolved: 1, all: 4 });
  });
  it("filters a specific unresolved item, never a complete or not-applicable one", () => {
    const data = snapshot([row(1, { health_exam: "not_applicable" }), row(2, { health_exam: "expired" }), row(3, { health_exam: "unknown" })]);
    expect(filterRows(data, "all", "", "health_exam").map((r) => r.clientCode)).toEqual(["SYN-2", "SYN-3"]);
    expect(filterRows(data, "all", "syn-2", "health_exam")).toHaveLength(1);
    for (const filter of FILTERS) expect(reportCounts(data, "syn-2", "health_exam")[filter]).toBe(filterRows(data, filter, "syn-2", "health_exam").length);
  });
  it("rejects stale and future-skewed server timestamps at exact boundaries", () => {
    const now = Date.parse("2026-09-14T12:00:00Z");
    for (const offset of [-120_000, 0, 60_000]) expect(hasFreshReportTimestamp(new Date(now + offset).toISOString(), now)).toBe(true);
    for (const offset of [-120_001, 60_001]) expect(hasFreshReportTimestamp(new Date(now + offset).toISOString(), now)).toBe(false);
    expect(hasFreshReportTimestamp("invalid", now)).toBe(false);
  });
  it("binds each drilldown to the selected stable client and existing intake step", () => {
    expect(intakeDrilldown(row(1).clientId, "weekly")).toBe(`/app/client-intake?client=${row(1).clientId}&step=weekly`);
    expect(intakeDrilldown(row(2).clientId, "health_exam")).toBe(`/app/client-intake?client=${row(2).clientId}&step=documents`);
    expect(intakeDrilldown(row(1).clientId, "consent")).toContain("step=profile");
    expect(() => intakeDrilldown("../../another-case", "identity")).toThrow();
  });
  it("rejects missing/duplicated fields, duplicate clients and extra sensitive payload", () => {
    for (const data of [snapshot([{ ...row(), checks: [] }]), snapshot([row(), row()]), { ...snapshot(), identityNumber: "PRIVATE" }, snapshot([{ ...row(), checks: CHECK_KEYS.map(() => ({ key: "identity", state: "complete" })) }])]) expect(snapshotSchema.safeParse(data).success).toBe(false);
  });
});
