import type { TenantContext } from "@/lib/domain/types";
import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import { buildQuestionnaireReadinessCatalogEntry } from "@/lib/questionnaire-assessments/readiness-catalog";
import { buildQuestionnaireReadinessReport } from "@/lib/questionnaire-assessments/readiness-source";
import { buildQuestionnaireRuleCatalogEntry } from "@/lib/questionnaire-assessments/rule-catalog";
import { buildQuestionnaireValidationCatalogEntry } from "@/lib/questionnaire-assessments/validation-catalog";
import type { QuestionnaireAnswer, QuestionnaireAssessment, QuestionnaireDraft, QuestionnaireFormKey, QuestionnaireSnapshot } from "@/lib/questionnaire-assessments/types";

export const ids = {
  organizationId: "1000000a-0000-4000-8000-000000000001", branchId: "2000000b-0000-4000-8000-000000000001",
  userId: "3000000c-0000-4000-8000-000000000001", clientId: "4000000d-0000-4000-8000-000000000001",
  versionId: "5000000e-0000-4000-8000-000000000001", assessmentKey: "6000000f-0000-4000-8000-000000000001",
  otherId: "8000000b-0000-4000-8000-000000000001", requestId: "9000000c-0000-4000-8000-000000000001",
};
export const formKeys = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];
export const context: TenantContext = {
  organizationId: ids.organizationId, organizationName: "合成機構", branchId: ids.branchId, branchName: "合成分支",
  userId: ids.userId, displayName: "合成評估人員", roles: ["nurse"], assuranceLevel: "aal2", recentAal2At: null, demo: false,
  scopes: ["clients.read", ...["cognition", "adl", "swallowing", "emotion", "fall", "nutrition"].flatMap(prefix =>
    [`questionnaire_${prefix}.read`, `questionnaire_${prefix}.manage`])],
};
export function savedFixture(formKey: QuestionnaireFormKey = "spmsq", patch: Partial<QuestionnaireDraft> = {}) {
  const form = QUESTIONNAIRE_FORMS[formKey];
  const answers: Record<string, QuestionnaireAnswer> = Object.fromEntries(form.questions.map(({ id, choices }) =>
    [id, { state: "answered", value: choices[0]!.value }]));
  const fields: Record<string, string> = { qualitative_note: "SYNTHETIC_SAVED_NOTE" };
  if (formKey === "spmsq") fields.education_adjustment = "middle_or_high_school";
  if (formKey === "mna_sf") {
    answers.anthropometry = { state: "answered", value: "bmi_19_lt_21" };
    fields.height_cm = "170"; fields.weight_kg = "60";
  }
  const draft: QuestionnaireAssessment = {
    assessmentKey: ids.assessmentKey, versionId: ids.versionId, version: 1, formVersion: form.version,
    assessedOn: "2026-09-26", answers, context: fields, authorDisplayName: "SYNTHETIC_SAVED_AUTHOR",
    createdAt: "2026-09-26T01:00:00.000Z", contentHash: "a".repeat(64),
    assessmentCreatedAt: "2026-09-26T01:00:00.000Z", ...patch,
  };
  const snapshot: QuestionnaireSnapshot = {
    formKey, generatedAt: new Date(Date.now()).toISOString(), matchingTotal: 1, demo: false,
    clients: [{ clientId: ids.clientId, displayName: "SYNTHETIC_CLIENT_NAME", serviceStatus: "active",
      latest: draft, assessments: [draft], assessmentTotal: 1, nextAssessmentCursor: null }],
  };
  return { form, draft, snapshot };
}
export function readinessEnvelope(url: string, draft: QuestionnaireDraft, actor = context, superseded = false) {
  const query = new URL(url, "https://synthetic.invalid").searchParams;
  const formKey = query.get("form_key") as QuestionnaireFormKey;
  const readNonce = query.get("read_nonce")!;
  const scoring = buildQuestionnaireRuleCatalogEntry(formKey), validation = buildQuestionnaireValidationCatalogEntry(formKey);
  const bundle = buildQuestionnaireReadinessCatalogEntry(formKey);
  const { assessmentKey, versionId, version, formVersion, assessedOn, answers, context: fields, authorDisplayName, createdAt, contentHash } = draft;
  const pure = { assessmentKey, versionId, version, formVersion, assessedOn, answers, context: fields, authorDisplayName, createdAt, contentHash, recordState: "draft" };
  const expected = { organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId,
    formKey, clientId: query.get("client_id")!, versionId: query.get("version_id")!, contentHash: query.get("content_hash")!, readNonce };
  const data = buildQuestionnaireReadinessReport({ schemaVersion: "questionnaire-readiness-source.v1",
    organizationId: expected.organizationId, branchId: expected.branchId, actorUserId: expected.actorUserId,
    formKey, clientId: expected.clientId, readNonce,
    generatedAt: new Date(Date.now()).toISOString(), draft: pure, currentVersionId: superseded ? ids.otherId : draft.versionId,
    bundle: { bundleHash: bundle.bundleHash, canonicalJson: bundle.canonicalJson, scoringCanonicalJson: scoring.canonicalJson,
      scoringCatalogHash: scoring.catalogHash, validationCanonicalJson: validation.canonicalJson, validationCatalogHash: validation.validationCatalogHash },
    formalScore: null, signable: false,
  }, expected);
  return { requestId: ids.requestId, status: "ok", data, errors: [] };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
