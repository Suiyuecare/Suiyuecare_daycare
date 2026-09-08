import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoFeedbackComplaintSnapshot } from "./demo";
import {
  projectFeedbackComplaintSnapshot,
  type FeedbackComplaintSnapshotSourceRow,
} from "./projection";
import type { FeedbackComplaintFilters } from "./types";

export class FeedbackComplaintSnapshotError extends Error {
  constructor() {
    super("FEEDBACK_COMPLAINT_SNAPSHOT_UNAVAILABLE");
    this.name = "FeedbackComplaintSnapshotError";
  }
}

export async function loadFeedbackComplaintSnapshot(
  context: TenantContext,
  filters: FeedbackComplaintFilters,
) {
  if (context.demo) return buildDemoFeedbackComplaintSnapshot(filters);
  if (!context.scopes.includes("complaints.read")) {
    throw new FeedbackComplaintSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new FeedbackComplaintSnapshotError();
  const { data, error } = await supabase.rpc("feedback_complaint_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_received_from: filters.receivedFrom,
    p_received_to: filters.receivedTo,
    p_source: filters.source,
    p_case_type: filters.caseType,
    p_risk: filters.risk,
    p_assignee: filters.assignee,
    p_status: filters.status,
    p_query: filters.query || null,
  }).maybeSingle<FeedbackComplaintSnapshotSourceRow>();
  if (error || !data) throw new FeedbackComplaintSnapshotError();
  try {
    return projectFeedbackComplaintSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      filters,
      demo: false,
    });
  } catch {
    throw new FeedbackComplaintSnapshotError();
  }
}
