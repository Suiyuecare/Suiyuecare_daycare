// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
vi.mock("server-only", () => ({}));
const shell = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/staff/assessments/spmsq",
  useRouter: () => ({ replace: shell.replace, refresh: shell.refresh }) }));
vi.mock("@/lib/offline/draft-store", () => ({ clearOfflineDrafts: async () => {} }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabaseClient: () => ({ auth: { signOut: shell.signOut } }) }));
vi.mock("@/components/app/branch-switcher", () => ({ BranchSwitcher: () => <span>合成分支選單</span> }));

import { AppShell } from "@/components/app/app-shell";
import { hasPendingOperations, hasViewTransition } from "@/lib/navigation/pending-operation-lock";
import { clearUnsavedChangesOnLogout } from "@/lib/navigation/unsaved-changes";
import { parseQuestionnaireMutation } from "@/lib/questionnaire-assessments/mutation-contract";
import { clearQuestionnairePendingOnLogout, getQuestionnairePending } from "@/lib/questionnaire-assessments/pending";
import { clearQuestionnaireViewOnLogout, getQuestionnaireViewState, questionnaireViewAuthority } from "@/lib/questionnaire-assessments/readiness-view";
import { QuestionnaireAssessmentsWorkspace } from "./questionnaire-assessment-editor";
import { context, deferred, ids, savedFixture } from "./questionnaire-readiness-test-fixtures";

const network = vi.fn<typeof fetch>();
const actor: TenantContext = { ...context, assuranceLevel: "aal1" };
let sequence = 0;
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-09-27T10:00:00Z") + ++sequence * 120_000);
  vi.stubGlobal("fetch", network); network.mockReset(); vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SYNTHETIC_PREVIEW", "false");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  shell.signOut.mockResolvedValue({ error: null });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => {
  cleanup(); clearQuestionnairePendingOnLogout(); clearUnsavedChangesOnLogout(); clearQuestionnaireViewOnLogout();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  for (const [name, descriptor] of [["showModal", originalShowModal], ["close", originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
function tree(fixture = savedFixture(), current: TenantContext = actor, canManage = true) {
  return <AppShell context={current} navigation={[]}><QuestionnaireAssessmentsWorkspace context={current}
    assessorName={current.displayName} canManage={canManage} form={fixture.form} loadError={false}
    pageTitle={fixture.form.title} selectedClientId={ids.clientId} snapshot={fixture.snapshot} /></AppShell>;
}
function changeAnswers() {
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "第 1 題" })).getByLabelText("答錯"));
  fireEvent.change(screen.getByLabelText(/補充觀察與後續事項/u), { target: { value: "SYNTHETIC_ORIGINAL_WIRE_NOTE" } });
}
function originalVisible() {
  expect(within(screen.getByRole("radiogroup", { name: "第 1 題" })).getByLabelText("答錯")).toBeChecked();
  expect(screen.getByDisplayValue("SYNTHETIC_ORIGINAL_WIRE_NOTE")).toBeInTheDocument();
}
async function unknown() {
  changeAnswers(); fireEvent.click(screen.getByRole("button", { name: "保存修訂版本" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "確認保存結果" })).toBeInTheDocument());
  expect(hasPendingOperations()).toBe(true);
  return network.mock.calls.find(([, init]) => init?.method === "POST")![1]!;
}
const envelope = (data: unknown) => ({ requestId: ids.requestId, status: "ok", data, errors: [] });
function originalResult(post: RequestInit) {
  const wire = JSON.parse(String(post.body)), headers = new Headers(post.headers);
  const normalized = parseQuestionnaireMutation(wire, headers.get("idempotency-key")!)!;
  const receipt = { action: normalized.action, clientId: normalized.client_id, formKey: normalized.form_key,
    assessmentKey: normalized.assessment_key ?? ids.assessmentKey, versionId: ids.otherId,
    version: (normalized.expected_version ?? 0) + 1, recordState: "draft", assessedOn: normalized.assessed_on,
    contentHash: "b".repeat(64), committedAt: new Date(Date.now()).toISOString(), replayed: false };
  const draft = { assessmentKey: receipt.assessmentKey, versionId: receipt.versionId, version: receipt.version,
    formVersion: normalized.form_version, assessedOn: normalized.assessed_on, answers: normalized.answers,
    context: normalized.context, recordState: "draft", authorDisplayName: "SYNTHETIC_ORIGINAL_AUTHOR",
    createdAt: receipt.committedAt, contentHash: receipt.contentHash };
  const request = { action: normalized.action, client_id: normalized.client_id, form_key: normalized.form_key,
    form_version: normalized.form_version, assessed_on: normalized.assessed_on, answers: normalized.answers,
    context: normalized.context, assessment_key: normalized.assessment_key ?? null,
    previous_version_id: normalized.previous_version_id ?? null, expected_version: normalized.expected_version ?? 0 };
  return { wire, receipt, draft, request };
}
function proof(init: RequestInit, post: RequestInit, status: "committed" | "not_found", current = actor) {
  const headers = new Headers(init.headers), result = originalResult(post);
  return envelope({ schemaVersion: 1, status, organizationId: current.organizationId, branchId: current.branchId,
    actorUserId: current.userId, formKey: "spmsq", clientId: ids.clientId, action: "revise",
    idempotencyKey: headers.get("idempotency-key"), nonce: headers.get("x-questionnaire-receipt-nonce"),
    verifiedAt: new Date(Date.now()).toISOString(), persisted: status === "committed", demo: false,
    receipt: status === "committed" ? result.receipt : null, request: status === "committed" ? result.request : null,
    draft: status === "committed" ? result.draft : null });
}
function history(post: RequestInit, present = true) {
  return envelope({ formKey: "spmsq", clientId: ids.clientId, assessmentKey: ids.assessmentKey,
    versions: present ? [originalResult(post).draft] : [], total: 2, nextBeforeVersion: null });
}
function hiddenClinical() {
  expect(screen.getByRole("heading", { name: "評估資料需要重新確認" })).toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("SYNTHETIC_ORIGINAL_WIRE_NOTE")).not.toBeInTheDocument();
  expect(screen.queryByText(/SYNTHETIC_SAVED_AUTHOR/u)).not.toBeInTheDocument();
}
function currentJournal() {
  return getQuestionnairePending({ authority: questionnaireViewAuthority(actor)!, epoch: getQuestionnaireViewState().epoch,
    organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId, clientId: ids.clientId, formKey: "spmsq" });
}

