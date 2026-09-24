import { describe, expect, it } from "vitest";

import { currentGovernanceRoleName } from "./role-labels";

const role = {
  id: "10000000-0000-4000-8000-000000000002",
  roleKey: "organization_manager",
  name: "機構管理員",
  description: null,
  system: true,
  active: true,
  permissionKeys: ["roles.manage"],
};

describe("current governance role labels", () => {
  it("uses the new name only for a known current system template", () => {
    expect(currentGovernanceRoleName(role)).toBe("全機構管理員（多點管理）");
    expect(role.name).toBe("機構管理員");
    expect(role.permissionKeys).toEqual(["roles.manage"]);
  });

  it("preserves custom names even when their keys match a system template", () => {
    expect(currentGovernanceRoleName({ ...role, system: false, name: "自訂管理職" }))
      .toBe("自訂管理職");
  });

  it("preserves unknown template names and reports unavailable roles", () => {
    expect(currentGovernanceRoleName({ ...role, roleKey: "future_template", name: "未來職務" }))
      .toBe("未來職務");
    expect(currentGovernanceRoleName(undefined)).toBe("未載入角色");
  });
});
