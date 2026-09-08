import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  MEMBERSHIP_STATUSES,
  PROFILE_KINDS,
  ROLE_GOVERNANCE_OPERATIONS,
  type ProfileKind,
  type RoleGovernanceMembership,
  type RoleGovernancePermission,
  type RoleGovernanceRequest,
  type RoleGovernanceRole,
  type RoleGovernanceSnapshot,
} from "./types";

const uuidSchema = z.uuid().transform((value) => value.toLowerCase());
const timestampSchema = z.string().refine(
  (value) =>
    isStrictOffsetDateTime(value) &&
    Number.isFinite(new Date(value).getTime()),
  "timestamp",
).transform((value) => new Date(value).toISOString());
const optionalTimestampSchema = timestampSchema.nullable();
const nonEmptyText = (max: number) =>
  z.string().trim().min(1).max(max);
const roleKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/u);
const permissionKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/u);

const roleSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema.nullable(),
  role_key: roleKeySchema,
  name: nonEmptyText(120),
  description: z.string().trim().max(1_000).nullable(),
  is_system: z.boolean(),
  is_active: z.boolean(),
  permission_keys: z.array(permissionKeySchema),
}).strict();

const permissionSchema = z.object({
  permission_key: permissionKeySchema,
  description: nonEmptyText(500),
  risk_level: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
}).strict();

const membershipSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  branch_id: uuidSchema.nullable(),
  display_name: nonEmptyText(120),
  profile_kind: z.enum(PROFILE_KINDS),
  status: z.enum(MEMBERSHIP_STATUSES),
  starts_at: timestampSchema,
  ends_at: optionalTimestampSchema,
  current_actor: z.boolean(),
  role_ids: z.array(uuidSchema),
}).strict();

const requestSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  branch_id: uuidSchema,
  operation: z.enum(ROLE_GOVERNANCE_OPERATIONS),
  target_role_id: uuidSchema,
  target_membership_id: uuidSchema.nullable(),
  target_permission_key: permissionKeySchema.nullable(),
  role_key: roleKeySchema.nullable(),
  role_name: z.string().trim().min(1).max(120).nullable(),
  role_description: z.string().trim().max(1_000).nullable(),
  status: z.enum(["pending", "approved"]),
  requested_at: timestampSchema,
  requested_by_current_actor: z.boolean(),
  requester_label: nonEmptyText(120),
  approved_at: optionalTimestampSchema,
  approved_by_current_actor: z.boolean(),
  approver_label: z.string().trim().min(1).max(120).nullable(),
  applied_at: optionalTimestampSchema,
}).strict();

const nonNegativeInteger = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);

const sourceSchema = z.object({
  organization_id: uuidSchema,
  branch_id: uuidSchema,
  generated_at: timestampSchema,
  roles: z.array(roleSchema),
  permissions: z.array(permissionSchema),
  memberships: z.array(membershipSchema),
  requests: z.array(requestSchema),
  request_total: nonNegativeInteger,
  pending_total: nonNegativeInteger,
  requests_truncated: z.boolean(),
}).strict();

export type RoleGovernanceSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_ROLE_GOVERNANCE_PROJECTION");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

export function profileKindAcceptsRole(
  profileKind: ProfileKind,
  role: Pick<RoleGovernanceRole, "roleKey" | "system">,
) {
  if (profileKind === "family") {
    return role.system && role.roleKey === "family";
  }
  if (profileKind === "platform") {
    return role.system && role.roleKey === "platform_ops";
  }
  return role.roleKey !== "family" && role.roleKey !== "platform_ops";
}

