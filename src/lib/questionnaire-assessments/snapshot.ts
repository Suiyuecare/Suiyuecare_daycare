import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { withServerReadDeadline } from "@/lib/api/server-read-deadline";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { getQuestionnaireForm } from "./forms";
import { parseQuestionnaireHistoryPage, parseQuestionnaireSnapshot } from "./contract";
import { parseQuestionnaireResumeSummary } from "./resume-summary";
import type { QuestionnaireDraft, QuestionnaireFormKey, QuestionnaireSnapshot } from "./types";

export class QuestionnaireSnapshotError extends Error {
  constructor() {
    super("Questionnaire assessment snapshot is unavailable or invalid.");
    this.name = "QuestionnaireSnapshotError";
  }
}

export async function loadQuestionnaireSnapshot(
  context: TenantContext,
  formKey: QuestionnaireFormKey,
  clientId: string | null,
): Promise<QuestionnaireSnapshot> {
  if (!getQuestionnaireForm(formKey)) throw new QuestionnaireSnapshotError();
  try {
    return await withServerReadDeadline(async (signal) => {
      const supabase = await createServerSupabaseClient();
      if (!supabase || signal.aborted) throw new QuestionnaireSnapshotError();
      const { data, error } = await supabase.rpc("questionnaire_assessment_snapshot", {
        p_expected_organization_id: context.organizationId,
        p_expected_branch_id: context.branchId,
        p_form_key: formKey,
        p_client_id: clientId,
      }).abortSignal(signal);
      if (signal.aborted || error) throw new QuestionnaireSnapshotError();
      return parseQuestionnaireSnapshot(data, formKey, clientId);
    });
  } catch {
    throw new QuestionnaireSnapshotError();
  }
}

/** Read only the requested immutable version, then confirm it is still the
 * newest saved terminal draft across every assessment chain of this form.
 * A stale link never silently opens a different draft. */
export async function loadQuestionnaireResumeDraft(
  context: TenantContext,
  formKey: QuestionnaireFormKey,
  clientId: string,
  assessmentKey: string,
  versionId: string,
): Promise<QuestionnaireDraft | null> {
  if (context.demo || !context.branchId || !getQuestionnaireForm(formKey)) throw new QuestionnaireSnapshotError();
  try {
    return await withServerReadDeadline(async (signal) => {
      const supabase = await createServerSupabaseClient();
      if (!supabase || signal.aborted) throw new QuestionnaireSnapshotError();
      const { data, error } = await supabase.rpc("questionnaire_assessment_history", {
        p_expected_organization_id: context.organizationId,
        p_expected_branch_id: context.branchId,
        p_form_key: formKey,
        p_client_id: clientId,
        p_assessment_key: assessmentKey,
        p_before_version: null,
      }).abortSignal(signal);
      if (signal.aborted || error || !data) throw new QuestionnaireSnapshotError();
      const history = parseQuestionnaireHistoryPage(data, formKey, clientId, assessmentKey);
      const current = history.versions[0];
      if (!current || current.version !== history.total) throw new QuestionnaireSnapshotError();
      if (current.versionId !== versionId) return null;

      // The history RPC only proves this chain's terminal version. A newer
      // independent assessment may have been saved after the entry link was
      // rendered. Recheck that exact version against the selected client's
      // answer-free, currently authorized cross-chain summary before return.
      if (signal.aborted) throw new QuestionnaireSnapshotError();
      const { data: summaryData, error: summaryError } = await supabase.rpc("questionnaire_resume_summary", {
        p_expected_organization_id: context.organizationId,
        p_expected_branch_id: context.branchId,
        p_client_id: clientId,
      }).abortSignal(signal);
      if (signal.aborted || summaryError || !summaryData) throw new QuestionnaireSnapshotError();
      const summary = parseQuestionnaireResumeSummary(summaryData, clientId);
      const form = summary.forms.find((item) => item.formKey === formKey);
      if (!form || !form.latest) throw new QuestionnaireSnapshotError();
      return form.latest.assessmentKey === assessmentKey && form.latest.versionId === versionId
        ? current : null;
    });
  } catch {
    throw new QuestionnaireSnapshotError();
  }
}
