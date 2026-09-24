import { describe, expect, it } from "vitest";

import { currentStaffRoleName, staffRoleOptionName } from "./role-labels";

const role = {
  roleId: "10000000-0000-4000-8000-000000000002",
  roleKey: "organization_manager",
  roleName: "機構管理員",
};

describe("staff current role labels", () => {
  it("normalizes verified system options without modifying underlying names or IDs", () => {
    const option = { ...role, isSystem: true };
    expect(staffRoleOptionName(option)).toBe("全機構管理員（多點管理）");
    expect(currentStaffRoleName(role, new Map([[role.roleId, option]])))
      .toBe("全機構管理員（多點管理）");
    expect(role.roleName).toBe("機構管理員");
  });

  it("does not relabel unverified, custom, or key-mismatched employee roles", () => {
    expect(currentStaffRoleName(role, new Map())).toBe("機構管理員");
    const custom = { ...role, isSystem: false, roleName: "自訂行政管理" };
    expect(staffRoleOptionName(custom)).toBe("自訂行政管理");
    expect(currentStaffRoleName(role, new Map([[role.roleId, custom]])))
      .toBe("機構管理員");
    expect(currentStaffRoleName(role, new Map([[role.roleId, {
      ...role, isSystem: true, roleKey: "branch_supervisor",
    }]]))).toBe("機構管理員");
  });
});
