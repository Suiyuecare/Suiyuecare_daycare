import { roleDisplayName } from "@/lib/domain/roles";
import type { RoleGovernanceRole } from "@/lib/role-governance/types";

/** Only current system templates use the shared taxonomy; custom names stay intact. */
export function currentGovernanceRoleName(role: RoleGovernanceRole | undefined) {
  if (!role) return "未載入角色";
  return role.system ? roleDisplayName(role.roleKey, role.name) : role.name;
}
