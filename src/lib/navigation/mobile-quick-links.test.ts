import { describe, expect, it } from "vitest";

import { filterNavigationByAccess, staffNavigationGroups, staffPages } from "@/lib/catalog";
import type { TenantContext } from "@/lib/domain/types";

import { getMobileQuickLinks } from "./mobile-quick-links";

function context(roles: TenantContext["roles"], pages: readonly number[], assuranceLevel: TenantContext["assuranceLevel"] = "aal2") {
  const scopes = [...new Set(pages.flatMap((number) =>
    staffPages.find((page) => page.number === number)?.requiredPermissions ?? []))];
  return { roles, scopes, assuranceLevel, demo: false };
}

function labels(actor: ReturnType<typeof context>, showStoreOverview = false) {
  return getMobileQuickLinks(actor, filterNavigationByAccess(staffNavigationGroups, actor), showStoreOverview)
    .map((link) => link.label);
}

describe("mobile role-aware quick links", () => {
  it("puts the care worker's actual work before the long module catalog", () => {
    expect(labels(context(["care_worker"], [46, 3, 6]))).toEqual(["今日", "出勤", "量測"]);
  });

  it("does not promote AAL2-only billing to an AAL1 finance shortcut", () => {
    expect(labels(context(["finance_claims"], [49, 64, 70], "aal1"))).toEqual(["今日", "申報", "報表"]);
    expect(labels(context(["finance_claims"], [49, 64, 70]))).toEqual(["今日", "申報", "帳務"]);
  });

  it("does not lead an AAL1 nurse into an assessment that fails its read gate", () => {
    expect(labels(context(["nurse"], [51, 3, 7], "aal1"))).toEqual(["今日", "量測", "用藥"]);
    expect(labels(context(["nurse"], [51, 3, 7]))).toEqual(["今日", "護理", "量測"]);
  });

  it("uses readable governance pages while an AAL1 maintainer cannot load audit data", () => {
    expect(labels(context(["platform_ops"], [83, 81, 82], "aal1"))).toEqual(["權限", "規則", "今日"]);
  });

  it("shows the store overview only when the server explicitly permits it", () => {
    const actor = context(["organization_manager"], [70, 54]);
    expect(labels(actor, true)).toEqual(["今日", "店務", "報表"]);
    expect(labels(actor)).toEqual(["今日", "報表", "彙整"]);
  });

  it("uses stable role priority for concurrent roles regardless of array order", () => {
    const allowed = [46, 3, 51, 54];
    expect(labels(context(["care_worker", "nurse", "branch_director"], allowed)))
      .toEqual(["今日", "出勤", "彙整"]);
    expect(labels(context(["branch_director", "nurse", "care_worker"], allowed)))
      .toEqual(["今日", "出勤", "彙整"]);
  });

  it("prioritizes transport, professional and maintenance work without role-inapplicable links", () => {
    expect(labels(context(["transport_driver"], [48, 47]))).toEqual(["今日", "接送", "交通"]);
    expect(labels(context(["professional"], [2, 37, 42]))).toEqual(["今日", "個案", "照會"]);
    expect(labels(context(["platform_ops"], [83, 81, 82]))).toEqual(["稽核", "權限", "規則"]);
  });

  it("never uses an ungranted page even if a caller accidentally passes an unfiltered catalog", () => {
    const actor = context(["nurse"], []);
    const links = getMobileQuickLinks(actor, staffNavigationGroups, true);
    expect(links.map((link) => link.label)).toEqual(["今日"]);
    expect(links.every((link) => link.kind === "catalog")).toBe(true);
  });

  it("deduplicates and uses a relevant case-center fallback when available", () => {
    expect(labels(context(["care_worker"], [46]))).toEqual(["今日", "出勤", "個案"]);
    expect(labels(context(["care_worker"], []))).toEqual(["今日"]);
  });
});
