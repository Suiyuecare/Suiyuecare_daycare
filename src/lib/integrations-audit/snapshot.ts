import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoIntegrationsAuditSnapshot } from "./demo";
import {
  projectIntegrationsAuditSnapshot,
  type IntegrationsAuditSnapshotSourceRow,
} from "./projection";
import type { IntegrationsAuditFilters } from "./types";

export class IntegrationsAuditSnapshotError extends Error {
  constructor() {
    super("INTEGRATIONS_AUDIT_SNAPSHOT_UNAVAILABLE");
    this.name = "IntegrationsAuditSnapshotError";
  }
}

export async function loadIntegrationsAuditSnapshot(
  context: TenantContext,
  filters: IntegrationsAuditFilters,
  recentAal2: boolean,
) {
  if (context.demo) {
    return buildDemoIntegrationsAuditSnapshot({
      organizationId: context.organizationId,
      branchId: context.branchId,
      filters,
    });
  }
  if (context.assuranceLevel !== "aal2" || !recentAal2 ||
    !context.scopes.includes("audit.view")) {
    throw new IntegrationsAuditSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new IntegrationsAuditSnapshotError();
  const { data, error } = await supabase.rpc("integrations_audit_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_start_date: filters.startDate,
    p_end_date: filters.endDate,
    p_integration_key: filters.integrationKey,
    p_activity_state: filters.activityState,
    p_audit_action: filters.auditAction,
    p_resource_category: filters.resourceCategory,
    p_actor_user_id: filters.actorUserId,
    p_correlation_id: filters.correlationId,
  }).maybeSingle<IntegrationsAuditSnapshotSourceRow>();
  if (error || !data) throw new IntegrationsAuditSnapshotError();
  try {
    return projectIntegrationsAuditSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      filters,
    });
  } catch {
    throw new IntegrationsAuditSnapshotError();
  }
}
