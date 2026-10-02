// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import Link from "next/link";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ fetch: vi.fn(), release: vi.fn(), acquire: vi.fn() }));
vi.mock("@/lib/api/client-fetch", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/api/client-fetch")>(), fetchWithTimeout: stubs.fetch,
}));
vi.mock("@/components/clients/client-selection-card", () => ({
  ClientSelectionCard: ({ disabled }: { disabled?: boolean }) => <select aria-label="個案" disabled={disabled}><option>合成個案</option></select>,
}));

import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import type { QuestionnaireAnswers, QuestionnaireAssessment, QuestionnaireDraft, QuestionnaireSnapshot } from "@/lib/questionnaire-assessments/types";
import { QuestionnaireAssessmentsWorkspace } from "./questionnaire-assessment-editor";
import type { TenantContext } from "@/lib/domain/types";
import { hasPendingOperations } from "@/lib/navigation/pending-operation-lock";
import { clearQuestionnairePendingOnLogout, observeQuestionnairePendingAuthority } from "@/lib/questionnaire-assessments/pending";
import { clearQuestionnaireViewOnLogout, getQuestionnaireViewState, observeQuestionnaireViewAuthority, questionnaireViewAuthority } from "@/lib/questionnaire-assessments/readiness-view";

const clientId = "10000000-0000-4000-8000-000000000001";
const key = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const versionId = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let stamp = "2026-09-25T01:00:00Z";
let sequence = 0;
const context: TenantContext = { organizationId: clientId, branchId: key(99), userId: versionId(99), organizationName: "合成機構",
  branchName: "合成分支", displayName: "目前登入人員", roles: ["nurse"], assuranceLevel: "aal1", recentAal2At: null, demo: false,
  scopes: ["clients.read", ...["cognition", "adl", "emotion", "fall", "nutrition", "swallowing"].flatMap(group => [`questionnaire_${group}.read`, `questionnaire_${group}.manage`])] };
const form = QUESTIONNAIRE_FORMS.spmsq;
const answers = Object.fromEntries(form.questions.map(({ id }) => [id, { state: "answered", value: "correct" }])) as QuestionnaireAnswers;
const draft = (chain = 1, version = 1): QuestionnaireDraft & { recordState: "draft" } => ({ assessmentKey: key(chain), versionId: versionId(chain * 100 + version),
  version, formVersion: form.version, assessedOn: "2026-09-25", answers, context: { education_adjustment: "middle_or_high_school" },
  recordState: "draft", authorDisplayName: `評估人員 ${chain}`, createdAt: stamp, contentHash: "a".repeat(64) });
const assessment = (chain = 1, version = 1): QuestionnaireAssessment => ({ ...draft(chain, version), assessmentCreatedAt: stamp });
const defaultSnapshot = (): QuestionnaireSnapshot => ({ formKey: "spmsq", generatedAt: stamp, matchingTotal: 1,
  clients: [{ clientId, displayName: "合成個案", serviceStatus: "active", latest: draft(), assessments: [assessment(), assessment(2)], assessmentTotal: 2, nextAssessmentCursor: null }] });
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ requestId: key(999), status: status < 400 ? "ok" : "error", data, errors: [] }), { status: status === 200 && data && typeof data === "object" && "action" in data ? 201 : status });
const history = (chain = 1, versions = [1], nextBeforeVersion: number | null = null, total = versions.length) => ({
  formKey: "spmsq", clientId, assessmentKey: key(chain), versions: versions.map((v) => draft(chain, v)), total, nextBeforeVersion,
});
const page = (assessments = [assessment(), assessment(2)], total = assessments.length) => ({ formKey: "spmsq", clientId, assessments, total, nextCursor: null });
const dateMatch = (chain: number, version = 1) => ({ assessmentKey: key(chain), versionId: versionId(chain * 100 + version),
  version, assessedOn: "2026-09-25", savedAt: stamp, recordState: "draft", assessmentCreatedAt: stamp });
const datePage = (matches = [dateMatch(60)], total = matches.length, nextCursor: { createdAt: string; assessmentKey: string } | null = null) => ({
  formKey: "spmsq", clientId, assessedOn: "2026-09-25", assessments: matches, total, nextCursor,
});
const receipt = (action: "create" | "revise", chain = 1, version = 1, assessedOn = "2026-09-25") => ({ action, clientId, formKey: "spmsq", assessmentKey: key(chain),
  versionId: versionId(chain * 100 + version), version, recordState: "draft", assessedOn, contentHash: "a".repeat(64), committedAt: stamp, replayed: false });
const workspace = (snapshot = defaultSnapshot(), canManage = true, selectedForm = form) => render(<QuestionnaireAssessmentsWorkspace assessorName="目前登入人員" canManage={canManage}
  context={context} form={selectedForm} loadError={false} pageTitle={selectedForm.title} selectedClientId={clientId} snapshot={snapshot} />);
const button = (name: string) => screen.getByRole("button", { name });
const posts = () => stubs.fetch.mock.calls.filter(([, init]) => init?.method === "POST");
const functionalForms = [QUESTIONNAIRE_FORMS.barthel_adl, QUESTIONNAIRE_FORMS.lawton_iadl];
const functionalSnapshot = (selectedForm = functionalForms[0]!, reason = "合成個案本次無法適用此項") => {
  const responses = Object.fromEntries(selectedForm.questions.map(({ id, choices }, index) => [id,
    index === 0 ? { state: "answered", value: choices[0]!.value } : index === 1 ? { state: "not_applicable", reason } : { state: "missing" },
  ])) as QuestionnaireAnswers;
  const latest = { ...draft(), formVersion: selectedForm.version, answers: responses, context: {} };
  return { ...defaultSnapshot(), formKey: selectedForm.key,
    clients: [{ ...defaultSnapshot().clients[0]!, latest, assessments: [{ ...latest, assessmentCreatedAt: stamp }], assessmentTotal: 1 }] } satisfies QuestionnaireSnapshot;
};
const questionGroup = (number: number) => screen.getByRole("radiogroup", { name: new RegExp(`^${number}\\.\\s+\\S`, "u") });
const questionCard = (number: number) => within(questionGroup(number).closest("section")!);

