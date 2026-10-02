import "server-only";

import { z } from "zod";

import { withServerReadDeadline } from "@/lib/api/server-read-deadline";
import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { questionnaireFormKeySchema } from "./contract";

const uuid = z.string().uuid().refine((value) => value === value.toLowerCase());
const instant = z.string().datetime({ offset: true });
const latestSchema = z.object({
  assessmentKey: uuid,
  versionId: uuid,
  version: z.number().int().min(1).max(1_000_001),
  assessedOn: z.iso.date(),
  savedAt: instant,
  recordState: z.literal("draft"),
}).strict();
const summarySchema = z.object({
  clientId: uuid,
  generatedAt: instant,
  forms: z.array(z.object({
    formKey: questionnaireFormKeySchema,
    latest: latestSchema.nullable(),
  }).strict()).min(1).max(9),
}).strict();

export type QuestionnaireResumeSummary = z.infer<typeof summarySchema>;

export class QuestionnaireResumeSummaryError extends Error {
  constructor() {
    super("Questionnaire resume summary is unavailable or invalid.");
    this.name = "QuestionnaireResumeSummaryError";
  }
}

export function parseQuestionnaireResumeSummary(value: unknown, clientId: string): QuestionnaireResumeSummary {
  const summary = summarySchema.parse(value);
  if (summary.clientId !== clientId ||
    new Set(summary.forms.map(({ formKey }) => formKey)).size !== summary.forms.length ||
    summary.forms.some(({ latest }) => latest && Date.parse(latest.savedAt) > Date.parse(summary.generatedAt))) {
    throw new QuestionnaireResumeSummaryError();
  }
  return summary;
}

/** One authorized client's answer-free, nine-form resume metadata. Never
 * replace an unavailable read with an empty list or demo clinical data. */
export async function loadQuestionnaireResumeSummary(
  context: TenantContext,
  clientId: string,
): Promise<QuestionnaireResumeSummary> {
  if (context.demo || !context.branchId || !context.scopes.includes("clients.read") ||
    !uuid.safeParse(clientId).success) throw new QuestionnaireResumeSummaryError();
  try {
    return await withServerReadDeadline(async (signal) => {
      const supabase = await createServerSupabaseClient();
      if (!supabase || signal.aborted) throw new QuestionnaireResumeSummaryError();
      const { data, error } = await supabase.rpc("questionnaire_resume_summary", {
        p_expected_organization_id: context.organizationId,
        p_expected_branch_id: context.branchId,
        p_client_id: clientId,
      }).abortSignal(signal);
      if (signal.aborted || error || data === null || data === undefined) throw new QuestionnaireResumeSummaryError();
      return parseQuestionnaireResumeSummary(data, clientId);
    });
  } catch {
    throw new QuestionnaireResumeSummaryError();
  }
}
