import "server-only";

import { z } from "zod";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { getQuestionnaireForm } from "./forms";
import { FULL_MNA_SOURCE_SHA256, FULL_MNA_SOURCE_URL, FULL_MNA_VERSION } from "@/lib/assessments/full-mna";
import type { QuestionnaireFormKey, QuestionnaireSelection, QuestionnaireSnapshot } from "./types";

const answerSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("answered"), value: z.string() }).strict(),
  z.object({ state: z.literal("missing") }).strict(),
  z.object({ state: z.literal("not_applicable"), reason: z.string() }).strict(),
]);

const snapshotSchema = z.object({
  formKey: z.enum(["spmsq", "gds_15", "barthel_adl", "lawton_iadl", "eat10_swallowing", "bsrs5", "fall_risk_taipei_115", "nsi_determine", "mna_sf", "full_mna"]),
  generatedAt: z.string().datetime({ offset: true }),
  matchingTotal: z.number().int().nonnegative(),
  clients: z.array(z.object({
    clientId: z.string().uuid(),
    displayName: z.string(),
    serviceStatus: z.enum(["pending", "active", "suspended"]),
    latest: z.object({
      assessmentKey: z.string().uuid(),
      versionId: z.string().uuid(),
      version: z.number().int().positive(),
      formVersion: z.string(),
      assessedOn: z.string(),
      answers: z.record(z.string(), answerSchema),
      context: z.record(z.string(), z.string()),
      recordState: z.enum(["draft", "submitted", "signed"]),
      authorDisplayName: z.string(),
      createdAt: z.string().datetime({ offset: true }),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
      isLatest: z.boolean(),
      correctionOfVersionId: z.string().uuid().nullable(),
      changeReason: z.string().nullable(), followUpDueOn: z.iso.date().nullable(),
      signedAt: z.iso.datetime({ offset: true }).nullable(), signerDisplayName: z.string().nullable(),
      ruleAvailable: z.boolean(),
      formSnapshot: z.object({ key: z.enum(["spmsq", "gds_15", "barthel_adl", "lawton_iadl", "eat10_swallowing", "bsrs5", "fall_risk_taipei_115", "nsi_determine", "mna_sf", "full_mna"]),
        version: z.string(), title: z.string(), instructions: z.string(), sourceLabel: z.string(), sourceUrl: z.string().optional(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
        scoreVersionId: z.string().optional(), allowQualitativeNotes: z.boolean().optional(),
        contextFields: z.array(z.object({ key: z.string(), label: z.string(), required: z.boolean().optional(), questionId: z.string().optional(),
          choices: z.array(z.object({ value: z.string(), label: z.string() }).strict()) }).strict()).optional(),
        measurementFields: z.array(z.object({ key: z.string(), label: z.string(), questionId: z.string().optional() }).strict()).optional(),
        questions: z.array(z.object({ id: z.string(), prompt: z.string(), helpText: z.string().optional(),
          choices: z.array(z.object({ value: z.string(), label: z.string(), score: z.number().optional() }).passthrough()) }).passthrough()),
      }).strict(),
      resultSnapshot: z.object({ status: z.enum(["complete", "incomplete"]), raw: z.number().nullable(),
        adjusted: z.number().nullable(), classification: z.object({ label: z.string() }).passthrough().nullable(),
        unit: z.string(), incompleteCount: z.number().int().nonnegative() }).strict().nullable(),
    }).strict().nullable(),
  }).strict()),
  history: z.array(z.object({ assessmentKey: z.string().uuid(), versionId: z.string().uuid(),
    version: z.number().int().positive(), assessedOn: z.iso.date(), recordState: z.enum(["draft", "submitted", "signed"]),
    authorDisplayName: z.string(), followUpDueOn: z.iso.date().nullable(), signedAt: z.iso.datetime({ offset: true }).nullable(),
    correctionOfVersionId: z.string().uuid().nullable(), versions: z.array(z.object({ versionId: z.string().uuid(),
      version: z.number().int().positive(), recordState: z.enum(["draft", "submitted", "signed"]), createdAt: z.iso.datetime({ offset: true }) }).strict()),
  }).strict()).max(10),
  historyTotal: z.number().int().nonnegative(), historyPage: z.number().int().positive(), canSign: z.boolean(),
  selection: z.object({ versionId: z.string().uuid().nullable(), month: z.string().nullable(), newAssessment: z.boolean() }).strict(),
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
  selection: QuestionnaireSelection = { versionId: null, month: null, newAssessment: false, historyPage: 1 },
): Promise<QuestionnaireSnapshot> {
  if (!getQuestionnaireForm(formKey)) throw new QuestionnaireSnapshotError();
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new QuestionnaireSnapshotError();
  const { data, error } = await supabase.rpc("questionnaire_assessment_workspace_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_form_key: formKey,
    p_client_id: clientId,
    p_version_id: selection.versionId,
    p_month: selection.month ? `${selection.month}-01` : null,
    p_new_assessment: selection.newAssessment,
    p_history_page: selection.historyPage ?? 1,
  });
  const parsed = snapshotSchema.safeParse(data);
  if (error || !parsed.success || parsed.data.formKey !== formKey) {
    throw new QuestionnaireSnapshotError();
  }
  const selectedClient = parsed.data.clients.find((client) => client.clientId === clientId);
  const selected = selectedClient?.latest;
  if (selected?.formSnapshot.key === "full_mna" && selected.formVersion === FULL_MNA_VERSION &&
    (selected.formSnapshot.sourceHash !== FULL_MNA_SOURCE_SHA256 || selected.formSnapshot.sourceUrl !== FULL_MNA_SOURCE_URL)) throw new QuestionnaireSnapshotError();
  if (parsed.data.clients.some((client) => client.serviceStatus === "pending" &&
    client.latest && client.latest.recordState !== "draft") ||
    (selectedClient?.serviceStatus === "pending" && (parsed.data.canSign ||
      parsed.data.history.some((episode) => episode.recordState !== "draft" ||
        episode.versions.some((version) => version.recordState !== "draft"))))) throw new QuestionnaireSnapshotError();
  if (selected && (selected.formSnapshot.key !== formKey || selected.formSnapshot.version !== selected.formVersion ||
    Object.keys(selected.answers).length !== selected.formSnapshot.questions.length ||
    selected.formSnapshot.questions.some((question) => !selected.answers[question.id]))) throw new QuestionnaireSnapshotError();
  return parsed.data as QuestionnaireSnapshot;
}