describe("questionnaire independent drafts and version browsing", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-09-25T01:00:00Z") + ++sequence * 120_000); stamp = new Date().toISOString();
    vi.stubGlobal("fetch", stubs.fetch); vi.spyOn(window, "confirm").mockReturnValue(false);
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
    const authority = questionnaireViewAuthority(context); observeQuestionnaireViewAuthority(authority);
    observeQuestionnairePendingAuthority(authority, getQuestionnaireViewState().epoch);
  });
  afterEach(() => { cleanup(); clearQuestionnairePendingOnLogout(); clearQuestionnaireViewOnLogout(); Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal"); Reflect.deleteProperty(HTMLDialogElement.prototype, "close"); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(Object.values(QUESTIONNAIRE_FORMS))("directly renders every question of $key after client selection", (selectedForm) => {
    const snapshot: QuestionnaireSnapshot = { ...defaultSnapshot(), formKey: selectedForm.key,
      clients: [{ ...defaultSnapshot().clients[0]!, latest: null, assessments: [], assessmentTotal: 0 }] };
    workspace(snapshot, true, selectedForm);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(selectedForm.questions.length);
    expect(screen.getByText("僅供草稿核對，正式計分尚未啟用")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /簽署/ })).toBeNull();
  });

  it("places MNA-SF measurements directly before F, after questions A–E, without clearing values", () => {
    const mna = QUESTIONNAIRE_FORMS.mna_sf;
    const snapshot: QuestionnaireSnapshot = { ...defaultSnapshot(), formKey: mna.key,
      clients: [{ ...defaultSnapshot().clients[0]!, latest: null, assessments: [], assessmentTotal: 0 }] };
    workspace(snapshot, true, mna);
    const measurements = screen.getByText("身體測量（MNA-SF）").closest("fieldset")!;
    const cards = Array.from({ length: mna.questions.length }, (_, index) => questionGroup(index + 1).closest("section")!);
    const sequence = [...measurements.parentElement!.children].filter((node) => node.tagName !== "LEGEND");
    cards.slice(0, 5).forEach((card, index) => expect(sequence[index]).toBe(card));
    expect(sequence[5]).toBe(measurements);
    expect(sequence[6]).toBe(cards[5]);
    expect(sequence).toHaveLength(7);

    const height = screen.getByRole("spinbutton", { name: "身高（公分）" });
    const weight = screen.getByRole("spinbutton", { name: "體重（公斤）" });
    const calf = screen.getByRole("spinbutton", { name: "小腿圍（公分）" });
    fireEvent.change(height, { target: { value: "160" } });
    fireEvent.change(weight, { target: { value: "48" } });
    fireEvent.change(calf, { target: { value: "30" } });
    fireEvent.click(within(questionGroup(1)).getByRole("radio", { name: mna.questions[0]!.choices[0]!.label }));
    expect(height).toHaveValue(160);
    expect(weight).toHaveValue(48);
    expect(calf).toHaveValue(30);
    expect(screen.getByText(/依輸入身高與體重計算 BMI：18\./u)).toBeVisible();
  });

  it("puts the active questionnaire and concise progress before saved-history tools while keeping its formal gate visible", () => {
    workspace();
    const firstQuestion = questionGroup(1);
    const records = screen.getByRole("region", { name: "已保存的評估" });
    const progress = screen.getByLabelText("作答進度");
    const visibleProgress = screen.getByText("已選 10／10 題");
    expect(firstQuestion.compareDocumentPosition(records) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(progress.compareDocumentPosition(firstQuestion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(visibleProgress.compareDocumentPosition(firstQuestion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("尚不可簽署", { exact: true })).toBeVisible();
    expect(screen.getByText("本次記錄人員")).toBeVisible();
    expect(screen.getByText("目前登入人員", { exact: true })).toBeVisible();
    const sourceDetails = screen.getByText("題目來源與計分說明").closest("details")!;
    expect(sourceDetails).not.toHaveAttribute("open");
    expect(within(sourceDetails).getByText(/題目來源：/u)).not.toBeVisible();
    expect(screen.getByText("僅供草稿核對，正式計分尚未啟用")).toBeVisible();
    expect(posts()).toHaveLength(0);
  });

  it("keeps the selected client visible and makes the client switch an intentional disclosure", () => {
    workspace();
    const switcher = screen.getByText("更換個案").closest("details")!;
    expect(switcher).not.toHaveAttribute("open");
    expect(within(switcher.querySelector("summary")!).getByText("合成個案")).toBeVisible();
    fireEvent.click(within(switcher).getByText("更換個案"));
    expect(switcher).toHaveAttribute("open");
    expect(within(switcher).getByRole("combobox", { name: "個案" })).toBeVisible();
    expect(questionGroup(1)).toBeVisible();
    expect(posts()).toHaveLength(0);
  });

  it("shows a retry for a failed initial read rather than a misleading scope-change warning", () => {
    render(<QuestionnaireAssessmentsWorkspace assessorName="目前登入人員" canManage context={context} form={form}
      loadError pageTitle={form.title} selectedClientId={clientId} snapshot={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("暫時無法載入");
    expect(screen.getByRole("link", { name: "重新載入" })).toHaveAttribute("href", "?");
    expect(screen.queryByText("評估資料需要重新確認")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it.each(Object.values(QUESTIONNAIRE_FORMS))("keeps every full official prompt and answer option visible in $key", (selectedForm) => {
    const snapshot: QuestionnaireSnapshot = { ...defaultSnapshot(), formKey: selectedForm.key,
      clients: [{ ...defaultSnapshot().clients[0]!, latest: null, assessments: [], assessmentTotal: 0 }] };
    workspace(snapshot, true, selectedForm);
    selectedForm.questions.forEach((question, index) => {
      expect(screen.getByRole("heading", { name: `${index + 1}. ${question.prompt}` })).toBeVisible();
      const groupElement = screen.getByRole("radiogroup", { name: `${index + 1}. ${question.prompt}` });
      expect(groupElement).toHaveAccessibleName(`${index + 1}. ${question.prompt}`);
      expect(groupElement).toHaveAccessibleDescription(question.helpText ?? "");
      const group = within(groupElement);
      question.choices.forEach(choice => expect(group.getByRole("radio", { name: choice.label })).toBeVisible());
    });
    expect(screen.getAllByRole("radio").every(element => !(element as HTMLInputElement).checked)).toBe(true);
  });

  it("keeps uncertain-save recovery before question cards with exactly one recovery action", async () => {
    workspace();
    stubs.fetch.mockResolvedValueOnce(response(null, 503));
    fireEvent.click(button("保存修訂版本"));
    await waitFor(() => expect(button("確認保存結果")).toBeVisible());
    const recovery = screen.getByRole("region", { name: "保存結果待確認" });
    expect(recovery.compareDocumentPosition(questionGroup(1)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "確認保存結果" })).toHaveLength(1);
    within(questionGroup(1)).getAllByRole("radio").forEach(element => expect(element).toBeDisabled());
    expect(posts()).toHaveLength(1);
  });

  it.each(functionalForms)("visibly distinguishes saved answered, N/A with reason and missing states in $key", (selectedForm) => {
    workspace(functionalSnapshot(selectedForm), true, selectedForm);
    expect(questionCard(1).getByText("已作答")).toBeVisible();
    expect(questionCard(1).getByLabelText(selectedForm.questions[0]!.choices[0]!.label)).toBeChecked();
    expect(questionCard(2).getByText("不適用", { exact: true })).toBeVisible();
    expect(questionCard(2).getByLabelText("不適用（需原因）")).toBeChecked();
    expect(screen.getByRole("textbox", { name: "第 2 題不適用原因" })).toHaveValue("合成個案本次無法適用此項");
    expect(screen.getByRole("textbox", { name: "第 2 題不適用原因" })).toBeRequired();
    expect(questionCard(3).getByText("未填")).toBeVisible();
    expect(questionCard(3).getAllByRole("radio").every((node) => !(node as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText(`已作答 1／${selectedForm.questions.length} 題 · 不適用 1 題 · 未填 ${selectedForm.questions.length - 2} 題`)).toBeVisible();
    expect(screen.getByText("計分預覽：尚未完整作答")).toBeVisible();
    expect(screen.queryByRole("button", { name: /簽署/ })).toBeNull();
  });

  it.each(functionalForms)("edits the saved N/A reason and freezes it for an uncertain $key retry", async (selectedForm) => {
    workspace(functionalSnapshot(selectedForm), true, selectedForm);
    const reason = screen.getByRole("textbox", { name: "第 2 題不適用原因" });
    fireEvent.change(reason, { target: { value: " 合成原因修訂：保留換行\n供覆核 " } });
    stubs.fetch.mockResolvedValueOnce(response(null, 503));
    fireEvent.click(button("保存修訂版本"));
    await waitFor(() => expect(button("以相同內容重試")).toBeVisible());
    const payload = JSON.parse(posts()[0]![1].body as string);
    expect(payload.answers[selectedForm.questions[1]!.id]).toEqual({ state: "not_applicable", reason: " 合成原因修訂：保留換行\n供覆核 " });
    expect(payload.answers[selectedForm.questions[2]!.id]).toEqual({ state: "missing" });
    expect(payload).toMatchObject({ action: "revise", expectedVersion: 1, previousVersionId: versionId(101) });
    expect(reason).toBeDisabled(); expect(button("清除第 2 題答案")).toBeDisabled();
    expect(questionCard(2).getByLabelText("不適用（需原因）")).toBeDisabled();
    stubs.fetch.mockResolvedValueOnce(response(null, 503));
    fireEvent.click(button("以相同內容重試"));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[0]![1].body).toBe(posts()[1]![1].body);
    expect(posts()[0]![1].headers["idempotency-key"]).toBe(posts()[1]![1].headers["idempotency-key"]);
  });

  it("restores missing when clearing N/A and discards the old reason when selecting an answer", async () => {
    const selectedForm = functionalForms[0]!;
    workspace(functionalSnapshot(selectedForm), true, selectedForm);
    fireEvent.click(button("清除第 2 題答案"));
    expect(questionCard(2).getByText("未填")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "第 2 題不適用原因" })).toBeNull();
    expect(questionCard(2).getAllByRole("radio").every((node) => !(node as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(questionCard(1).getByLabelText("不適用（需原因）"));
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 題不適用原因" }), { target: { value: "合成原因" } });
    fireEvent.click(questionCard(1).getByLabelText(selectedForm.questions[0]!.choices[0]!.label));
    expect(screen.queryByRole("textbox", { name: "第 1 題不適用原因" })).toBeNull();
    stubs.fetch.mockResolvedValueOnce(response(null, 503)); fireEvent.click(button("保存修訂版本"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const payload = JSON.parse(posts()[0]![1].body as string);
    expect(payload.answers[selectedForm.questions[0]!.id]).toEqual({ state: "answered", value: selectedForm.questions[0]!.choices[0]!.value });
    expect(payload.answers[selectedForm.questions[1]!.id]).toEqual({ state: "missing" });
  });

  it("marks a cleared answer as unsaved and requires confirmation before switching assessments", () => {
    const selectedForm = functionalForms[0]!;
    workspace(functionalSnapshot(selectedForm), true, selectedForm);
    fireEvent.click(button("清除第 2 題答案")); fireEvent.click(button("新增一次評估"));
    expect(screen.getByRole("dialog", { name: "放棄尚未保存的修改？" })).toBeVisible();
    fireEvent.click(button("繼續填寫")); expect(questionCard(2).getByText("未填")).toBeVisible();
  });

  it("clears a scored answer back to missing without inventing a zero score", async () => {
    const selectedForm = functionalForms[0]!;
    workspace(functionalSnapshot(selectedForm), true, selectedForm);
    fireEvent.click(button("清除第 1 題答案"));
    expect(questionCard(1).getByText("未填")).toBeVisible();
    expect(screen.getByText(`已作答 0／${selectedForm.questions.length} 題 · 不適用 1 題 · 未填 ${selectedForm.questions.length - 1} 題`)).toBeVisible();
    expect(screen.getByText("計分預覽：尚未完整作答")).toBeVisible();
    stubs.fetch.mockResolvedValueOnce(response(null, 503)); fireEvent.click(button("保存修訂版本"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0]![1].body as string).answers[selectedForm.questions[0]!.id]).toEqual({ state: "missing" });
  });

  it.each(functionalForms)("reads the saved N/A reason back after a confirmed $key revision without enabling official scoring", async (selectedForm) => {
    const snapshot = functionalSnapshot(selectedForm);
    const latest = snapshot.clients[0]!.latest!;
    const revised = { ...latest, version: 2, versionId: versionId(102), answers: {
      ...latest.answers, [selectedForm.questions[1]!.id]: { state: "not_applicable" as const, reason: "合成修訂原因" },
    } };
    workspace(snapshot, true, selectedForm);
    fireEvent.change(screen.getByRole("textbox", { name: "第 2 題不適用原因" }), { target: { value: "合成修訂原因" } });
    stubs.fetch.mockResolvedValueOnce(response({ ...receipt("revise", 1, 2), formKey: selectedForm.key }))
      .mockResolvedValueOnce(response({ ...history(), formKey: selectedForm.key, versions: [revised, latest], total: 2 }))
      .mockResolvedValueOnce(response({ ...page(), formKey: selectedForm.key, assessments: [{ ...revised, assessmentCreatedAt: stamp }], total: 1 }));
    fireEvent.click(button("保存修訂版本"));
    await waitFor(() => expect(screen.getByText("草稿已保存並讀回；尚未簽署。")).toBeVisible());
    expect(screen.getByRole("textbox", { name: "第 2 題不適用原因" })).toHaveValue("合成修訂原因");
    expect(screen.getByRole("textbox", { name: "第 2 題不適用原因" })).not.toBeDisabled();
    expect(posts()).toHaveLength(1); expect(screen.queryByRole("button", { name: /簽署/ })).toBeNull();
    expect(screen.getByText("計分預覽：尚未完整作答")).toBeVisible();
  });

  it.each(functionalForms)("shows an old $key version's own N/A reason read-only without replacing the latest reason", async (selectedForm) => {
    const snapshot = functionalSnapshot(selectedForm);
    const older = snapshot.clients[0]!.latest!;
    const newer = { ...older, version: 2, versionId: versionId(102), answers: {
      ...older.answers, [selectedForm.questions[1]!.id]: { state: "not_applicable" as const, reason: "合成最新原因" },
    } };
    workspace({ ...snapshot, clients: [{ ...snapshot.clients[0]!, latest: newer, assessments: [{ ...newer, assessmentCreatedAt: stamp }] }] }, true, selectedForm);
    stubs.fetch.mockResolvedValueOnce(response({ ...history(), formKey: selectedForm.key, versions: [newer, older], total: 2 }));
    fireEvent.click(button("查看版本歷程")); await waitFor(() => expect(button("查看 v1")).toBeVisible());
    fireEvent.click(button("查看 v1"));
    expect(screen.getByRole("textbox", { name: "第 2 題不適用原因" })).toHaveValue("合成個案本次無法適用此項");
    expect(screen.getByRole("textbox", { name: "第 2 題不適用原因" })).toBeDisabled();
    expect(button("清除第 2 題答案")).toBeDisabled();
    fireEvent.click(button("修訂此草稿"));
    expect(screen.getByRole("textbox", { name: "第 2 題不適用原因" })).toHaveValue("合成最新原因");
    expect(screen.getByRole("textbox", { name: "第 2 題不適用原因" })).not.toBeDisabled();
    expect(posts()).toHaveLength(0);
  });

  it.each(["", "   ", "a".repeat(501), "😀".repeat(501), "合成\u0001原因"])("blocks an invalid N/A reason before fetch and focuses its inline error field (%#)", (reason) => {
    const selectedForm = functionalForms[0]!;
    workspace(functionalSnapshot(selectedForm, reason), true, selectedForm);
    const field = screen.getByRole("textbox", { name: "第 2 題不適用原因" });
    expect(screen.getByText("必填，去除頭尾空白後 1–500 字；不列入分數。")).toBeVisible();
    fireEvent.click(button("保存修訂版本"));
    expect(stubs.fetch).not.toHaveBeenCalled(); expect(field).toHaveFocus(); expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/請填寫不適用原因|不得超過 500 字|請移除不適用原因中的控制字元/);
    fireEvent.change(field, { target: { value: "合成有效原因" } }); expect(field).not.toHaveAttribute("aria-invalid", "true");
  });

  it.each(["a".repeat(500), "😀".repeat(500), `  ${"a".repeat(500)}  `])("accepts the SQL-equivalent 500-character trimmed boundary without silently changing reason (%#)", async (reason) => {
    const selectedForm = functionalForms[0]!;
    workspace(functionalSnapshot(selectedForm, reason), true, selectedForm);
    stubs.fetch.mockResolvedValueOnce(response(null, 503)); fireEvent.click(button("保存修訂版本"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0]![1].body as string).answers[selectedForm.questions[1]!.id]).toEqual({ state: "not_applicable", reason });
  });

  it("focuses the first invalid N/A reason and preserves every entered response", () => {
    const selectedForm = functionalForms[0]!;
    workspace(functionalSnapshot(selectedForm, ""), true, selectedForm);
    fireEvent.click(questionCard(1).getByLabelText("不適用（需原因）"));
    fireEvent.click(button("保存修訂版本"));
    expect(screen.getByRole("textbox", { name: "第 1 題不適用原因" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "第 2 題不適用原因" })).toHaveValue("");
    expect(questionCard(3).getByText("未填")).toBeVisible(); expect(posts()).toHaveLength(0);
  });

  it.each(functionalForms)("retains readable N/A reasons without editable controls for read-only $key accounts", (selectedForm) => {
    workspace(functionalSnapshot(selectedForm), false, selectedForm);
    expect(screen.getByRole("textbox", { name: "第 2 題不適用原因" })).toHaveValue("合成個案本次無法適用此項");
    expect(screen.getByRole("textbox", { name: "第 2 題不適用原因" })).toBeDisabled();
    expect(questionCard(2).getByLabelText("不適用（需原因）")).toBeDisabled();
    expect(button("清除第 2 題答案")).toBeDisabled(); expect(posts()).toHaveLength(0);
  });

  it("does not introduce unsupported N/A choices to other questionnaire forms", () => {
    workspace(); expect(screen.queryByLabelText("不適用（需原因）")).toBeNull();
  });

  it("starts a separate assessment with blank answers rather than revising the existing chain", async () => {
    workspace(); fireEvent.click(button("新增一次評估"));
    expect(screen.getAllByRole("radio").every((element) => !(element as HTMLInputElement).checked)).toBe(true);
    fireEvent.change(screen.getByLabelText("評估日期"), { target: { value: "2026-09-25" } });
    stubs.fetch.mockResolvedValueOnce(response(receipt("create", 3)))
      .mockResolvedValueOnce(response({ ...history(3), versions: [{ ...draft(3), answers: Object.fromEntries(form.questions.map(({ id }) => [id, { state: "missing" }])), context: {} }] })).mockResolvedValueOnce(response(page([assessment(), assessment(2), assessment(3)])));
    fireEvent.click(button("保存本次評估"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const payload = JSON.parse(posts()[0]![1].body as string);
    expect(payload).toMatchObject({ action: "create", clientId, formKey: "spmsq" });
    expect(payload).not.toHaveProperty("assessmentKey"); expect(payload.answers.spmsq_01).toEqual({ state: "missing" });
    await waitFor(() => expect(screen.getByText("已保存 3 次評估；每次評估與修訂版本分開保留。")).toBeTruthy());
    expect(hasPendingOperations()).toBe(false);
  });

  it("revises the explicitly chosen latest draft and keeps old versions read-only", async () => {
    workspace(); stubs.fetch.mockResolvedValueOnce(response(history(2, [3, 2, 1])));
    fireEvent.change(screen.getByLabelText("選擇已保存評估"), { target: { value: key(2) } });
    await waitFor(() => expect(button("查看 v1")).toBeTruthy());
    fireEvent.click(button("查看 v1"));
    expect(screen.getByLabelText("評估日期")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存修訂版本" })).toBeNull();
    fireEvent.click(button("修訂此草稿"));
    expect(screen.getByLabelText("評估日期")).not.toBeDisabled();
    stubs.fetch.mockResolvedValueOnce(response(receipt("revise", 2, 4))).mockResolvedValueOnce(response(history(2, [4, 3, 2, 1]))).mockResolvedValueOnce(response(page()));
    fireEvent.click(button("保存修訂版本"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0]![1].body as string)).toMatchObject({ action: "revise", assessmentKey: key(2), previousVersionId: versionId(203), expectedVersion: 3 });
    await waitFor(() => expect(screen.getByText("草稿已保存並讀回；尚未簽署。")).toBeTruthy());
  });

  it("pages assessment roots and versions using distinct exact cursors", async () => {
    const snapshot = defaultSnapshot(); const client = snapshot.clients[0]!;
    workspace({ ...snapshot, clients: [{ ...client, assessmentTotal: 3, nextAssessmentCursor: { createdAt: stamp, assessmentKey: key(2) } }] });
    stubs.fetch.mockResolvedValueOnce(response(page([assessment(3)], 3)));
    fireEvent.click(button("載入較早評估"));
    await waitFor(() => expect(screen.getByRole("option", { name: /評估人員 3/ })).toBeTruthy());
    const query = new URL(stubs.fetch.mock.calls[0]![0] as string, "https://example.invalid").searchParams;
    expect(query.get("mode")).toBe("assessments"); expect(query.get("before_assessment_key")).toBe(key(2)); expect(query.get("before_created_at")).toBe(stamp);
    stubs.fetch.mockResolvedValueOnce(response(history(3, [4, 3], 3, 4)));
    fireEvent.change(screen.getByLabelText("選擇已保存評估"), { target: { value: key(3) } });
    await waitFor(() => expect(button("載入較早版本")).toBeTruthy());
    stubs.fetch.mockResolvedValueOnce(response(history(3, [2, 1], null, 4)));
    fireEvent.click(button("載入較早版本"));
    await waitFor(() => expect(button("查看 v1")).toBeTruthy());
    const versionsQuery = new URL(stubs.fetch.mock.calls.at(-1)![0] as string, "https://example.invalid").searchParams;
    expect(versionsQuery.get("assessment_key")).toBe(key(3)); expect(versionsQuery.get("before_version")).toBe("3");
    expect(screen.queryByRole("button", { name: "載入較早版本" })).toBeNull();
  });

  it("finds an older-than-50 assessment by its actual assessment date and opens the exact version", async () => {
    const snapshot = defaultSnapshot(); const client = snapshot.clients[0]!;
    workspace({ ...snapshot, clients: [{ ...client, assessmentTotal: 60 }] });
    fireEvent.change(screen.getByLabelText("依評估日期查找"), { target: { value: "2026-09-25" } });
    stubs.fetch.mockResolvedValueOnce(response(datePage([dateMatch(60, 2)], 60)));
    fireEvent.keyDown(screen.getByLabelText("依評估日期查找"), { key: "Enter" });
    await waitFor(() => expect(button("查看評估")).not.toBeDisabled());
    expect(screen.getByText("找到 60 筆，已顯示 1 筆。")).toBeVisible();
    const query = new URL(stubs.fetch.mock.calls[0]![0] as string, "https://example.invalid").searchParams;
    expect(query.get("mode")).toBe("by_date"); expect(query.get("assessed_on")).toBe("2026-09-25");
    expect(query.get("client_id")).toBe(clientId);
    stubs.fetch.mockResolvedValueOnce(response(history(60, [2, 1])));
    fireEvent.click(button("查看評估"));
    await waitFor(() => expect(screen.getByText("查看草稿 v2")).toBeVisible());
    expect(screen.getByRole("form", { name: `${form.title}填寫表單` })).toHaveFocus();
    expect(posts()).toHaveLength(0);
  });

  it("asks for a fresh date lookup when the result set changes between pages", async () => {
    workspace();
    fireEvent.change(screen.getByLabelText("依評估日期查找"), { target: { value: "2026-09-25" } });
    stubs.fetch.mockResolvedValueOnce(response(datePage(
      Array.from({ length: 20 }, (_, index) => dateMatch(60 - index)), 60,
      { createdAt: stamp, assessmentKey: key(41) },
    )));
    fireEvent.click(button("查找"));
    await waitFor(() => expect(button("載入更多同日評估")).not.toBeDisabled());
    stubs.fetch.mockResolvedValueOnce(response(datePage(
      Array.from({ length: 20 }, (_, index) => dateMatch(40 - index)), 61,
      { createdAt: stamp, assessmentKey: key(21) },
    )));
    fireEvent.click(button("載入更多同日評估"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("查找結果已有更新，請重新查找。"));
    expect(screen.queryByRole("button", { name: "查看評估" })).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("does not open a changed version returned after a date match", async () => {
    workspace();
    fireEvent.change(screen.getByLabelText("依評估日期查找"), { target: { value: "2026-09-25" } });
    stubs.fetch.mockResolvedValueOnce(response(datePage([dateMatch(60, 2)])));
    fireEvent.click(button("查找"));
    await waitFor(() => expect(button("查看評估")).not.toBeDisabled());
    stubs.fetch.mockResolvedValueOnce(response(history(60, [3, 2, 1])));
    fireEvent.click(button("查看評估"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("這筆評估已有更新"));
    expect(screen.getByText("修訂草稿 v1")).toBeVisible();
    expect(posts()).toHaveLength(0);
  });

  it("keeps no-match, read failure, and a changed exact version separate without clearing unsaved answers", async () => {
    workspace();
    const date = screen.getByLabelText("依評估日期查找");
    const first = within(questionGroup(1)).getByRole("radio", { name: form.questions[0]!.choices[1]!.label });
    fireEvent.click(first);
    fireEvent.change(date, { target: { value: "2026-09-25" } });
    stubs.fetch.mockResolvedValueOnce(response(datePage([], 0)));
    fireEvent.click(button("查找"));
    await waitFor(() => expect(screen.getByText("這一天沒有已保存的評估。")).toBeVisible());
    expect(first).toBeChecked();
    stubs.fetch.mockRejectedValueOnce(new Error("network unavailable"));
    fireEvent.click(button("查找"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("暫時無法依日期查找"));
    expect(screen.queryByText("這一天沒有已保存的評估。")).toBeNull();
    expect(first).toBeChecked();
    stubs.fetch.mockResolvedValueOnce(response(datePage([dateMatch(60, 2)])));
    fireEvent.click(button("查找"));
    await waitFor(() => expect(button("查看評估")).not.toBeDisabled());
    fireEvent.click(button("查看評估"));
    expect(screen.getByText("放棄尚未保存的修改？")).toBeVisible();
    fireEvent.click(button("繼續填寫"));
    expect(first).toBeChecked(); expect(posts()).toHaveLength(0);
  });

  it("freezes uncertain saves and retries the same body/key without allowing assessment switches", async () => {
    workspace(); stubs.fetch.mockRejectedValueOnce(new Error("連線中斷"));
    fireEvent.click(button("保存修訂版本"));
    await waitFor(() => expect(button("以相同內容重試")).toBeTruthy());
    expect(screen.getByLabelText("評估日期")).toBeDisabled(); expect(button("新增一次評估")).toBeDisabled();
    expect(screen.getByLabelText("個案")).toBeDisabled(); expect(hasPendingOperations()).toBe(true);
    stubs.fetch.mockResolvedValueOnce(response(receipt("revise", 1, 2))).mockResolvedValueOnce(response(history(1, [2, 1]))).mockResolvedValueOnce(response(page()));
    fireEvent.click(button("以相同內容重試"));
    await waitFor(() => expect(screen.getByText("草稿已保存並讀回；尚未簽署。")).toBeTruthy());
    const calls = posts(); expect(calls).toHaveLength(2);
    expect(calls[0]![1].body).toBe(calls[1]![1].body);
    expect(calls[0]![1].headers["idempotency-key"]).toBe(calls[1]![1].headers["idempotency-key"]);
    expect(hasPendingOperations()).toBe(false);
  });

  it("keeps one mobile save action with visible uncertain-save feedback", async () => {
    workspace();
    const save = button("保存修訂版本");
    expect(save.closest("form")?.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    expect(save.parentElement?.className).toContain("mobileSaveActions");
    stubs.fetch.mockRejectedValueOnce(new Error("連線中斷"));
    fireEvent.click(save);
    await waitFor(() => expect(button("以相同內容重試")).toBeVisible());
    const retry = button("以相同內容重試");
    expect(retry.closest("form")?.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    expect(within(retry.parentElement!).getByRole("status")).toHaveTextContent("原操作結果尚未完整確認");
    expect(posts()).toHaveLength(1);
  });

  it("never posts again when the commit succeeded but readback failed", async () => {
    workspace(); stubs.fetch.mockResolvedValueOnce(response(receipt("revise", 1, 2))).mockRejectedValueOnce(new Error("讀取中斷"));
    fireEvent.click(button("保存修訂版本"));
    await waitFor(() => expect(button("重新讀取已保存紀錄")).toBeTruthy());
    expect(button("新增一次評估")).toBeDisabled(); expect(button("保存修訂版本")).toBeDisabled();
    stubs.fetch.mockResolvedValueOnce(response(history(1, [2, 1]))).mockResolvedValueOnce(response(page()));
    fireEvent.click(button("重新讀取已保存紀錄"));
    await waitFor(() => expect(screen.getByText("草稿已保存並讀回；尚未簽署。")).toBeTruthy());
    expect(posts()).toHaveLength(1);
  });

  it("asks before discarding edits and preserves them when the user continues", () => {
    workspace(); fireEvent.click(within(questionGroup(1)).getByLabelText("答錯"));
    fireEvent.click(button("新增一次評估"));
    expect(screen.getByRole("dialog", { name: "放棄尚未保存的修改？" })).toBeTruthy();
    fireEvent.click(button("繼續填寫"));
    expect(within(questionGroup(1)).getByLabelText("答錯")).toBeChecked();
    fireEvent.click(button("新增一次評估")); fireEvent.click(button("放棄修改並切換"));
    expect(screen.getAllByRole("radio").every((element) => !(element as HTMLInputElement).checked)).toBe(true);
    expect(button("保存本次評估")).toBeTruthy();
  });

  it("retries the failed assessment page rather than accidentally loading a different history", async () => {
    const snapshot = defaultSnapshot(); workspace({ ...snapshot, clients: [{ ...snapshot.clients[0]!, assessmentTotal: 3, nextAssessmentCursor: { createdAt: stamp, assessmentKey: key(2) } }] });
    stubs.fetch.mockRejectedValueOnce(new Error("頁面中斷")); fireEvent.click(button("載入較早評估"));
    await waitFor(() => expect(button("重新讀取歷程")).toBeTruthy());
    stubs.fetch.mockResolvedValueOnce(response(page([assessment(3)], 3))); fireEvent.click(button("重新讀取歷程"));
    await waitFor(() => expect(screen.getByRole("option", { name: /評估人員 3/ })).toBeTruthy());
    expect(stubs.fetch.mock.calls[0]![0]).toBe(stubs.fetch.mock.calls[1]![0]);
  });

  it("makes read-only accounts unable to create or revise any historical record", async () => {
    workspace(defaultSnapshot(), false); expect(screen.queryByRole("button", { name: "新增一次評估" })).toBeNull();
    expect(screen.queryByRole("button", { name: "修訂此草稿" })).toBeNull(); expect(screen.getByLabelText("評估日期")).toBeDisabled();
    stubs.fetch.mockResolvedValueOnce(response(history())); fireEvent.click(button("查看版本歷程"));
    await waitFor(() => expect(button("查看 v1")).toBeTruthy());
    expect(posts()).toHaveLength(0);
  });

  it("does not preview or save an MNA total when the BMI answer contradicts measurement context", () => {
    const mna = QUESTIONNAIRE_FORMS.mna_sf;
    const snapshot: QuestionnaireSnapshot = { ...defaultSnapshot(), formKey: "mna_sf", clients: [{ ...defaultSnapshot().clients[0]!, latest: null, assessments: [], assessmentTotal: 0 }] };
    workspace(snapshot, true, mna);
    fireEvent.change(screen.getByLabelText("身高（公分）"), { target: { value: "160" } });
    fireEvent.change(screen.getByLabelText("體重（公斤）"), { target: { value: "48" } });
    fireEvent.click(screen.getByLabelText("BMI ≥ 23・3 分"));
    const measurements = screen.getByText("身體測量（MNA-SF）").closest("fieldset")!;
    expect(within(measurements).getByRole("alert").textContent).toContain("實測值不符");
    expect(screen.getByText("計分預覽：尚未完整作答")).toBeTruthy();
    fireEvent.click(button("保存本次評估"));
    expect(document.activeElement).toBe(measurements);
    expect(screen.getByLabelText("身高（公分）")).toHaveValue(160);
    expect(screen.getByLabelText("體重（公斤）")).toHaveValue(48);
    expect(stubs.fetch).not.toHaveBeenCalled();
  });

  it("requires shared explicit discard before a Link can unmount a dirty draft, without native confirm", async () => {
    const view = workspace(); const navigate = vi.fn();
    render(<Link href="/app/staff/other" onClick={(event) => { event.preventDefault(); navigate(); }}>側欄切頁</Link>);
    fireEvent.click(within(questionGroup(1)).getByLabelText("答錯"));
    fireEvent.click(screen.getByRole("link", { name: "側欄切頁" }));
    expect(window.confirm).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
    expect(within(questionGroup(1)).getByLabelText("答錯")).toBeChecked();
    fireEvent.click(button("放棄修改並切換"));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    view.unmount();
  });

  it("does not block new-tab source links or same-page hashes that keep the draft mounted", () => {
    workspace(); const navigate = vi.fn();
    render(<><a href="/app/staff/other" target="_blank" onClick={(event) => { event.preventDefault(); navigate(); }}>另開分頁</a>
      <a href="#details" onClick={(event) => { event.preventDefault(); navigate(); }}>同頁段落</a></>);
    fireEvent.click(within(questionGroup(1)).getByLabelText("答錯"));
    fireEvent.click(screen.getByRole("link", { name: "另開分頁" })); fireEvent.click(screen.getByRole("link", { name: "同頁段落" }));
    expect(navigate).toHaveBeenCalledTimes(2); expect(window.confirm).not.toHaveBeenCalled();
  });

  it("blocks sidebar unmount and history traversal throughout an unknown 503 save, then confirms the same operation", async () => {
    const view = workspace(); const navigate = vi.fn(() => view.unmount());
    render(<Link href="/app/staff/other" onClick={(event) => { event.preventDefault(); navigate(); }}>側欄切頁</Link>);
    stubs.fetch.mockResolvedValueOnce(response(null, 503)); fireEvent.click(button("保存修訂版本"));
    await waitFor(() => expect(button("以相同內容重試")).toBeTruthy());
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("link", { name: "側欄切頁" })); expect(navigate).not.toHaveBeenCalled(); expect(window.confirm).not.toHaveBeenCalled();
    const nextRouterPopstate = vi.fn(); window.addEventListener("popstate", nextRouterPopstate);
    const restore = vi.spyOn(window.history, "pushState");
    try {
      fireEvent(window, new PopStateEvent("popstate", { state: { __NA: true, destination: "other" } }));
      // Unsupported, noncancelable traversal cannot be universally blocked;
      // shared guards never rewrite Next's opaque history or store values.
      expect(nextRouterPopstate).toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
      stubs.fetch.mockResolvedValueOnce(response(receipt("revise", 1, 2))).mockResolvedValueOnce(response(history(1, [2, 1]))).mockResolvedValueOnce(response(page()));
      fireEvent.click(button("以相同內容重試"));
      await waitFor(() => expect(screen.getByText("草稿已保存並讀回；尚未簽署。")).toBeTruthy());
      const calls = posts(); expect(calls[0]![1].body).toBe(calls[1]![1].body);
      expect(calls[0]![1].headers["idempotency-key"]).toBe(calls[1]![1].headers["idempotency-key"]);
      fireEvent.click(screen.getByRole("link", { name: "側欄切頁" })); expect(navigate).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener("popstate", nextRouterPopstate); }
  });

  it("uses a beforeunload warning for unsupported history without rewriting opaque Next state", () => {
    const state = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { opaque: "test-router-state" } };
    window.history.replaceState(state, "", window.location.href); workspace();
    const nextRouter = vi.fn(); window.addEventListener("popstate", nextRouter);
    const restore = vi.spyOn(window.history, "pushState");
    fireEvent.click(within(questionGroup(1)).getByLabelText("答錯"));
    try {
      fireEvent(window, new PopStateEvent("popstate", { state: { __NA: true } }));
      expect(nextRouter).toHaveBeenCalledTimes(1); expect(restore).not.toHaveBeenCalled();
      expect(fireEvent(window, new Event("beforeunload", { cancelable: true }))).toBe(false);
      expect(window.history.state).toEqual(state); expect(window.confirm).not.toHaveBeenCalled();
    } finally { window.removeEventListener("popstate", nextRouter); }
  });

  it("cannot discard through an already-open switch confirmation while a POST is pending", async () => {
    workspace(); fireEvent.click(within(questionGroup(1)).getByLabelText("答錯"));
    fireEvent.click(button("新增一次評估"));
    let resolve!: (value: Response) => void;
    stubs.fetch.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    fireEvent.click(button("保存修訂版本"));
    expect(button("放棄修改並切換")).toBeDisabled(); fireEvent.click(button("放棄修改並切換"));
    expect(screen.queryByRole("button", { name: "保存本次評估" })).toBeNull();
    resolve(response(null, 503)); await waitFor(() => expect(button("以相同內容重試")).toBeTruthy());
    expect(button("放棄修改並切換")).toBeDisabled();
  });

  it("blocks the native client-selection submit while dirty or uncertain, even if its action button is enabled", () => {
    workspace(); fireEvent.click(within(questionGroup(1)).getByLabelText("答錯"));
    const clientForm = screen.getByLabelText("個案").closest("form")!;
    expect(fireEvent.submit(clientForm)).toBe(false);
  });

  it("disables editing during a history load so completion cannot replace new input", async () => {
    workspace(); let resolve!: (value: Response) => void;
    stubs.fetch.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    fireEvent.change(screen.getByLabelText("選擇已保存評估"), { target: { value: key(2) } });
    expect(screen.getByLabelText("評估日期")).toBeDisabled(); expect(button("保存修訂版本")).toBeDisabled();
    resolve(response(history(2))); await waitFor(() => expect(button("查看 v1")).toBeTruthy());
  });

  it("never displays undefined version numbers or invites saving in an empty read-only demo", () => {
    const snapshot = defaultSnapshot(); workspace({ ...snapshot, demo: true, clients: [{ ...snapshot.clients[0]!, latest: null, assessments: [], assessmentTotal: 0 }] }, false);
    expect(screen.getByText("展示版")).toBeVisible();
    expect(screen.getByText("不可保存／簽署")).toBeVisible();
    expect(screen.getAllByText("尚未保存").length).toBeGreaterThan(0);
    expect(screen.queryByText(/vundefined/)).toBeNull(); expect(screen.queryByText(/請填寫下方量表保存/)).toBeNull();
  });
});
