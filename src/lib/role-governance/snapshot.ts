import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoRoleGovernanceSnapshot } from "./demo";
import {
  projectRoleGovernanceSnapshot,
  type RoleGovernanceSnapshotSourceRow,
} from "./projection";

export class RoleGovernanceSnapshotError extends Error {
  constructor() {
    super("ROLE_GOVERNANCE_SNAPSHOT_UNAVAILABLE");
    this.name = "RoleGovernanceSnapshotError";
  }
}

export async function loadRoleGovernanceSnapshot(context: TenantContext) {
  if (context.demo) return buildDemoRoleGovernanceSnapshot();
  if (!context.scopes.includes("roles.manage")) {
    throw new RoleGovernanceSnapshotError();
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new RoleGovernanceSnapshotError();
  const { data, error } = await supabase
    .rpc("role_governance_snapshot", {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
    })
    .maybeSingle<RoleGovernanceSnapshotSourceRow>();
  if (error || !data) throw new RoleGovernanceSnapshotError();

  try {
    return projectRoleGovernanceSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new RoleGovernanceSnapshotError();
  }
}
