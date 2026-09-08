import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoCaseConferenceSnapshot } from "./demo";
import { projectCaseConferenceSnapshot } from "./projection";
import type { CaseConferenceFilters } from "./types";

export class CaseConferenceSnapshotError extends Error {
  constructor() {
    super("CASE_CONFERENCE_SNAPSHOT_UNAVAILABLE");
    this.name = "CaseConferenceSnapshotError";
  }
}

export async function loadCaseConferenceSnapshot(
  context: TenantContext,
  filters: CaseConferenceFilters,
  recentAal2: boolean,
) {
  if (context.demo) return buildDemoCaseConferenceSnapshot({
    organizationId: context.organizationId,
    branchId: context.branchId,
    filters,
  });
  if (!context.scopes.includes("clients.read") ||
      !context.scopes.includes("case_conferences.read")) {
    throw new CaseConferenceSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new CaseConferenceSnapshotError();
  const expectedCanManage = context.scopes.includes("case_conferences.manage");
  const expectedCanSign = recentAal2 && context.scopes.includes("case_conferences.sign");
  const expectedCanCorrect = expectedCanManage && expectedCanSign;
  try {
    const { data, error } = await supabase.rpc("case_conference_snapshot", {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_client_id: filters.clientId,
      p_status: filters.status,
      p_responsible_user_id: filters.responsibleUserId,
      p_action_status: filters.actionStatus,
      p_meeting_from: filters.meetingFrom,
      p_meeting_to: filters.meetingTo,
      p_query: filters.query || null,
    }).maybeSingle();
    if (error || !data) throw new CaseConferenceSnapshotError();
    return projectCaseConferenceSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      expectedCanManage,
      expectedCanSign,
      expectedCanCorrect,
      demo: false,
    });
  } catch {
    throw new CaseConferenceSnapshotError();
  }
}
