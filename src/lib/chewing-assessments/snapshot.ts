import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoChewingAssessmentSnapshot } from "./demo";
import {
  filterDemoChewingAssessmentSnapshot,
  projectChewingAssessmentSnapshot,
  type ChewingAssessmentSnapshotSourceRow,
} from "./projection";
import type { ChewingAssessmentFilters } from "./types";

export class ChewingAssessmentSnapshotError extends Error {
  constructor() {
    super("CHEWING_ASSESSMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "ChewingAssessmentSnapshotError";
  }
}

export async function loadChewingAssessmentSnapshot(
  context: TenantContext,
  filters: ChewingAssessmentFilters,
) {
  if (context.demo) {
    return filterDemoChewingAssessmentSnapshot(
      buildDemoChewingAssessmentSnapshot(),
      filters,
    );
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new ChewingAssessmentSnapshotError();
  const { data, error } = await supabase.rpc("chewing_assessment_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_client_id: filters.clientId,
    p_preview_filter: filters.previewStatus,
    p_answer_filter: filters.answerState,
  }).maybeSingle<ChewingAssessmentSnapshotSourceRow>();
  if (error || !data) throw new ChewingAssessmentSnapshotError();
  try {
    return projectChewingAssessmentSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new ChewingAssessmentSnapshotError();
  }
}
