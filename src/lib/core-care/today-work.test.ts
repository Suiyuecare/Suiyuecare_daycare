import { describe, expect, it } from "vitest";
import { buildDemoDailySnapshot } from "./demo";
import { isDailyWorkClient, parseDailyWorkSelection } from "./selection-query";
import { buildTodayWorkRows, filterTodayWorkRows } from "./today-work";

describe("today review queue", () => {
  it("does not fabricate fallback missing tasks for unscheduled or unknown cases", () => {
    const snapshot = buildDemoDailySnapshot("2026-09-10");
    for (const state of ["not_expected", "unknown"] as const) {
      const client = { ...snapshot.clients[0]!, attendance: null, vitalSigns: null, careDiary: null,
        applicability: { attendance: state, care: state, eligible: true, reason: "unknown" as const } };
      expect(buildTodayWorkRows({ ...snapshot, clients: [client] })[0]?.tasks).toEqual([]);
    }
  });
  it("does not create tasks from a per-client restricted source", () => {
    const snapshot = buildDemoDailySnapshot("2026-09-10");
    const client = { ...snapshot.clients[0]!, sourceAccess: { attendance: false, measurements: false, careDiaries: false, serviceEvents: false } };
    const row = buildTodayWorkRows({ ...snapshot, clients: [client] })[0]!;
    expect(row.tasks).toEqual([]); expect(row.nextPage).toBeNull();
  });
  it("counts the same rows used by each filter and prioritizes flagged records", () => {
    const rows = buildTodayWorkRows(buildDemoDailySnapshot("2026-09-10"));
    expect(rows).toHaveLength(6);
    expect(rows[0]?.tasks).toContain("attention");
    expect(filterTodayWorkRows(rows, "pending")).toHaveLength(5);
    expect(filterTodayWorkRows(rows, "attendance")).toHaveLength(1);
    expect(filterTodayWorkRows(rows, "measurements")).toHaveLength(2);
    expect(filterTodayWorkRows(rows, "diary")).toHaveLength(2);
    expect(filterTodayWorkRows(rows, "attention")).toHaveLength(1);
    expect(filterTodayWorkRows(rows, "all", " hx-022 ")[0]?.nextPage).toBe(6);
    expect(filterTodayWorkRows(rows, "all", "不存在")).toEqual([]);
  });

  it.each(["leave", "absent", "cancelled"] as const)("does not prompt new care for %s, but keeps an existing unsigned record", (status) => {
    const snapshot = buildDemoDailySnapshot("2026-09-10");
    const client = { ...snapshot.clients[0]!, attendance: { ...snapshot.clients[0]!.attendance!, status }, vitalSigns: null, careDiary: null };
    expect(buildTodayWorkRows({ ...snapshot, clients: [client] })[0]?.tasks).toEqual([]);
    expect(buildTodayWorkRows({ ...snapshot, clients: [{ ...client, careDiary: { ...snapshot.clients[0]!.careDiary!, status: "submitted", hasAbnormalFlag: false } }] })[0]?.tasks).toEqual(["diary"]);
  });

  it("does not expose disabled-source values, alerts or next links even if upstream passed them", () => {
    const snapshot = buildDemoDailySnapshot("2026-09-10");
    const masked = { ...snapshot, sourceAccess: { clients: true, attendance: false, measurements: false, careDiaries: false, serviceEvents: false } };
    for (const row of buildTodayWorkRows(masked)) {
      expect(row.tasks).toEqual([]);
      expect([row.attendance, row.measurements, row.diary]).toEqual(Array(3).fill("無查閱權限"));
      expect(row.nextPage).toBeNull();
    }
    expect(buildTodayWorkRows({ ...masked, sourceAccess: { ...masked.sourceAccess, clients: false } })).toEqual([]);
  });

  it("does not assume full measurement completion from one captured kind", () => {
    const snapshot = buildDemoDailySnapshot("2026-09-10");
    expect(buildTodayWorkRows(snapshot)[0]?.measurements).toBe("已有量測");
    expect(buildTodayWorkRows({ ...snapshot, clients: [] })).toEqual([]);
  });
});

describe("daily work URL selection", () => {
  const now = new Date("2026-09-09T17:00:00Z");
  it("defaults to Taipei today without a client", () => {
    expect(parseDailyWorkSelection({}, now)).toEqual({ serviceDate: "2026-09-10", selectedClientId: undefined, invalid: false });
  });
  it.each([
    { client: "" }, { client: "wrong" }, { client: ["a1111111-1111-4111-8111-111111111111", "a1111111-1111-4111-8111-111111111111"] },
    { date: "2026-02-30" }, { date: ["2026-09-10"] }, { date: "" }, { date: "2026-13-01" },
  ])("rejects invalid or repeated fields: %j", (query) => {
    expect(parseDailyWorkSelection(query, now).invalid).toBe(true);
  });
  it("canonicalizes UUID casing while preserving a valid selected date", () => {
    expect(parseDailyWorkSelection({ client: "A1111111-1111-4111-8111-111111111111", date: "2026-08-31" }, now)).toEqual({
      serviceDate: "2026-08-31", selectedClientId: "a1111111-1111-4111-8111-111111111111", invalid: false,
    });
  });
});

describe("daily client eligibility", () => {
  it("does not offer daily work before the admission date or after a lifecycle transition", () => {
    const client = { status: "active", admitted_on: "2026-09-10", ended_on: null };
    expect(isDailyWorkClient(client, "2026-09-09")).toBe(false);
    expect(isDailyWorkClient(client, "2026-09-10")).toBe(true);
    expect(isDailyWorkClient({ ...client, admitted_on: null }, "2026-09-10")).toBe(false);
    expect(isDailyWorkClient({ ...client, ended_on: "2026-09-09" }, "2026-09-10")).toBe(false);
    for (const status of ["suspended", "closed", "pending_admission", "deceased", "transferred"]) {
      expect(isDailyWorkClient({ ...client, status }, "2026-09-10")).toBe(false);
    }
  });
});
