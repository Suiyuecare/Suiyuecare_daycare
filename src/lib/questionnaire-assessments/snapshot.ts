import "server-only";

import { z } from "zod";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { getQuestionnaireForm } from "./forms";
import type { QuestionnaireFormKey, QuestionnaireSnapshot } from "./types";

const answerSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("answered"), value: z.string() }).strict(),
  z.object({ state: z.literal("missing") }).strict(),
  z.object({ state: z.literal("not_applicable"), reason: z.string() }).strict(),
]);

const snapshotSchema = z.object({
  formKey: z.enum(["spmsq", "gds_15", "barthel_adl", "lawton_iadl", "eat10_swallowing", "bsrs5", "fall_risk_taipei_115", "nsi_determine", "mna_sf"]),
  generatedAt: z.string().datetime({ offset: true }),
  matchingTotal: z.number().int().nonnegative(),
  clients: z.array(z.object({
    clientId: z.string().uuid(),
    displayName: z.string(),
    serviceStatus: z.enum(["active", "suspended"]),
    latest: z.object({
      assessmentKey: z.string().uuid(),
      versionId: z.string().uuid(),
      version: z.number().int().positive(),
      formVersion: z.string(),
      assessedOn: z.string(),
      answers: z.record(z.string(), answerSchema),
      context: z.record(z.string(), z.string()),
      recordState: z.literal("draft"),
      authorDisplayName: z.string(),
      createdAt: z.string().datetime({ offset: true }),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    }).strict().nullable(),
  }).strict()),
}).strict();

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
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new QuestionnaireSnapshotError();
  const { data, error } = await supabase.rpc("questionnaire_assessment_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_form_key: formKey,
    p_client_id: clientId,
  });
  const parsed = snapshotSchema.safeParse(data);
  if (error || !parsed.success || parsed.data.formKey !== formKey) {
    throw new QuestionnaireSnapshotError();
  }
  return parsed.data;
}
