import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoInterprofessionalConsultationSnapshot } from "./demo";
import { projectInterprofessionalConsultationSnapshot } from "./projection";
import type { InterprofessionalConsultationFilters } from "./types";

export class InterprofessionalConsultationSnapshotError extends Error {
  constructor() {
    super("INTERPROFESSIONAL_CONSULTATION_SNAPSHOT_UNAVAILABLE");
    this.name = "InterprofessionalConsultationSnapshotError";
  }
}

export async function loadInterprofessionalConsultationSnapshot(
  context: TenantContext,
  filters: InterprofessionalConsultationFilters,
  recentAal2: boolean,
) {
  if (context.demo) return buildDemoInterprofessionalConsultationSnapshot({
    organizationId: context.organizationId, branchId: context.branchId, filters,
  });
  if (
    !context.scopes.includes("clients.read") ||
    !context.scopes.includes("interprofessional_consultations.read")
  ) {
    throw new InterprofessionalConsultationSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new InterprofessionalConsultationSnapshotError();
  const expectedCanCreate = recentAal2 && context.scopes.includes("interprofessional_consultations.create");
  const expectedCanAssign = recentAal2 && context.scopes.includes("interprofessional_consultations.assign");
  const expectedCanRespond = context.scopes.includes("interprofessional_consultations.respond");
  const expectedCanCorrect = recentAal2 && expectedCanRespond;
  const expectedCanClose = recentAal2 && context.scopes.includes("interprofessional_consultations.close");
  try {
    const { data, error } = await supabase.rpc("interprofessional_consultation_snapshot", {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_client_id: filters.clientId,
      p_requester_user_id: filters.requesterUserId,
      p_assignee_mode: filters.assigneeMode,
      p_assignee_user_id: filters.assigneeUserId,
      p_discipline_code: filters.disciplineCode,
      p_urgency: filters.urgency,
      p_status: filters.status,
      p_deadline_filter: filters.deadlineFilter,
      p_due_from: filters.dueFrom,
      p_due_to: filters.dueTo,
      p_query: filters.query || null,
    }).maybeSingle();
    if (error || !data) throw new InterprofessionalConsultationSnapshotError();
    return projectInterprofessionalConsultationSnapshot({
      row: data, expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId, expectedCanCreate, expectedCanAssign,
      expectedCanRespond, expectedCanCorrect, expectedCanClose, demo: false,
    });
  } catch {
    throw new InterprofessionalConsultationSnapshotError();
  }
}