describe("questionnaire original operation recovery through actual shell, journal and transport", () => {
  it("retains the admitted owner while a normal questionnaire takes longer than one minute", async () => {
    network.mockResolvedValue(Response.json({}, { status: 503 })); const fixture = savedFixture(), view = render(tree(fixture));
    changeAnswers(); act(() => { vi.setSystemTime(Date.now() + 65_000); }); view.rerender(tree(fixture));
    originalVisible(); expect(network).not.toHaveBeenCalled(); expect(hasPendingOperations()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "保存修訂版本" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "確認保存結果" })).toBeInTheDocument());
    expect(network).toHaveBeenCalledOnce(); expect(network.mock.calls[0]![1]?.method).toBe("POST");
    expect(JSON.parse(String(network.mock.calls[0]![1]?.body))).toMatchObject({ previousVersionId: ids.versionId,
      expectedVersion: 1, context: { qualitative_note: "SYNTHETIC_ORIGINAL_WIRE_NOTE" } });
    expect(hasPendingOperations()).toBe(true);
  });
  it("an unchanged admitted unknown owner remains available for manual receipt read after one minute", async () => {
    network.mockResolvedValue(Response.json({}, { status: 503 })); const fixture = savedFixture(), view = render(tree(fixture));
    const post = await unknown(); act(() => { vi.setSystemTime(Date.now() + 65_000); }); view.rerender(tree(fixture));
    originalVisible(); expect(network).toHaveBeenCalledOnce(); expect(hasPendingOperations()).toBe(true);
    network.mockImplementation(async (_input, init) => Response.json(proof(init!, post, "not_found")));
    fireEvent.click(screen.getByRole("button", { name: "確認保存結果" }));
    await waitFor(() => expect(screen.getByText(/尚未查到這次保存/u)).toBeInTheDocument());
    expect(network).toHaveBeenCalledTimes(2); expect(network.mock.calls[1]![1]?.method).toBe("GET");
    expect(network.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(hasPendingOperations()).toBe(true); expect(hasViewTransition()).toBe(false);
  });
  it("never treats a stale initial SSR source as an already admitted owner", () => {
    const fixture = savedFixture(); vi.setSystemTime(Date.now() + 65_000); render(tree(fixture));
    hiddenClinical(); expect(network).not.toHaveBeenCalled(); expect(hasPendingOperations()).toBe(false);
  });
  it("retains original answers, bytes and key across unmount without an automatic POST", async () => {
    network.mockResolvedValue(Response.json({}, { status: 503 }));
    const fixture = savedFixture(), view = render(tree(fixture)); const post = await unknown();
    view.unmount(); expect(hasPendingOperations()).toBe(true);
    vi.setSystemTime(Date.now() + 1);
    render(tree(savedFixture("spmsq", { version: 5, context: { education_adjustment: "middle_or_high_school",
      qualitative_note: "SYNTHETIC_OTHER_SSR_NOTE" } })));
    originalVisible(); expect(screen.queryByDisplayValue("SYNTHETIC_OTHER_SSR_NOTE")).not.toBeInTheDocument();
    expect(network).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "以相同內容重試" }));
    await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    expect(network.mock.calls[1]![1]?.body).toBe(post.body);
    expect(new Headers(network.mock.calls[1]![1]?.headers).get("idempotency-key")).toBe(new Headers(post.headers).get("idempotency-key"));
  });
  it("one manual not_found GET keeps unknown lease and never creates or retries a write", async () => {
    network.mockResolvedValue(Response.json({}, { status: 503 })); render(tree()); const post = await unknown();
    network.mockImplementation(async (_input, init) => Response.json(proof(init!, post, "not_found")));
    fireEvent.click(screen.getByRole("button", { name: "確認保存結果" }));
    await waitFor(() => expect(screen.getByText(/尚未查到這次保存/u)).toBeInTheDocument());
    expect(network).toHaveBeenCalledTimes(2); expect(network.mock.calls[1]![0]).toBe("/api/questionnaire-assessments/receipt");
    expect(network.mock.calls[1]![1]?.method).toBe("GET"); expect(network.mock.calls[1]![1]?.body).toBeUndefined();
    expect(new Headers(network.mock.calls[1]![1]?.headers).get("idempotency-key")).toBe(new Headers(post.headers).get("idempotency-key"));
    expect(hasPendingOperations()).toBe(true); expect(hasViewTransition()).toBe(false);
    expect(screen.getByRole("button", { name: "新增一次評估" })).toBeDisabled(); originalVisible();
  });
  it("positive original receipt without exact original history still forbids another write across remount", async () => {
    network.mockResolvedValue(Response.json({}, { status: 503 })); const fixture = savedFixture(), view = render(tree(fixture));
    const post = await unknown();
    network.mockImplementation(async (input, init) => Response.json(String(input).endsWith("/receipt") ? proof(init!, post, "committed") : history(post, false)));
    fireEvent.click(screen.getByRole("button", { name: "確認保存結果" }));
    await waitFor(() => expect(screen.getByText(/尚未包含原保存版本/u)).toBeInTheDocument());
    expect(network).toHaveBeenCalledTimes(4); expect(network.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(new URL(String(network.mock.calls[3]![0]), "https://synthetic.invalid").searchParams.get("before_version")).toBe("3");
    expect(screen.getByRole("button", { name: "新增一次評估" })).toBeDisabled();
    view.unmount(); render(tree(fixture));
    expect(screen.getByRole("button", { name: "新增一次評估" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重新讀取已保存紀錄" })).toBeInTheDocument();
    expect(network).toHaveBeenCalledTimes(4);
  });
  it("201 correlated thin receipt requires positive exact history before new work", async () => {
    let post!: RequestInit;
    network.mockImplementation(async (_input, init) => {
      if (init?.method === "POST") { post = init; return Response.json(envelope(originalResult(post).receipt), { status: 201 }); }
      return Response.json(history(post, false));
    });
    render(tree()); changeAnswers(); fireEvent.click(screen.getByRole("button", { name: "保存修訂版本" }));
    await waitFor(() => expect(screen.getByText(/尚未包含原保存版本/u)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "新增一次評估" })).toBeDisabled();
    network.mockImplementation(async input => Response.json(String(input).includes("mode=versions") ? history(post) :
      envelope({ formKey: "spmsq", clientId: ids.clientId, assessments: [], total: 0, nextCursor: null })));
    fireEvent.click(screen.getByRole("button", { name: "重新讀取已保存紀錄" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "新增一次評估" })).toBeEnabled());
    expect(network.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(screen.getByText("修訂草稿 v2")).toBeInTheDocument();
  });
  it.each([
    ["error status", { status: "error" }],
    ["nonempty errors", { errors: [{ code: "SYNTHETIC_PROVIDER_SECRET" }] }],
    ["invalid request ID", { requestId: "SYNTHETIC_INVALID_ID" }],
  ])("an exact history row in an HTTP200 envelope with %s is quarantined, not proof", async (_name, invalid) => {
    network.mockResolvedValue(Response.json({}, { status: 503 })); const view = render(tree()); const post = await unknown();
    let confirmedBeforeMalformedRead = false;
    network.mockImplementation(async (input, init) => {
      if (String(input).endsWith("/receipt")) return Response.json(proof(init!, post, "committed"));
      confirmedBeforeMalformedRead = currentJournal().confirmed.length === 1;
      return Response.json({ ...history(post), ...invalid });
    });
    fireEvent.click(screen.getByRole("button", { name: "確認保存結果" }));
    await waitFor(hiddenClinical); expect(confirmedBeforeMalformedRead).toBe(true);
    expect(network.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(screen.queryByText(/SYNTHETIC_PROVIDER_SECRET|SYNTHETIC_INVALID_ID/u)).not.toBeInTheDocument();
    // Privacy projection hides proof during denial, without discarding its
    // original-history gate. A genuinely newer source must still resolve it.
    expect(currentJournal().confirmed).toHaveLength(0);
    act(() => { vi.setSystemTime(Date.now() + 1); }); view.rerender(tree(savedFixture()));
    expect(currentJournal().confirmed).toHaveLength(1);
    expect(screen.getByRole("button", { name: "新增一次評估" })).toBeDisabled();
    expect(network.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("manual read remains available after manage withdrawal and restores original unknown answers", async () => {
    network.mockResolvedValue(Response.json({}, { status: 503 })); const view = render(tree()); const post = await unknown();
    const readOnlyActor = { ...actor, scopes: actor.scopes.filter(scope => !scope.endsWith(".manage")) };
    vi.setSystemTime(Date.now() + 1);
    view.rerender(tree(savedFixture("spmsq", { context: { education_adjustment: "middle_or_high_school",
      qualitative_note: "SYNTHETIC_OTHER_SSR_NOTE" } }), readOnlyActor, false));
    originalVisible(); expect(screen.queryByDisplayValue("SYNTHETIC_OTHER_SSR_NOTE")).not.toBeInTheDocument();
    network.mockImplementation(async (_input, init) => Response.json(proof(init!, post, "not_found", readOnlyActor)));
    fireEvent.click(screen.getByRole("button", { name: "確認保存結果" }));
    await waitFor(() => expect(screen.getByText(/尚未查到這次保存/u)).toBeInTheDocument());
    expect(network.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(hasPendingOperations()).toBe(true);
  });
  it.each([401, 403])("receipt denial %i hides all clinical content without clearing the unknown operation", async status => {
    network.mockResolvedValue(Response.json({}, { status: 503 })); render(tree()); await unknown();
    network.mockResolvedValue(Response.json({ providerSecret: "MUST_NOT_RENDER" }, { status }));
    fireEvent.click(screen.getByRole("button", { name: "確認保存結果" }));
    await waitFor(hiddenClinical); expect(hasPendingOperations()).toBe(true);
    expect(screen.queryByText("MUST_NOT_RENDER")).not.toBeInTheDocument();
  });
  it("authority A to B to A does not restore retained old SSR or consume late original proof", async () => {
    network.mockResolvedValue(Response.json({}, { status: 503 })); const fixture = savedFixture(), view = render(tree(fixture));
    const post = await unknown(), late = deferred<Response>();
    network.mockReturnValue(late.promise); fireEvent.click(screen.getByRole("button", { name: "確認保存結果" }));
    await waitFor(() => expect(network).toHaveBeenCalledTimes(2)); const get = network.mock.calls[1]![1]!;
    const denied = { ...actor, scopes: actor.scopes.filter(scope => scope !== "questionnaire_cognition.read") };
    view.rerender(tree(fixture, denied, false)); hiddenClinical(); view.rerender(tree(fixture)); hiddenClinical();
    await act(async () => { late.resolve(Response.json(proof(get, post, "committed"))); await Promise.resolve(); });
    hiddenClinical(); expect(network).toHaveBeenCalledTimes(2); expect(hasPendingOperations()).toBe(true);
  });
  it("shared unsaved cancel preserves answers, restores trigger focus and never calls native confirm", () => {
    const confirm = vi.spyOn(window, "confirm"); render(tree()); changeAnswers();
    expect(hasPendingOperations()).toBe(false);
    const trigger = screen.getByRole("button", { name: "新增一次評估" }); trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "放棄尚未保存的修改？" })).toBeInTheDocument();
    const cancel = screen.getByRole("button", { name: "繼續填寫" }); expect(cancel).toHaveFocus(); fireEvent.click(cancel);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
    originalVisible(); expect(confirm).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
});
