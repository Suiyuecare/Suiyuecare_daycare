import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { withServerReadDeadline } from "@/lib/api/server-read-deadline";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { getQuestionnaireForm } from "./forms";
import { parseQuestionnaireSnapshot } from "./contract";
import type { QuestionnaireFormKey, QuestionnaireSnapshot } from "./types";

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
