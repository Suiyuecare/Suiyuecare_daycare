import { describe, expect, it } from "vitest";

import {
  parseRoleGovernanceApprovalSuccessEnvelope,
  parseRoleGovernanceRequest,
  parseRoleGovernanceRequestSuccessEnvelope,
  roleGovernanceErrorMessage,
} from "./parser";
import {
  projectRoleGovernanceSnapshot,
  type RoleGovernanceSnapshotSourceRow,
} from "./projection";

const organizationId = "81000000-0000-4000-8000-000000000001";
const branchId = "81000000-0000-4000-8000-000000000002";
const roleId = "81000000-0000-4000-8000-000000000003";
const memberId = "81000000-0000-4000-8000-000000000004";
const requestId = "81000000-0000-4000-8000-000000000005";
const generatedAt = "2026-09-01T09:00:00.000Z";

function validRow(): RoleGovernanceSnapshotSourceRow {
  return {
    organization_id: organizationId,
    branch_id: branchId,
    generated_at: generatedAt,
    roles: [
      {
        id: roleId,
        organization_id: organizationId,
        role_key: "activity_lead",
        name: "活動帶領人",
        description: null,
        is_system: false,
        is_active: true,
        permission_keys: ["health.read"],
      },
      {
        id: "10000000-0000-4000-8000-000000000010",
        organization_id: null,
        role_key: "family",
        name: "家屬",
        description: null,
        is_system: true,
        is_active: true,
        permission_keys: [],
      },
    ],
    permissions: [
      {
        permission_key: "health.read",
        description: "讀取健康資料",
        risk_level: 2,
      },
      {
        permission_key: "roles.manage",
        description: "角色治理",
        risk_level: 3,
      },
    ],
    memberships: [
      {
        id: memberId,
        organization_id: organizationId,
        branch_id: branchId,
        display_name: "王照服員",
        profile_kind: "staff",
        status: "active",
        starts_at: "2026-01-01T00:00:00.000Z",
        ends_at: null,
        current_actor: false,
        role_ids: [],
      },
    ],
    requests: [
      {
        id: requestId,
        organization_id: organizationId,
        branch_id: branchId,
        operation: "assign_role",
        target_role_id: roleId,
        target_membership_id: memberId,
        target_permission_key: null,
        role_key: null,
        role_name: null,
        role_description: null,
        status: "pending",
        requested_at: "2026-09-01T08:00:00.000Z",
        requested_by_current_actor: false,
        requester_label: "另一位授權人員",
        approved_at: null,
        approved_by_current_actor: false,
        approver_label: null,
        applied_at: null,
      },
    ],
    request_total: 1,
    pending_total: 1,
    requests_truncated: false,
  };
}

function project(row: unknown = validRow()) {
  return projectRoleGovernanceSnapshot({
    row,
    expectedOrganizationId: organizationId,
    expectedBranchId: branchId,
    demo: false,
  });
}

