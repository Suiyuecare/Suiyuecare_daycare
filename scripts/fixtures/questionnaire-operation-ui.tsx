// Isolated loopback synthetic UI. No credentials, real cases, cloud or storage.
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/app/app-shell";
import { QuestionnaireAssessmentsWorkspace } from "@/components/questionnaire-assessments/questionnaire-assessment-editor";
import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import { parseQuestionnaireMutation } from "@/lib/questionnaire-assessments/mutation-contract";
import { hasPendingOperations, hasViewTransition } from "@/lib/navigation/pending-operation-lock";
import { clearQuestionnairePendingOnLogout } from "@/lib/questionnaire-assessments/pending";
import { clearQuestionnaireViewOnLogout } from "@/lib/questionnaire-assessments/readiness-view";
import { clearUnsavedChangesOnLogout } from "@/lib/navigation/unsaved-changes";
import type { TenantContext } from "@/lib/domain/types";
import type { QuestionnaireAnswer, QuestionnaireAssessment, QuestionnaireSnapshot } from "@/lib/questionnaire-assessments/types";

const uuid = (number: number) => `79000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const form = QUESTIONNAIRE_FORMS.spmsq, now = new Date().toISOString();
const actor: TenantContext = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3),
  organizationName: "合成測試機構（非正式）", branchName: "合成測試分支", displayName: "合成評估人員",
  roles: ["nurse"], scopes: ["clients.read", ...["cognition", "adl", "swallowing", "emotion", "fall", "nutrition"].flatMap(prefix =>
    [`questionnaire_${prefix}.read`, `questionnaire_${prefix}.manage`])], assuranceLevel: "aal1", recentAal2At: null, demo: false };
const answers: Record<string, QuestionnaireAnswer> = Object.fromEntries(form.questions.map(question => [question.id,
  { state: "answered", value: question.choices[0]!.value }]));
const draft = { assessmentKey: uuid(101), versionId: uuid(102), version: 1, formVersion: form.version,
  assessedOn: "2026-09-26", answers, context: { education_adjustment: "middle_or_high_school", qualitative_note: "合成初始備註（非真實資料）" },
  authorDisplayName: "合成原紀錄作者", createdAt: now, assessmentCreatedAt: now, contentHash: "a".repeat(64), recordState: "draft" as const } satisfies QuestionnaireAssessment & { recordState: "draft" };
let snapshot: QuestionnaireSnapshot = { formKey: form.key, generatedAt: now, matchingTotal: 1, demo: false,
  clients: [{ clientId: uuid(103), displayName: "合成個案（非真實資料）", serviceStatus: "active", latest: draft,
    assessments: [draft], assessmentTotal: 1, nextAssessmentCursor: null }] };
let current = actor, canManage = true, workspaceEpoch = 0;
const root = createRoot(document.getElementById("fixture-root")!);
const envelope = (data: unknown) => ({ requestId: uuid(104), status: "ok", data, errors: [] });
type Saved = ReturnType<typeof result>;
const saved = new Map<string, Saved>();
const savedSize = (): number => saved.size;
function result(body: string, key: string) {
  const original = JSON.parse(body), normalized = parseQuestionnaireMutation(original, key);
  if (!normalized) throw new Error("Invalid synthetic original wire");
  const committedAt = new Date().toISOString();
  const receipt = { action: normalized.action, clientId: normalized.client_id, formKey: normalized.form_key,
    assessmentKey: normalized.assessment_key ?? uuid(101), versionId: uuid(200 + savedSize()), version: (normalized.expected_version ?? 0) + 1,
    recordState: "draft" as const, assessedOn: normalized.assessed_on, contentHash: "b".repeat(64), committedAt, replayed: false };
  const persistedDraft = { assessmentKey: receipt.assessmentKey, versionId: receipt.versionId, version: receipt.version,
    formVersion: normalized.form_version, assessedOn: normalized.assessed_on, answers: normalized.answers, context: normalized.context,
    recordState: "draft" as const, authorDisplayName: "合成原保存作者", createdAt: committedAt, contentHash: receipt.contentHash };
  const request = { action: normalized.action, client_id: normalized.client_id, form_key: normalized.form_key,
    form_version: normalized.form_version, assessed_on: normalized.assessed_on, answers: normalized.answers, context: normalized.context,
    assessment_key: normalized.assessment_key ?? null, previous_version_id: normalized.previous_version_id ?? null,
    expected_version: normalized.expected_version ?? 0 };
  return { body, receipt, draft: persistedDraft, request };
}
const parameters = new URLSearchParams(location.search);
const state = { syntheticOnly: true, mode: parameters.get("mode") ?? "unknown", receiptMode: "not_found", historyMode: "missing",
  posts: [] as { key: string; body: string }[], lookups: [] as { key: string; nonce: string }[], historyReads: 0, refreshes: 0,
  errors: [] as string[], branchRequests: [] as string[], nativeConfirms: 0, resolveLate: null as (() => void) | null,
  pending: hasPendingOperations, viewPending: hasViewTransition,
  remount: () => { workspaceEpoch++; render(); },
  refreshSource: () => { snapshot = { ...snapshot, generatedAt: new Date().toISOString() }; render(); },
  authority: (allowed: boolean, manage = true) => {
    current = { ...actor, scopes: allowed ? actor.scopes.filter(scope => manage || !scope.endsWith(".manage")) : [] };
    canManage = allowed && manage;
    snapshot = { ...snapshot, generatedAt: new Date().toISOString() }; render();
  },
  reset: () => {
    clearQuestionnairePendingOnLogout(); clearUnsavedChangesOnLogout(); clearQuestionnaireViewOnLogout();
    workspaceEpoch++; current = actor; canManage = true; snapshot = { ...snapshot, generatedAt: new Date().toISOString() }; render();
  },
};
(window as unknown as Window & { fixture: typeof state }).fixture = state;
window.confirm = () => { state.nativeConfirms++; return false; };
window.addEventListener("error", event => state.errors.push(event.message));
window.addEventListener("unhandledrejection", () => state.errors.push("Unhandled rejection"));
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (url.origin !== location.origin) throw new Error("External synthetic request blocked");
  if (url.pathname === "/api/context/branch") {
    state.branchRequests.push(init?.method ?? "GET");
    return Response.json(init?.method === "DELETE" ? { status: "ok", data: { cleared: true } } : envelope({ currentBranchId: actor.branchId,
      branches: [{ id: actor.branchId, name: actor.branchName }] }));
  }
  if (!url.pathname.startsWith("/api/questionnaire-assessments")) throw new Error("Only loopback synthetic workflow permitted");
  if (init?.method === "POST") {
    const key = new Headers(init.headers).get("idempotency-key")!, body = String(init.body);
    state.posts.push({ key, body });
    if (saved.has(key) && saved.get(key)!.body !== body) throw new Error("Original synthetic bytes changed");
    if (!saved.has(key)) saved.set(key, result(body, key));
    if (state.mode === "body-timeout") return { status: 201, redirected: false, json: () => new Promise(() => {}) } as Response;
    if (state.mode !== "success") return Response.json({}, { status: 503 });
    return Response.json(envelope(saved.get(key)!.receipt), { status: 201 });
  }
  if (url.pathname.endsWith("/receipt")) {
    const headers = new Headers(init?.headers), key = headers.get("idempotency-key")!, nonce = headers.get("x-questionnaire-receipt-nonce")!;
    state.lookups.push({ key, nonce }); const original = saved.get(key), mode = state.receiptMode;
    if (mode === "denied") return Response.json({ syntheticRejected: true }, { status: 403 });
    const found = mode !== "not_found" && !!original;
    const data = envelope({ schemaVersion: 1, status: found ? "committed" : "not_found", organizationId: current.organizationId,
      branchId: current.branchId, actorUserId: current.userId, formKey: form.key, clientId: uuid(103), action: original?.request.action ?? "revise",
      idempotencyKey: key, nonce, verifiedAt: new Date().toISOString(), persisted: found, demo: false,
      receipt: found ? original!.receipt : null, request: found ? original!.request : null, draft: found ? original!.draft : null });
    if (mode === "late") return { status: 200, redirected: false,
      json: () => new Promise(resolve => { state.resolveLate = () => resolve(data); }) } as Response;
    return Response.json(data);
  }
  state.historyReads++;
  const original = [...saved.values()].at(-1);
  if (url.searchParams.get("mode") === "versions") return Response.json(envelope({ formKey: form.key, clientId: uuid(103),
    assessmentKey: url.searchParams.get("assessment_key"), versions: state.historyMode === "present" && original ? [original.draft] : [],
    total: original?.receipt.version ?? 1, nextBeforeVersion: null }));
  return Response.json(envelope({ formKey: form.key, clientId: uuid(103), assessments: original ? [{ ...original.draft, assessmentCreatedAt: draft.createdAt }] : [],
    total: original ? 1 : 0, nextCursor: null }));
};
function render() {
  root.render(<AppShell context={current} navigation={[]}>
    <aside className="callout">本機合成操作｜不連雲端，不代表正式登入、保存或簽署。</aside>
    <QuestionnaireAssessmentsWorkspace key={workspaceEpoch} context={current} assessorName={current.displayName} canManage={canManage}
      form={form} loadError={false} pageTitle={form.title} selectedClientId={uuid(103)} snapshot={snapshot} />
  </AppShell>);
}
render();
