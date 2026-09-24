import { roleDisplayName } from "@/lib/domain/roles";
import type {
  StaffManagementRole,
  StaffRoleOption,
} from "@/lib/staff-management/types";

export function currentStaffRoleName(
  role: StaffManagementRole,
  systemRoleOptions: ReadonlyMap<string, StaffRoleOption>,
) {
  const option = systemRoleOptions.get(role.roleId);
  return option?.isSystem && option.roleKey === role.roleKey
    ? roleDisplayName(role.roleKey, role.roleName)
    : role.roleName;
}

export function staffRoleOptionName(role: StaffRoleOption) {
  return role.isSystem ? roleDisplayName(role.roleKey, role.roleName) : role.roleName;
}