describe("role governance projection", () => {
  it("projects a tenant-scoped snapshot without evidence identifiers", () => {
    const snapshot = project();
    expect(snapshot.roles).toHaveLength(2);
    expect(snapshot.pendingTotal).toBe(1);
    expect(snapshot.requests[0]).toMatchObject({
      operation: "assign_role",
      requestedByCurrentActor: false,
    });
    expect(JSON.stringify(snapshot)).not.toContain("challenge");
    expect(JSON.stringify(snapshot)).not.toContain("request_hash");
  });

  it("fails closed for a mismatched tenant or branch", () => {
    const wrongTenant = validRow();
    wrongTenant.organization_id = "81000000-0000-4000-8000-000000000099";
    expect(() => project(wrongTenant)).toThrow("INVALID_ROLE_GOVERNANCE_PROJECTION");
    const wrongBranch = validRow();
    wrongBranch.memberships[0]!.branch_id = "81000000-0000-4000-8000-000000000098";
    expect(() => project(wrongBranch)).toThrow("INVALID_ROLE_GOVERNANCE_PROJECTION");
  });

  it("fails closed for missing role-permission relationships", () => {
    const row = validRow();
    row.roles[0]!.permission_keys = ["unknown.read"];
    expect(() => project(row)).toThrow("INVALID_ROLE_GOVERNANCE_PROJECTION");
  });

  it("fails closed for profile-kind and role audience mismatches", () => {
    const row = validRow();
    row.memberships[0]!.profile_kind = "family";
    row.memberships[0]!.role_ids = [roleId];
    expect(() => project(row)).toThrow("INVALID_ROLE_GOVERNANCE_PROJECTION");
  });

  it("fails closed for request relationship or approval evidence mismatches", () => {
    const missingMember = validRow();
    missingMember.requests[0]!.target_membership_id = "81000000-0000-4000-8000-000000000097";
    expect(() => project(missingMember)).toThrow("INVALID_ROLE_GOVERNANCE_PROJECTION");

    const malformedApproval = validRow();
    malformedApproval.requests[0]!.status = "approved";
    expect(() => project(malformedApproval)).toThrow("INVALID_ROLE_GOVERNANCE_PROJECTION");
  });

  it("requires pending-first, fail-visible truncation metadata", () => {
    const row = validRow();
    row.request_total = 250;
    row.pending_total = 1;
    row.requests_truncated = true;
    expect(project(row).requestsTruncated).toBe(true);

    row.requests_truncated = false;
    expect(() => project(row)).toThrow("INVALID_ROLE_GOVERNANCE_PROJECTION");

    const missingPending = validRow();
    missingPending.requests.push({
      ...missingPending.requests[0]!,
      id: "81000000-0000-4000-8000-000000000096",
      operation: "grant_permission",
      target_membership_id: null,
      target_permission_key: "health.read",
      status: "approved",
      requested_at: "2026-08-01T08:00:00.000Z",
      approved_at: "2026-08-01T09:00:00.000Z",
      approver_label: "第二位授權人員",
      applied_at: "2026-08-01T09:00:00.000Z",
    });
    missingPending.request_total = 250;
    missingPending.pending_total = 2;
    missingPending.requests_truncated = true;
    expect(() => project(missingPending)).toThrow("INVALID_ROLE_GOVERNANCE_PROJECTION");
  });

  it("rejects unexpected source fields", () => {
    expect(() => project({ ...validRow(), leaked_hash: "a".repeat(64) })).toThrow(
      "INVALID_ROLE_GOVERNANCE_PROJECTION",
    );
  });
});

