export const ROLE_GOVERNANCE_OPERATIONS = [
  "create_role",
  "grant_permission",
  "revoke_permission",
  "assign_role",
  "revoke_role",
  "deactivate_role",
] as const;

export type RoleGovernanceOperation =
  (typeof ROLE_GOVERNANCE_OPERATIONS)[number];

export const PROFILE_KINDS = [
  "platform",
  "staff",
  "professional",
  "driver",
  "finance",
  "family",
] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

export const MEMBERSHIP_STATUSES = [
  "invited",
  "active",
  "suspended",
  "ended",
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export type RoleGovernanceRole = {
  id: string;
  roleKey: string;
  name: string;
  description: string | null;
  system: boolean;
  active: boolean;
  permissionKeys: string[];
};

export type RoleGovernancePermission = {
  key: string;
  description: string;
  riskLevel: 0 | 1 | 2 | 3;
};

export type RoleGovernanceMembership = {
  id: string;
  branchId: string | null;
  displayName: string;
  profileKind: ProfileKind;
  status: MembershipStatus;
  startsAt: string;
  endsAt: string | null;
  currentActor: boolean;
  roleIds: string[];
};

export type RoleGovernanceRequestStatus = "pending" | "approved";

export type RoleGovernanceRequest = {
  id: string;
  operation: RoleGovernanceOperation;
  targetRoleId: string;
  targetMembershipId: string | null;
  targetPermissionKey: string | null;
  roleKey: string | null;
  roleName: string | null;
  roleDescription: string | null;
  status: RoleGovernanceRequestStatus;
  requestedAt: string;
  requestedByCurrentActor: boolean;
  requesterLabel: string;
  approvedAt: string | null;
  approvedByCurrentActor: boolean;
  approverLabel: string | null;
  appliedAt: string | null;
};

export type RoleGovernanceSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  roles: RoleGovernanceRole[];
  permissions: RoleGovernancePermission[];
  memberships: RoleGovernanceMembership[];
  requests: RoleGovernanceRequest[];
  requestTotal: number;
  pendingTotal: number;
  requestsTruncated: boolean;
  demo: boolean;
};

export type CreateRoleRequestInput = {
  operation: "create_role";
  roleKey: string;
  roleName: string;
  roleDescription: string | null;
  idempotencyKey: string;
};

export type PermissionRoleRequestInput = {
  operation: "grant_permission" | "revoke_permission";
  targetRoleId: string;
  permissionKey: string;
  idempotencyKey: string;
};

export type MembershipRoleRequestInput = {
  operation: "assign_role" | "revoke_role";
  targetRoleId: string;
  targetMembershipId: string;
  idempotencyKey: string;
};

export type DeactivateRoleRequestInput = {
  operation: "deactivate_role";
  targetRoleId: string;
  idempotencyKey: string;
};

export type RoleGovernanceRequestInput =
  | CreateRoleRequestInput
  | PermissionRoleRequestInput
  | MembershipRoleRequestInput
  | DeactivateRoleRequestInput;

export type RoleGovernanceRequestPayload =
  RoleGovernanceRequestInput extends infer TInput
    ? TInput extends RoleGovernanceRequestInput
      ? Omit<TInput, "idempotencyKey">
      : never
    : never;

export type RoleGovernanceApprovalInput = {
  requestId: string;
  idempotencyKey: string;
};

export type RoleGovernanceRequestResult = {
  requestId: string;
  status: RoleGovernanceRequestStatus;
  replayed: boolean;
};

export type RoleGovernanceApprovalResult = {
  requestId: string;
  status: "approved";
  appliedAt: string;
  replayed: boolean;
};

export type RoleGovernanceRequestApiData = {
  governanceRequest: {
    id: string;
    operation: RoleGovernanceOperation;
    targetRoleId: string;
    targetMembershipId: string | null;
    targetPermissionKey: string | null;
    roleKey: string | null;
    roleName: string | null;
    roleDescription: string | null;
    status: RoleGovernanceRequestStatus;
  };
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type RoleGovernanceApprovalApiData = {
  governanceRequest: {
    id: string;
    status: "approved";
    appliedAt: string;
  };
  replayed: boolean;
  persisted: true;
  demo: false;
};
