import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoFormGovernanceSnapshot } from "./demo";
import {
  projectFormGovernanceSnapshot,
  type FormGovernanceSnapshotSourceRow,
} from "./projection";

export class FormGovernanceSnapshotError extends Error {
  constructor() {
    super("FORM_GOVERNANCE_SNAPSHOT_UNAVAILABLE");
    this.name = "FormGovernanceSnapshotError";
  }
}

function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function loadFormGovernanceSnapshot(context: TenantContext) {
  if (context.demo) return buildDemoFormGovernanceSnapshot();
  if (!context.scopes.includes("forms.manage")) {
    throw new FormGovernanceSnapshotError();
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new FormGovernanceSnapshotError();
  const { data, error } = await supabase
    .rpc("form_governance_snapshot_v2", {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
    })
    .maybeSingle<FormGovernanceSnapshotSourceRow>();
  if (error || !data) throw new FormGovernanceSnapshotError();

  try {
    if (
      data.organization_id.toLowerCase() !== context.organizationId.toLowerCase() ||
      data.branch_id.toLowerCase() !== context.branchId.toLowerCase()
    ) {
      throw new Error("FORM_GOVERNANCE_SCOPE_MISMATCH");
    }
    if (data.versions.some(row => !Number.isSafeInteger(row.draft_revision) || row.draft_revision! < 1 || typeof row.custom_builder_eligible !== "boolean")
      || data.publications.some(row => !row.branch_id || !row.branch_name || row.base_revision === undefined
        || row.previous_request_id === undefined || row.decision_reason === undefined || row.decided_at === undefined
        || typeof row.decided_by_current_user !== "boolean")) throw new Error("FORM_GOVERNANCE_V2_INCOMPLETE");
    const generatedAt = new Date(data.generated_at);
    if (!Number.isFinite(generatedAt.getTime())) {
      throw new Error("FORM_GOVERNANCE_TIME_INVALID");
    }
    return projectFormGovernanceSnapshot({
      definitionRows: data.definitions,
      versionRows: data.versions,
      publicationRows: data.publications,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      today: taipeiDate(generatedAt),
      generatedAt: generatedAt.toISOString(),
      definitionTotal: data.definition_total,
      versionTotal: data.version_total,
      publicationTotal: data.publication_total,
      pendingTotal: data.pending_total,
      definitionsTruncated: data.definitions_truncated,
      versionsTruncated: data.versions_truncated,
      publicationsTruncated: data.publications_truncated,
      demo: false,
    });
  } catch {
    throw new FormGovernanceSnapshotError();
  }
}
