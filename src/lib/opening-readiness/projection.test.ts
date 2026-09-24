import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { getPageBySlug } from "@/lib/catalog";
import { buildDemoOpeningReadinessSources } from "./demo";
import { projectOpeningReadiness } from "./projection";
import { canViewOpeningReadiness } from "./types";

const now = new Date("2026-09-13T01:00:00Z");
const serviceDate = "2026-09-13";
const context: TenantContext = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333", organizationName: "合成機構", branchName: "合成分支", displayName: "合成主管",
  roles: ["organization_manager"], scopes: [], assuranceLevel: "aal2", recentAal2At: null, demo: true };
function fixtures() { return buildDemoOpeningReadinessSources(context, serviceDate, now); }
function project(sources = fixtures(), actor = context, date = serviceDate) {
  const result = projectOpeningReadiness({ context: actor, serviceDate: date, sources, now });
  if (result.status === "forbidden") throw new Error("Expected authorized fixture");
  return result;
}

describe("opening readiness: factual checklist, never automatic launch approval", () => {
  it("projects each preparation area, no personal information or real-data approval", () => {
    const result = project();
    expect(result.items).toHaveLength(9);
    expect(result.items.find((i) => i.id === "institution")?.status).toBe("ready");
    expect(result.items.find((i) => i.id === "roster")?.status).toBe("needs_attention");
    expect(result.items.find((i) => i.id === "clients")?.status).toBe("ready");
    expect(result.realDataIntakeApproved).toBe(false);
    expect(result.fullLaunchApproved).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/陳O華|林O英|合成員工甲|59000000|SYNTHETIC-PERMIT/);
    expect(Object.values(result.counts).reduce((a, b) => a + b, 0)).toBe(result.items.length);
  });

  it.each(["branch_director", "care_worker", "nurse", "finance_claims", "family", "platform_ops"] as const)("denies %s, including demo", (role) => {
    const actor = { ...context, roles: [role] };
    expect(canViewOpeningReadiness(actor)).toBe(false);
    expect(projectOpeningReadiness({ context: actor, serviceDate, sources: fixtures(), now })).toEqual({ status: "forbidden" });
  });
  it("allows branch supervisor but not an elevated family or platform identity", () => {
    expect(canViewOpeningReadiness({ ...context, roles: ["branch_supervisor"] })).toBe(true);
    expect(canViewOpeningReadiness({ ...context, roles: ["family", "organization_manager"] })).toBe(false);
    expect(canViewOpeningReadiness({ ...context, roles: ["platform_ops", "organization_manager"] })).toBe(false);
  });

  it("uses current job labels without changing readiness responsibilities", () => {
    const items = project().items;
    expect(items.find((item) => item.id === "staff")?.owner).toBe("機構管理員（單點管理）");
    expect(items.find((item) => item.id === "clients")?.owner).toBe("社工人員");
    expect(items.find((item) => item.id === "data_safety")?.owner).toContain("全機構管理員（多點管理）");
    expect(items.find((item) => item.id === "recovery")?.owner).toContain("系統維護人員");
    expect(JSON.stringify(items)).not.toMatch(/分支主管|個管／社工/);
  });

  it("isolates a failed source and never replaces it with zero counts", () => {
    const sources = fixtures(); sources.staff = { status: "unavailable" };
    const result = project(sources);
    for (const id of ["staff", "qualifications", "roster"]) expect(result.items.find((i) => i.id === id)?.status).toBe("unavailable");
    expect(result.items.find((i) => i.id === "institution")?.status).toBe("ready");
    expect(result.items.find((i) => i.id === "staff")?.summary).not.toMatch(/0 位/);
  });

  it("empty source means needs attention, not completed", () => {
    const sources = fixtures();
    if (sources.clients.status === "available") sources.clients.data = { ...sources.clients.data, clients: [] };
    if (sources.roster.status === "available") sources.roster.data = { ...sources.roster.data, status: "empty", assignments: [] };
    const result = project(sources);
    expect(result.items.find((i) => i.id === "clients")?.status).toBe("needs_attention");
    expect(result.items.find((i) => i.id === "roster")?.summary).toContain("尚無此日期");
  });

  it("does not treat an active row without an admission date as service-ready", () => {
    const sources = fixtures();
    if (sources.clients.status === "available") sources.clients.data = { ...sources.clients.data,
      clients: sources.clients.data.clients.map((c) => ({ ...c, admittedOn: null })) };
    const result = project(sources);
    expect(result.items.find((i) => i.id === "clients")?.status).toBe("needs_attention");
    expect(result.items.find((i) => i.id === "clients")?.href.endsWith("operations/client-transitions")).toBe(true);
  });

  it("requires supervisor roster, expected date, and complete fresh source scope", () => {
    const sources = fixtures();
    if (sources.institution.status === "available") sources.institution.data.branchId = "other-branch";
    if (sources.staff.status === "available") sources.staff.data.employeesTruncated = true;
    if (sources.clients.status === "available") sources.clients.data.generatedAt = "2026-09-12T01:00:00Z";
    if (sources.roster.status === "available") sources.roster.data.manager = false;
    const result = project(sources);
    for (const id of ["institution", "staff", "clients", "roster"]) expect(result.items.find((i) => i.id === id)?.status).toBe("unavailable");
  });

  it("does not approve expired institution permits", () => {
    const sources = fixtures();
    if (sources.institution.status === "available") sources.institution.data = { ...sources.institution.data,
      versions: sources.institution.data.versions.map((v) => ({ ...v, permitValidThrough: "2026-09-12" })) };
    expect(project(sources).items.find((i) => i.id === "institution")?.status).toBe("needs_attention");
  });

  it("deduplicates clients across shifts but retains the count of assignments", () => {
    const sources = fixtures();
    if (sources.staff.status === "available" && sources.roster.status === "available") {
      const staffId = sources.staff.data.employees.find((s) => s.profileIsActive && s.membershipStatus === "active")!.profileId;
      sources.roster.data.assignments = sources.roster.data.assignments.map((r) => ({ ...r, staffUserId: staffId }));
    }
    const item = project(sources).items.find((i) => i.id === "roster")!;
    expect(item.summary).toContain("2 位個案、4 個班次");
    expect(item.status).toBe("ready");
  });
  it("separates ineligible legacy assignments from active client and shift counts", () => {
    const sources = fixtures();
    if (sources.roster.status === "available") sources.roster.data.assignments = sources.roster.data.assignments.map((row) =>
      ({ ...row, isServiceEligible: false, serviceEligibility: "not_admitted" }));
    const item = project(sources).items.find((i) => i.id === "roster")!;
    expect(item.status).toBe("needs_attention");
    expect(item.summary).toContain("尚無此日期的照顧安排");
    expect(item.summary).toContain("另有 4 個未正式收案或不在服務期間的既有分工");
    expect(item.summary).not.toContain("2 位個案、4 個班次");
  });

  it("never turns external or unverified clinical proof into a completed check", () => {
    const result = project();
    for (const id of ["contacts", "care_basis", "data_safety", "recovery"]) expect(result.items.find((i) => i.id === id)?.status).toBe("manual_review");
    expect(result.status).not.toBe("ready");
  });

  it("preserves supported date parameters and links to existing catalog entrances only", () => {
    const result = project();
    for (const item of result.items) {
      const url = new URL(item.href, "https://example.invalid");
      expect(getPageBySlug(url.pathname.replace(/^\/app\//, ""))).toBeDefined();
      expect(url.searchParams.has("branch")).toBe(false);
    }
    expect(result.items.find((i) => i.id === "roster")?.href).toContain(`date=${serviceDate}`);
    expect(result.items.find((i) => i.id === "institution")?.href).toContain(`effectiveOn=${serviceDate}`);
  });
  it("rejects invalid date, never silently switches the checklist to another date", () => {
    expect(() => project(fixtures(), context, "2026-02-30")).toThrow("INVALID_SERVICE_DATE");
  });
  it("does not build synthetic source for a production context", () => {
    expect(() => buildDemoOpeningReadinessSources({ ...context, demo: false }, serviceDate)).toThrow("OPENING_READINESS_DEMO_ONLY");
  });
});