describe("role governance request and response parsers", () => {
  const key = "81000000-0000-4000-8000-000000000006";

  it("does not accept a browser-authored role id for create_role", () => {
    expect(() => parseRoleGovernanceRequest({
      operation: "create_role",
      target_role_id: roleId,
      role_key: "new_role",
      role_name: "新角色",
      role_description: null,
    }, key)).toThrow("角色變更申請欄位格式錯誤");
  });

  it("parses every supported strict operation shape", () => {
    const bodies = [
      { operation: "create_role", role_key: "new_role", role_name: "新角色", role_description: null },
      { operation: "grant_permission", target_role_id: roleId, permission_key: "health.read" },
      { operation: "revoke_permission", target_role_id: roleId, permission_key: "health.read" },
      { operation: "assign_role", target_role_id: roleId, target_membership_id: memberId },
      { operation: "revoke_role", target_role_id: roleId, target_membership_id: memberId },
      { operation: "deactivate_role", target_role_id: roleId },
    ];
    expect(bodies.map((body) => parseRoleGovernanceRequest(body, key).operation)).toEqual([
      "create_role",
      "grant_permission",
      "revoke_permission",
      "assign_role",
      "revoke_role",
      "deactivate_role",
    ]);
  });

  it("strictly correlates request success envelopes", () => {
    const envelope = {
      requestId: "81000000-0000-4000-8000-000000000007",
      status: "ok",
      data: {
        governanceRequest: {
          id: requestId,
          operation: "assign_role",
          targetRoleId: roleId,
          targetMembershipId: memberId,
          targetPermissionKey: null,
          roleKey: null,
          roleName: null,
          roleDescription: null,
          status: "pending",
        },
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    };
    expect(parseRoleGovernanceRequestSuccessEnvelope(envelope, {
      operation: "assign_role",
      targetRoleId: roleId,
      targetMembershipId: memberId,
    }, 201).persisted).toBe(true);
    expect(() => parseRoleGovernanceRequestSuccessEnvelope(
      { ...envelope, extra: true },
      { operation: "assign_role", targetRoleId: roleId, targetMembershipId: memberId },
      201,
    )).toThrow("權限治理結果未完整確認");
    expect(() => parseRoleGovernanceRequestSuccessEnvelope(
      envelope,
      { operation: "assign_role", targetRoleId: roleId, targetMembershipId: key },
      201,
    )).toThrow("權限治理結果未完整確認");
    expect(() => parseRoleGovernanceRequestSuccessEnvelope(
      envelope,
      { operation: "assign_role", targetRoleId: roleId, targetMembershipId: memberId },
      200,
    )).toThrow("權限治理結果未完整確認");
    expect(() => parseRoleGovernanceRequestSuccessEnvelope(
      {
        ...envelope,
        data: { ...envelope.data, persisted: false },
      },
      { operation: "assign_role", targetRoleId: roleId, targetMembershipId: memberId },
      201,
    )).toThrow("權限治理結果未完整確認");
    expect(() => parseRoleGovernanceRequestSuccessEnvelope(
      {
        ...envelope,
        data: { ...envelope.data, demo: true },
      },
      { operation: "assign_role", targetRoleId: roleId, targetMembershipId: memberId },
      201,
    )).toThrow("權限治理結果未完整確認");

    const createEnvelope = {
      ...envelope,
      data: {
        ...envelope.data,
        governanceRequest: {
          ...envelope.data.governanceRequest,
          operation: "create_role",
          targetMembershipId: null,
          roleKey: "new_role",
          roleName: "新角色",
          roleDescription: "正式說明",
        },
      },
    };
    expect(() => parseRoleGovernanceRequestSuccessEnvelope(
      createEnvelope,
      {
        operation: "create_role",
        roleKey: "new_role",
        roleName: "新角色",
        roleDescription: "被竄改的說明",
      },
      201,
    )).toThrow("權限治理結果未完整確認");
  });

  it("strictly correlates approval id and timestamp", () => {
    const envelope = {
      requestId: "81000000-0000-4000-8000-000000000007",
      status: "ok",
      data: {
        governanceRequest: {
          id: requestId,
          status: "approved",
          appliedAt: "2026-09-01T09:30:00+08:00",
        },
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    };
    expect(parseRoleGovernanceApprovalSuccessEnvelope(envelope, requestId, 200)
      .governanceRequest.appliedAt).toBe("2026-09-01T01:30:00.000Z");
    expect(() => parseRoleGovernanceApprovalSuccessEnvelope(envelope, key, 200)).toThrow(
      "權限治理結果未完整確認",
    );
    expect(() => parseRoleGovernanceApprovalSuccessEnvelope(envelope, requestId, 201)).toThrow(
      "權限治理結果未完整確認",
    );
  });

  it("shows only a strictly validated error and request identifier", () => {
    const envelope = {
      requestId: "81000000-0000-4000-8000-000000000008",
      status: "error",
      data: null,
      errors: [{ code: "ROLE_GOVERNANCE_NOT_AUTHORIZED", message: "無法執行。" }],
    };
    expect(roleGovernanceErrorMessage(envelope)).toContain(envelope.requestId);
    expect(roleGovernanceErrorMessage({ ...envelope, requestId: "not-a-uuid" })).toBeNull();
    expect(roleGovernanceErrorMessage({ ...envelope, leaked_hash: "a".repeat(64) })).toBeNull();
  });
});