export function projectRoleGovernanceSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): RoleGovernanceSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const expectedOrganizationId = uuidSchema.safeParse(input.expectedOrganizationId);
  const expectedBranchId = uuidSchema.safeParse(input.expectedBranchId);
  if (!parsed.success || !expectedOrganizationId.success || !expectedBranchId.success) {
    invalid();
  }
  const row = parsed.data;
  if (
    row.organization_id !== expectedOrganizationId.data ||
    row.branch_id !== expectedBranchId.data
  ) {
    invalid();
  }

  const permissionKeys = row.permissions.map((permission) => permission.permission_key);
  if (!unique(permissionKeys)) invalid();
  const permissionSet = new Set(permissionKeys);
  const permissions: RoleGovernancePermission[] = row.permissions.map((permission) => ({
    key: permission.permission_key,
    description: permission.description,
    riskLevel: permission.risk_level,
  }));

  const roleIds = row.roles.map((role) => role.id);
  const roleKeys = row.roles.map((role) =>
    `${role.organization_id ?? "system"}:${role.role_key}`,
  );
  if (!unique(roleIds) || !unique(roleKeys)) invalid();
  const roles: RoleGovernanceRole[] = row.roles.map((role) => {
    if (
      role.is_system !== (role.organization_id === null) ||
      (!role.is_system && role.organization_id !== row.organization_id) ||
      !unique(role.permission_keys) ||
      role.permission_keys.some((permissionKey) => !permissionSet.has(permissionKey))
    ) {
      invalid();
    }
    return {
      id: role.id,
      roleKey: role.role_key,
      name: role.name,
      description: role.description,
      system: role.is_system,
      active: role.is_active,
      permissionKeys: role.permission_keys,
    };
  });
  const rolesById = new Map(roles.map((role) => [role.id, role]));

  const membershipIds = row.memberships.map((membership) => membership.id);
  if (!unique(membershipIds)) invalid();
  const memberships: RoleGovernanceMembership[] = row.memberships.map((membership) => {
    if (
      membership.organization_id !== row.organization_id ||
      (membership.branch_id !== null && membership.branch_id !== row.branch_id) ||
      (membership.ends_at !== null && membership.ends_at <= membership.starts_at) ||
      !unique(membership.role_ids)
    ) {
      invalid();
    }
    for (const roleId of membership.role_ids) {
      const role = rolesById.get(roleId);
      if (!role || !profileKindAcceptsRole(membership.profile_kind, role)) invalid();
    }
    return {
      id: membership.id,
      branchId: membership.branch_id,
      displayName: membership.display_name,
      profileKind: membership.profile_kind,
      status: membership.status,
      startsAt: membership.starts_at,
      endsAt: membership.ends_at,
      currentActor: membership.current_actor,
      roleIds: membership.role_ids,
    };
  });
  const membershipsById = new Map(memberships.map((membership) => [membership.id, membership]));

  const requestIds = row.requests.map((request) => request.id);
  if (!unique(requestIds)) invalid();
  let reachedApproved = false;
  let previousRequestedAt: string | null = null;
  let previousStatus: "pending" | "approved" | null = null;
  const requests: RoleGovernanceRequest[] = row.requests.map((request) => {
    if (
      request.organization_id !== row.organization_id ||
      request.branch_id !== row.branch_id ||
      (reachedApproved && request.status === "pending") ||
      (previousStatus === request.status &&
        previousRequestedAt !== null &&
        request.requested_at > previousRequestedAt)
    ) {
      invalid();
    }
    if (request.status === "approved") reachedApproved = true;
    previousStatus = request.status;
    previousRequestedAt = request.requested_at;

    const role = rolesById.get(request.target_role_id);
    const member = request.target_membership_id
      ? membershipsById.get(request.target_membership_id)
      : null;
    const permission = request.target_permission_key
      ? permissionSet.has(request.target_permission_key)
      : false;

    if (request.operation === "create_role") {
      if (
        request.target_membership_id !== null ||
        request.target_permission_key !== null ||
        request.role_key === null ||
        request.role_name === null ||
        (request.status === "pending" && role) ||
        (request.status === "approved" &&
          (!role ||
            role.system ||
            role.roleKey !== request.role_key ||
            role.name !== request.role_name ||
            role.description !== request.role_description))
      ) {
        invalid();
      }
    } else {
      if (
        !role ||
        request.role_key !== null ||
        request.role_name !== null ||
        request.role_description !== null
      ) {
        invalid();
      }
      if (
        request.operation === "grant_permission" ||
        request.operation === "revoke_permission"
      ) {
        if (role.system || request.target_membership_id !== null || !permission) {
          invalid();
        }
      } else if (
        request.operation === "assign_role" ||
        request.operation === "revoke_role"
      ) {
        if (request.target_permission_key !== null || !member) invalid();
        if (
          request.operation === "assign_role" &&
          !profileKindAcceptsRole(member.profileKind, role)
        ) {
          invalid();
        }
      } else if (
        role.system ||
        request.target_membership_id !== null ||
        request.target_permission_key !== null
      ) {
        invalid();
      }
    }

    if (
      (request.status === "pending" &&
        (request.approved_at !== null ||
          request.approver_label !== null ||
          request.approved_by_current_actor ||
          request.applied_at !== null)) ||
      (request.status === "approved" &&
        (request.approved_at === null ||
          request.approver_label === null ||
          request.applied_at === null ||
          (request.requested_by_current_actor && request.approved_by_current_actor)))
    ) {
      invalid();
    }

    return {
      id: request.id,
      operation: request.operation,
      targetRoleId: request.target_role_id,
      targetMembershipId: request.target_membership_id,
      targetPermissionKey: request.target_permission_key,
      roleKey: request.role_key,
      roleName: request.role_name,
      roleDescription: request.role_description,
      status: request.status,
      requestedAt: request.requested_at,
      requestedByCurrentActor: request.requested_by_current_actor,
      requesterLabel: request.requester_label,
      approvedAt: request.approved_at,
      approvedByCurrentActor: request.approved_by_current_actor,
      approverLabel: request.approver_label,
      appliedAt: request.applied_at,
    };
  });

  const loadedPending = requests.filter((request) => request.status === "pending").length;
  if (
    row.request_total < requests.length ||
    row.pending_total > row.request_total ||
    loadedPending !== Math.min(row.pending_total, requests.length) ||
    row.requests_truncated !== (row.request_total > requests.length) ||
    (!row.requests_truncated &&
      (row.request_total !== requests.length || row.pending_total !== loadedPending))
  ) {
    invalid();
  }

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    roles,
    permissions,
    memberships,
    requests,
    requestTotal: row.request_total,
    pendingTotal: row.pending_total,
    requestsTruncated: row.requests_truncated,
    demo: input.demo,
  };
}
