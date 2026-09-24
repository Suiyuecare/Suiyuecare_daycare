import { describe, expect, it } from "vitest";
import { buildDemoStaffCertificateSnapshot } from "@/lib/staff-certificates/demo";
import type { StaffCertificateRecord, StaffCertificateSnapshot } from "@/lib/staff-certificates/types";
import { parseQualificationFilters } from "./filters";
import { projectQualificationReport, qualificationDaysBetween } from "./projection";

const scope = { organizationId: "72000000-0000-4000-8000-000000000001", branchId: "72000000-0000-4000-8000-000000000002", branchName: "測試分支" };
const filters = parseQualificationFilters({});
function source(): StaffCertificateSnapshot { return buildDemoStaffCertificateSnapshot({ ...scope,
  filters: { staffMembershipId: null, certificateType: null, status: "all", query: "" },
  now: new Date("2026-09-14T03:00:00Z") }); }
function reportWith(patch: Partial<StaffCertificateRecord>) {
  const snapshot = source();
  snapshot.records = [{ ...snapshot.records[1], ...patch }];
  snapshot.staffOptions = snapshot.staffOptions.filter((staff) => staff.staffMembershipId === snapshot.records[0].staffMembershipId);
  return projectQualificationReport(snapshot, scope, filters);
}

describe("staff qualification reminders, not service authorization", () => {
  it.each([
    ["2026-09-13", "expired", -1], ["2026-09-14", "due_soon", 0],
    ["2026-10-14", "due_soon", 30], ["2026-10-15", null, 31],
  ])("compares calendar-date expiry inclusively: %s", (expiresOn, issue, days) => {
    const report = reportWith({ expiresOn });
    expect(report.rows[0].daysToExpiry).toBe(days);
    expect(report.rows[0].issues).toEqual(issue ? [issue] : []);
    expect(report.serviceEligibility).toBe("not_evaluated");
  });
  it("uses Taipei midnight and leap dates, independent of host timezone", () => {
    expect(qualificationDaysBetween("2028-02-28", "2028-03-01")).toBe(2);
    const snapshot = source(); snapshot.generatedAt = "2026-09-13T16:00:00.000Z";
    expect(projectQualificationReport(snapshot, scope, filters).snapshotDate).toBe("2026-09-14");
    snapshot.generatedAt = "2026-09-13T15:59:59.000Z";
    expect(() => projectQualificationReport(snapshot, scope, filters)).toThrow("QUALIFICATION_SOURCE_INVALID");
    expect(() => qualificationDaysBetween("2026-02-29", "2026-03-01")).toThrow();
  });
  it("keeps missing expiry, pending registration, verification and evidence distinct", () => {
    const report = reportWith({ expiresOn: null, registrationStatus: "pending", verificationStatus: "pending", evidenceStatus: "missing" });
    expect(report.rows[0].issues).toEqual(["unknown_expiry", "registration", "verification", "evidence"]);
    expect(report.rows[0].daysToExpiry).toBeNull();
    expect(report.counts.expired).toBe(0);
    expect(report.counts.missing_record).toBe(0);
  });
  it("does not require registration/evidence where explicitly not applicable", () => {
    const report = reportWith({ registrationStatus: "not_required", evidenceStatus: "not_applicable" });
    expect(report.rows[0].issues).toEqual([]);
  });
  it("does not convert a dual-approved exception into valid service eligibility", () => {
    const report = reportWith({ expiresOn: "2026-09-13", hasActiveException: true, approvalCount: 2 });
    expect(report.rows[0].issues).toContain("expired");
    expect(report.serviceEligibility).toBe("not_evaluated");
  });
  it("excludes inactive memberships and voided versions, labels only truly absent active records", () => {
    const snapshot = source(); snapshot.records = snapshot.records.map((record) => ({ ...record, recordStatus: "voided" }));
    snapshot.staffOptions = snapshot.staffOptions.map((staff, index) => ({ ...staff, isCurrent: index === 0 }));
    const report = projectQualificationReport(snapshot, scope, filters);
    expect(report.rows).toHaveLength(1); expect(report.rows[0].issues).toEqual(["missing_record"]);
    expect(report.rows[0].certificateType).toBeNull(); expect(report.rows[0].actionHref).toContain(`staff=${snapshot.staffOptions[0].staffMembershipId}`);
  });
  it("does not infer missing certificates from a truncated source", () => {
    const snapshot = source(); snapshot.records = []; snapshot.recordsTruncated = true; snapshot.recordTotal = 250;
    const report = projectQualificationReport(snapshot, scope, filters);
    expect(report.incomplete).toBe(true); expect(report.missingRecordsKnown).toBe(false);
    expect(report.rows).toHaveLength(0); expect(report.counts.missing_record).toBe(0);
  });
  it("narrows staff and issue, with card totals from the same staff-and-search selection", () => {
    const snapshot = source(); const staff = snapshot.staffOptions[0].staffMembershipId;
    snapshot.filters.staffMembershipId = staff;
    const report = projectQualificationReport(snapshot, scope, { staff, issue: "expired", query: "甲" });
    expect(report.rows).toHaveLength(1); expect(report.visibleCurrentStaff).toBe(1);
    expect(report.rows[0].staffMembershipId).toBe(staff); expect(report.counts.expired).toBe(1);
    expect(report.rows[0].actionHref).toContain("type=");
  });
  it("card counts equal every resulting issue detail under the same text query", () => {
    const snapshot = source();
    const selection = { staff: null, issue: "all" as const, query: "甲" };
    const report = projectQualificationReport(snapshot, scope, selection);
    expect(report.counts.expired).toBe(1); expect(report.counts.registration).toBe(0);
    for (const issue of Object.keys(report.counts) as (keyof typeof report.counts)[]) {
      const detail = projectQualificationReport(snapshot, scope, { ...selection, issue });
      expect(detail.rows.length).toBe(report.counts[issue]);
    }
    expect(projectQualificationReport(snapshot, scope, { ...selection, query: "no-match" }).totalRows).toBe(0);
  });
  it("does not include certificate number, source hash, notes, auth context or health data", () => {
    const oversizedScope = { ...scope, secret: "not-public" };
    const report = projectQualificationReport(source(), oversizedScope, filters);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/SYNTH-|contentHash|certificateNumber|not-public|verificationStatus/);
  });
  it.each([
    { organizationId: "foreign" }, { branchId: "foreign" },
    { filters: { staffMembershipId: null, certificateType: null, status: "expired", query: "" } },
    { filters: { staffMembershipId: null, certificateType: "some", status: "all", query: "" } },
  ])("rejects foreign or incomplete filtered sources %#", (patch) => {
    expect(() => projectQualificationReport({ ...source(), ...patch } as StaffCertificateSnapshot, scope, filters)).toThrow("QUALIFICATION_SOURCE_INVALID");
  });
  it.each([{ issue: "medical_eligible" }, { staff: "not-uuid" }, { issue: ["expired", "all"] }, { branch: "foreign" }, { q: "\n" }, { q: "x".repeat(121) }])("rejects malformed or scope-injection filters %#", (query) => {
    expect(() => parseQualificationFilters(query)).toThrow();
  });
});
