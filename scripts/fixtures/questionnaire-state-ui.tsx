// Loopback-only synthetic editor. No real identity, cloud, clinical approval or storage.
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/app/app-shell";
import { QuestionnaireAssessmentsWorkspace } from "@/components/questionnaire-assessments/questionnaire-assessment-editor";
import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import type { QuestionnaireAnswers, QuestionnaireDraft, QuestionnaireSnapshot } from "@/lib/questionnaire-assessments/types";
import type { TenantContext } from "@/lib/domain/types";

const form = new URLSearchParams(location.search).get("form") === "lawton_iadl"
  ? QUESTIONNAIRE_FORMS.lawton_iadl : QUESTIONNAIRE_FORMS.barthel_adl;
const uuid = (number: number) => `19000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const stamp = new Date().toISOString();
const answers: QuestionnaireAnswers = Object.fromEntries(form.questions.map((question, index) => [question.id,
  index === 0 ? { state: "not_applicable", reason: "合成測試：本題不適用理由，非真實個案內容。" } : { state: "missing" }]));
const draft: QuestionnaireDraft & { recordState: "draft" } = { assessmentKey: uuid(101), versionId: uuid(102), version: 1,
  formVersion: form.version, assessedOn: "2026-09-25", answers, context: {}, recordState: "draft",
  authorDisplayName: "合成評估人員", createdAt: stamp, contentHash: "a".repeat(64) };
const snapshot: QuestionnaireSnapshot = { formKey: form.key, generatedAt: stamp, matchingTotal: 1,
  clients: [{ clientId: uuid(103), displayName: "合成個案（非真實資料）", serviceStatus: "active",
    latest: draft, assessments: [{ ...draft, assessmentCreatedAt: stamp }], assessmentTotal: 1, nextAssessmentCursor: null }] };
const context: TenantContext = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3),
  organizationName: "合成測試機構（非正式）", branchName: "合成測試分支", displayName: "合成評估人員",
  roles: ["nurse"], scopes: [], assuranceLevel: "aal1", recentAal2At: null, demo: false };
const state = { writes: [] as string[], refreshes: 0 };
(window as unknown as Window & { fixture: typeof state }).fixture = state;
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (url.origin !== location.origin || url.pathname !== "/api/questionnaire-assessments") {
    throw new Error("Only the loopback synthetic questionnaire API is available");
  }
  if (init?.method === "POST") {
    state.writes.push(String(init.body));
    // Deliberately unknown; never claim real persistence or a clinical signature.
    return Response.json({ errors: [{ message: "合成測試結果不明，沒有連線正式資料庫。" }] }, { status: 503 });
  }
  if (url.searchParams.get("mode") === "versions") return Response.json({ data: {
    formKey: form.key, clientId: uuid(103), assessmentKey: draft.assessmentKey,
    versions: [draft], total: 1, nextBeforeVersion: null,
  }, errors: [] });
  throw new Error("This synthetic fixture only exposes its fixed history");
};
createRoot(document.getElementById("fixture-root")!).render(<AppShell context={context} navigation={[]}>
  <aside className="callout">本機合成題目狀態測試；不連雲端，不證明登入、保存或正式計分。</aside>
  <QuestionnaireAssessmentsWorkspace assessorName={context.displayName} canManage form={form} loadError={false}
    pageTitle={form.title} selectedClientId={uuid(103)} snapshot={snapshot} />
</AppShell>);
