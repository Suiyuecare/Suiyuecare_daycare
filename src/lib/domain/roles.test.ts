import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_CATEGORIES, directorConcurrentRoleKeys, roleDisplayName, roleScopeLabel } from "./roles";

describe("eleven user-approved standard role categories", () => {
  it("keeps the exact eleven categories in the user's order", () => {
    expect(DEFAULT_ROLE_CATEGORIES.map((role) => role.label)).toEqual([
      "全機構管理員（多點管理）", "機構管理員（單點管理）", "機構主任", "護理人員", "社工人員",
      "照顧服務員", "駕駛人員", "專業人員", "財務人員", "系統維護人員", "家屬／關係人",
    ]);
    expect(new Set(DEFAULT_ROLE_CATEGORIES.map((role) => role.key)).size).toBe(11);
  });
  it("preserves all ten historical system keys and adds only director", () => {
    expect(DEFAULT_ROLE_CATEGORIES.map((role) => role.key).sort()).toEqual([
      "organization_manager", "branch_supervisor", "branch_director", "nurse", "case_manager_social_worker",
      "care_worker", "transport_driver", "professional", "finance_claims", "platform_ops", "family",
    ].sort());
  });
  it("separates multi-site, single-site and consent scopes without conferring permissions", () => {
    expect(roleScopeLabel("organization_manager")).toBe("授權機構內・多點");
    expect(roleScopeLabel("branch_supervisor")).toBe("指定據點");
    expect(roleScopeLabel("branch_director")).toBe("指定據點");
    expect(roleScopeLabel("family")).toBe("個案同意授權");
    expect(DEFAULT_ROLE_CATEGORIES.every((role) => !("permissions" in role))).toBe(true);
  });
  it("retains unknown custom names and never silently maps one into a standard role", () => {
    expect(roleDisplayName("activity_lead", "活動帶領人")).toBe("活動帶領人");
    expect(roleDisplayName("unknown")).toBe("未辨識角色");
    expect(roleScopeLabel("activity_lead")).toBe("依個別核准範圍");
  });
  it("describes director co-roles as separate approvals, not automatic nursing or social authority", () => {
    expect(directorConcurrentRoleKeys).toEqual(["nurse", "case_manager_social_worker"]);
    const director = DEFAULT_ROLE_CATEGORIES.find((role) => role.key === "branch_director")!;
    expect(director.summary).toContain("另外核准");
    expect(director.summary).toContain("資格");
  });
});
