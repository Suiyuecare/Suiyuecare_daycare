// Loopback synthetic UI: never reads credentials, real clinical data or cloud.
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/app/app-shell";
import { QuestionnaireAssessmentsWorkspace } from "@/components/questionnaire-assessments/questionnaire-assessment-editor";
import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import { getQuestionnaireReadinessBrowserBinding, reproduceQuestionnaireReadinessCandidate } from "@/lib/questionnaire-assessments/browser-catalog";
import type { QuestionnaireAnswer, QuestionnaireAssessment, QuestionnaireFormKey, QuestionnaireSnapshot } from "@/lib/questionnaire-assessments/types";
import type { TenantContext } from "@/lib/domain/types";

const parameters = new URLSearchParams(location.search);
const requested = parameters.get("form") ?? "barthel_adl";
const formKey: QuestionnaireFormKey = Object.hasOwn(QUESTIONNAIRE_FORMS, requested) ? requested as QuestionnaireFormKey : "barthel_adl";
const form = QUESTIONNAIRE_FORMS[formKey];
const uuid = (number: number) => `19000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const stamp = new Date().toISOString();
const answers: Record<string, QuestionnaireAnswer> = Object.fromEntries(form.questions.map(question => [question.id,
  { state: "answered", value: question.choices[0]!.value }]));
const fields: Record<string, string> = { qualitative_note: "合成評估備註，非真實個案資料。" };
if (formKey === "spmsq") fields.education_adjustment = "middle_or_high_school";
if (formKey === "mna_sf") { answers.anthropometry = { state: "answered", value: "bmi_19_lt_21" }; fields.height_cm = "170"; fields.weight_kg = "60"; }
if (parameters.get("answers") === "missing") answers[form.questions[0]!.id] = { state: "missing" };
if (formKey === "bsrs5" && parameters.get("answers") === "risk") answers[form.questions.at(-1)!.id] = { state: "answered", value: "4" };
const draft: QuestionnaireAssessment = { assessmentKey: uuid(101), versionId: uuid(102), version: 1,
  formVersion: form.version, assessedOn: "2026-09-26", answers, context: fields,
  authorDisplayName: "合成評估人員", createdAt: stamp, assessmentCreatedAt: stamp, contentHash: "a".repeat(64) };
const snapshot: QuestionnaireSnapshot = { formKey, generatedAt: stamp, matchingTotal: 1, demo: false,
  clients: [{ clientId: uuid(103), displayName: "合成個案（非真實資料）", serviceStatus: "active",
    latest: draft, assessments: [draft], assessmentTotal: 1, nextAssessmentCursor: null }] };
const context: TenantContext = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3),
  organizationName: "合成測試機構（非正式）", branchName: "合成測試分支", displayName: "合成評估人員",
  roles: ["nurse"], scopes: ["clients.read", ...["cognition", "adl", "swallowing", "emotion", "fall", "nutrition"].flatMap(prefix =>
    [`questionnaire_${prefix}.read`, `questionnaire_${prefix}.manage`])], assuranceLevel: "aal1", recentAal2At: null, demo: false };
const state = { reads: 0, writes: 0, refreshes: 0, mode: parameters.get("mode") ?? "complete", errors: [] as string[] };
(window as unknown as Window & { fixture: typeof state }).fixture = state;
window.addEventListener("error", event => state.errors.push(event.message));
window.addEventListener("unhandledrejection", () => state.errors.push("Unhandled rejection"));
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/questionnaire-assessments")) throw new Error("Local synthetic API only");
  if (init?.method === "POST") { state.writes++; return Response.json({ errors: [] }, { status: 503 }); }
  if (url.pathname !== "/api/questionnaire-assessments/readiness") throw new Error("Local saved-version check only");
  state.reads++;
  if (state.mode === "denied") return Response.json({ errors: [] }, { status: 403 });
  if (state.mode === "offline") throw new TypeError("Synthetic offline");
  if (state.mode === "loading") await new Promise(done => setTimeout(done, 5000));
  if (state.mode === "body-timeout") return { ok: true, status: 200, redirected: false, json: () => new Promise(() => {}) } as Response;
  const binding = getQuestionnaireReadinessBrowserBinding(formKey);
  const candidate = reproduceQuestionnaireReadinessCandidate(formKey, draft.answers, draft.context);
  const superseded = state.mode === "superseded";
  const blockers = [...(candidate.status === "complete" ? [] : [candidate.status === "invalid" ? "answers_invalid" : "answers_incomplete"]),
    ...(superseded ? ["version_superseded"] : []), "source_evidence_missing", "bundle_not_adopted", "signing_policy_missing", "formal_signing_unavailable"];
  return Response.json({ requestId: uuid(104), status: "ok", errors: [], data: {
    schemaVersion: "questionnaire-readiness-report.v1", candidateOnly: true,
    organizationId: context.organizationId, branchId: context.branchId, actorUserId: context.userId,
    formKey, clientId: uuid(103), readNonce: url.searchParams.get("read_nonce"), generatedAt: new Date().toISOString(),
    assessmentKey: draft.assessmentKey, versionId: draft.versionId, version: draft.version, assessedOn: draft.assessedOn, contentHash: draft.contentHash,
    currentVersionId: superseded ? uuid(105) : draft.versionId, bundleHash: binding.bundleHash,
    formVersion: binding.formVersion, ruleVersion: binding.ruleVersion, candidate, blockers, formalScore: null, signable: false,
  } });
};
createRoot(document.getElementById("fixture-root")!).render(<AppShell context={context} navigation={[]}>
  <aside className="callout">本機合成測試｜不連雲端，不代表正式簽署或部署。</aside>
  <QuestionnaireAssessmentsWorkspace context={context} assessorName={context.displayName} canManage form={form} loadError={false}
    pageTitle={form.title} selectedClientId={uuid(103)} snapshot={snapshot} />
</AppShell>);
