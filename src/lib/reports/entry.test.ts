import { afterEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildOperationalReportLinks, buildReportEntries, parseReportPeriods } from "./entry";

afterEach(() => vi.useRealTimers());
const periods = { date: "2026-09-08", month: "2026-08" };
const authorized = { demo: false, scopes: ["reports.read", "clients.read",
  "daily_service_summary.read", "professional_service_summary.read"] };

describe("report entry query and source boundaries", () => {
  it("links operational worklists only with source permissions and explicit owner admission", () => {
    expect(buildOperationalReportLinks({ demo: false, scopes: ["reports.read"] }, periods)).toEqual([]);
    const source = { demo: false, scopes: ["reports.read", "clients.read", "clients.demographics.read", "staff_certificates.read"] };
    expect(buildOperationalReportLinks(source, periods).map((link) => link.id)).toEqual(["intake", "qualification"]);
    expect(buildOperationalReportLinks(source, periods, true).at(-1)?.href).toBe("/app/store-attendance-month?month=2026-08");
    expect(buildOperationalReportLinks({ demo: false, scopes: [] }, periods, true)).toEqual([]);
    expect(buildOperationalReportLinks(source, { ...periods, month: "2026-99" }, true)).toEqual([]);
  });
  it("uses Asia/Taipei defaults across a UTC day and month boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T16:00:00Z"));
    expect(parseReportPeriods({})).toEqual({
      periods: { date: "2026-09-01", month: "2026-09" }, invalid: false,
    });
  });
  it("preserves independent valid day and month selections", () => {
    expect(parseReportPeriods(periods)).toEqual({ periods, invalid: false });
  });
  it.each([
    { date: "2026-02-29" }, { date: "1999-12-31" }, { date: "2201-01-01" },
    { month: "2026-13" }, { month: "2026-2" }, { month: "2201-01" },
    { date: ["2026-09-08", "2026-09-09"] }, { month: ["2026-09"] },
    { branch: "other-branch" }, { client: "other-client" }, { date: "" },
  ])("rejects invalid or unsupported filters without accepting hidden scope: %j", (query) => {
    expect(parseReportPeriods(query).invalid).toBe(true);
  });
  it("preserves catalog paths and source query values without extra scope", () => {
    const entries = buildReportEntries(authorized, periods);
    expect(entries.map((entry) => entry.pageNumber)).toEqual([54, 42]);
    expect(entries.map((entry) => entry.href)).toEqual([
      `/app/${staffPages.find((page) => page.number === 54)!.slug}?date=2026-09-08`,
      `/app/${staffPages.find((page) => page.number === 42)!.slug}?month=2026-08`,
    ]);
    expect(entries.every((entry) => !("updatedAt" in entry) && !("total" in entry))).toBe(true);
  });
  it("requires report-entry permission separately from source permissions", () => {
    expect(buildReportEntries({ demo: false, scopes: authorized.scopes.slice(1) }, periods)).toEqual([]);
  });
  it.each([
    { scopes: ["reports.read"], expected: [false, false] },
    { scopes: ["reports.read", "daily_service_summary.read"], expected: [false, false] },
    { scopes: ["reports.read", "clients.read", "daily_service_summary.read"], expected: [true, false] },
    { scopes: ["reports.read", "clients.read", "professional_service_summary.read"], expected: [false, true] },
  ])("does not create unauthorized source links for $scopes", ({ scopes, expected }) => {
    expect(buildReportEntries({ demo: false, scopes }, periods)
      .map((entry) => entry.href !== null)).toEqual(expected);
  });
  it("never builds links from an invalid caller-supplied period", () => {
    expect(buildReportEntries(authorized, { ...periods, month: "2026-99" })).toEqual([]);
  });
  it("allows synthetic demo links without granting real source permissions", () => {
    expect(buildReportEntries({ demo: true, scopes: [] }, periods).every((entry) => entry.href)).toBe(true);
  });
});
