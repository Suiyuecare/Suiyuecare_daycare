// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { CLIENT_WRITE_TIMEOUT_MS } from "@/lib/api/client-fetch";
vi.mock("server-only", () => ({}));
const shell = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), signOut: vi.fn(),
  writeReleases: [] as (() => void)[] }));
vi.mock("next/navigation", () => {
  const router = { replace: shell.replace, refresh: shell.refresh };
  return { usePathname: () => "/app/staff/assessments/spmsq", useRouter: () => router };
});
vi.mock("@/lib/offline/draft-store", () => ({ clearOfflineDrafts: async () => {} }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabaseClient: () => ({ auth: { signOut: shell.signOut } }) }));
vi.mock("@/components/app/branch-switcher", () => ({ BranchSwitcher: () => <span>合成分支選單</span> }));
vi.mock("@/lib/navigation/pending-operation-lock", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/navigation/pending-operation-lock")>();
  return { ...actual, tryAcquirePendingOperation: () => {
    const release = actual.tryAcquirePendingOperation();
    if (release) shell.writeReleases.push(release);
    return release;
  } };
});
import { AppShell } from "@/components/app/app-shell";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { clearQuestionnaireViewOnLogout, getQuestionnaireViewState } from "@/lib/questionnaire-assessments/readiness-view";
import { clearQuestionnairePendingOnLogout } from "@/lib/questionnaire-assessments/pending";
import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import { QuestionnaireAssessmentsWorkspace } from "./questionnaire-assessment-editor";
import { context, deferred, formKeys, ids, readinessEnvelope, savedFixture } from "./questionnaire-readiness-test-fixtures";

const network = vi.fn<typeof fetch>();
let sequence = 0;
const leases: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-09-27T03:00:00.000Z") + ++sequence * 120_000);
  vi.stubGlobal("fetch", network); network.mockReset(); vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SYNTHETIC_PREVIEW", "false");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  shell.signOut.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup(); for (const release of leases.splice(0)) release();
  // Test isolation only: keep actual opaque write leases held throughout each
  // assertion, including a withdrawn owner whose result remains uncertain.
  for (const release of shell.writeReleases.splice(0)) release(); clearQuestionnairePendingOnLogout(); clearQuestionnaireViewOnLogout();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});
function tree(fixture = savedFixture(), actor: TenantContext = context, canManage = true, selectedClientId = ids.clientId) {
  return <AppShell context={actor} navigation={[]}><QuestionnaireAssessmentsWorkspace
    context={actor} assessorName={actor.displayName} canManage={canManage} form={fixture.form}
    loadError={false} pageTitle={fixture.form.title} selectedClientId={selectedClientId} snapshot={fixture.snapshot} /></AppShell>;
}
const panel = () => screen.getByRole("region", { name: "已保存評估完成檢查" });
const inspect = () => screen.getByRole("button", { name: "檢查已保存評估" });
const firstQuestionGroup = () => screen.getByRole("radiogroup", { name: `1. ${QUESTIONNAIRE_FORMS.spmsq.questions[0]!.prompt}` });
function readiness(fixture = savedFixture(), actor = context, superseded = false) {
  network.mockImplementation(async input => Response.json(readinessEnvelope(String(input), fixture.draft, actor, superseded)));
}
async function check() {
  fireEvent.click(inspect());
  await waitFor(() => expect(within(panel()).getByText("題目已填齊")).toBeInTheDocument());
}
function hiddenClinical() {
  expect(screen.getByRole("heading", { name: "評估資料需要重新確認" })).toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "已保存評估完成檢查" })).not.toBeInTheDocument();
  expect(screen.queryByText("SYNTHETIC_CLIENT_NAME")).not.toBeInTheDocument();
  expect(screen.queryByText(/SYNTHETIC_SAVED_AUTHOR/u)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("SYNTHETIC_SAVED_NOTE")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "量表計分預覽" })).not.toBeInTheDocument();
}
function changeOriginalAnswers() {
  fireEvent.click(within(firstQuestionGroup()).getByLabelText("答錯"));
  fireEvent.change(screen.getByLabelText(/補充觀察與後續事項/u), { target: { value: "SYNTHETIC_UNSAVED_KEEP" } });
}
function preservedAnswers() {
  expect(within(firstQuestionGroup()).getByLabelText("答錯")).toBeChecked();
  expect(screen.getByDisplayValue("SYNTHETIC_UNSAVED_KEEP")).toBeInTheDocument();
    expect(inspect()).toBeDisabled();
}
function newerFixture() {
  vi.setSystemTime(Date.now() + 1);
  return savedFixture("spmsq", { version: 2, versionId: ids.otherId, contentHash: "b".repeat(64),
    context: { education_adjustment: "middle_or_high_school", qualitative_note: "SYNTHETIC_NEW_SSR_NOTE" } });
}
function withClientB(fixture = savedFixture()) {
  const other = savedFixture("spmsq", { version: 9, versionId: "5000000e-0000-4000-8000-000000000002",
    assessmentKey: "6000000f-0000-4000-8000-000000000002", contentHash: "c".repeat(64),
    context: { education_adjustment: "middle_or_high_school", qualitative_note: "SYNTHETIC_CLIENT_B_NOTE" } });
  return { ...fixture, snapshot: { ...fixture.snapshot, matchingTotal: 2, clients: [...fixture.snapshot.clients,
    { ...other.snapshot.clients[0]!, clientId: ids.otherId, displayName: "SYNTHETIC_CLIENT_B_NAME" }] } };
}

describe("questionnaire readiness with the real workspace and authority shell", () => {
  it("adopts a newer verified same-client snapshot when no answers or write are pending", () => {
    const fixture = savedFixture();
    const view = render(tree(fixture));
    expect(screen.queryByRole("region", { name: "評估紀錄狀態" })).not.toBeInTheDocument();
    const incoming = newerFixture();
    view.rerender(tree(incoming));
    expect(screen.getByText("修訂草稿 v2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("SYNTHETIC_NEW_SSR_NOTE")).toBeInTheDocument();
    expect(screen.queryByText(/資料已有更新；本次填寫與原筆待確認操作已保留/u)).not.toBeInTheDocument();
    expect(network).not.toHaveBeenCalled();
  });
  it("does not show a retained-work warning after a clean demo snapshot refresh", () => {
    const fixture = savedFixture();
    const demoActor = { ...context, demo: true };
    const demoFixture = { ...fixture, snapshot: { ...fixture.snapshot, demo: true,
      clients: fixture.snapshot.clients.map(client => ({ ...client, latest: null, assessments: [], assessmentTotal: 0 })) } };
    const view = render(tree(demoFixture, demoActor, false));
    expect(screen.queryByRole("region", { name: "評估紀錄狀態" })).not.toBeInTheDocument();
    vi.setSystemTime(Date.now() + 1);
    view.rerender(tree({ ...demoFixture, snapshot: { ...demoFixture.snapshot, generatedAt: new Date().toISOString() } }, demoActor, false));
    expect(screen.queryByText(/資料已有更新；本次填寫與原筆待確認操作已保留/u)).not.toBeInTheDocument();
    expect(screen.getByText("展示版")).toBeVisible();
    expect(screen.getByText("不可保存／簽署")).toBeVisible();
    expect(network).not.toHaveBeenCalled();
  });
  it.each(["identical clone", "new saved baseline"])("preserves dirty answers and original revision target after SSR %s", async update => {
    const fixture = savedFixture(); const view = render(tree(fixture)); changeOriginalAnswers();
    const incoming = update === "identical clone" ? { ...fixture, snapshot: structuredClone(fixture.snapshot) } : newerFixture();
    view.rerender(tree(incoming)); preservedAnswers();
    if (update === "new saved baseline") expect(screen.getByText(/資料已有更新；本次填寫與原筆待確認操作已保留/u)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("SYNTHETIC_NEW_SSR_NOTE")).not.toBeInTheDocument();
    expect(screen.getByText("修訂草稿 v1")).toBeInTheDocument(); expect(network).not.toHaveBeenCalled();
    network.mockResolvedValue(Response.json({ errors: [] }, { status: 503 }));
    fireEvent.click(screen.getByRole("button", { name: "保存修訂版本" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeInTheDocument());
    expect(network).toHaveBeenCalledOnce();
    const body = JSON.parse(String(network.mock.calls[0]![1]?.body));
    expect(body).toMatchObject({ clientId: ids.clientId, previousVersionId: fixture.draft.versionId, expectedVersion: 1,
      answers: { spmsq_01: { state: "answered", value: "incorrect" } }, context: { qualitative_note: "SYNTHETIC_UNSAVED_KEEP" } });
    expect(hasPendingOperations()).toBe(true);
  });
  it.each(["identical clone", "new saved baseline"])("preserves an uncertain write body, key and lease after SSR %s", async update => {
    const fixture = savedFixture(); network.mockResolvedValue(Response.json({ errors: [] }, { status: 503 }));
    const view = render(tree(fixture)); changeOriginalAnswers(); fireEvent.click(screen.getByRole("button", { name: "保存修訂版本" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeInTheDocument());
    const first = network.mock.calls[0]![1]!;
    view.rerender(tree(update === "identical clone" ? { ...fixture, snapshot: structuredClone(fixture.snapshot) } : newerFixture()));
    preservedAnswers(); expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeInTheDocument();
    if (update === "new saved baseline") expect(screen.getByText(/資料已有更新；本次填寫與原筆待確認操作已保留/u)).toBeInTheDocument();
    expect(network).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "以相同內容重試" }));
    await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    expect(network.mock.calls[1]![1]?.body).toBe(first.body);
    expect(network.mock.calls[1]![1]?.headers).toEqual(first.headers); expect(hasPendingOperations()).toBe(true);
  });
  it.each(["dirty", "uncertain"])("keeps original client A when requested client passively changes to B while %s", async phase => {
    const fixture = withClientB(); const view = render(tree(fixture)); changeOriginalAnswers();
    network.mockResolvedValue(Response.json({ errors: [] }, { status: 503 }));
    if (phase === "uncertain") {
      fireEvent.click(screen.getByRole("button", { name: "保存修訂版本" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeInTheDocument());
    }
    const first = network.mock.calls[0]?.[1];
    view.rerender(tree(fixture, context, true, ids.otherId)); preservedAnswers();
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue(ids.clientId);
    expect(screen.queryByDisplayValue("SYNTHETIC_CLIENT_B_NOTE")).not.toBeInTheDocument();
    expect(screen.queryByText("修訂草稿 v9")).not.toBeInTheDocument();
    expect(screen.getByText(/仍在處理原個案/u)).toBeInTheDocument();
    expect(network).toHaveBeenCalledTimes(phase === "uncertain" ? 1 : 0);
    fireEvent.click(screen.getByRole("button", { name: phase === "uncertain" ? "以相同內容重試" : "保存修訂版本" }));
    await waitFor(() => expect(network).toHaveBeenCalledTimes(phase === "uncertain" ? 2 : 1));
    const current = network.mock.calls.at(-1)![1]!;
    expect(JSON.parse(String(current.body))).toMatchObject({ clientId: ids.clientId, previousVersionId: ids.versionId,
      context: { qualitative_note: "SYNTHETIC_UNSAVED_KEEP" } });
    if (first) { expect(current.body).toBe(first.body); expect(current.headers).toEqual(first.headers); }
    expect(hasPendingOperations()).toBe(true);
  });
  it.each(["dirty", "uncertain"])("hides withdrawn original client A even when requested B arrives while %s", async phase => {
    const fixture = withClientB(); const view = render(tree(fixture)); changeOriginalAnswers();
    if (phase === "uncertain") {
      network.mockResolvedValue(Response.json({ errors: [] }, { status: 503 }));
      fireEvent.click(screen.getByRole("button", { name: "保存修訂版本" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeInTheDocument());
    }
    vi.setSystemTime(Date.now() + 1);
    const withdrawn = { ...fixture, snapshot: { ...fixture.snapshot, generatedAt: new Date(Date.now()).toISOString(),
      matchingTotal: 1, clients: fixture.snapshot.clients.filter(client => client.clientId !== ids.clientId) } };
    view.rerender(tree(withdrawn, context, true, ids.otherId)); hiddenClinical();
    expect(screen.queryByDisplayValue("SYNTHETIC_CLIENT_B_NOTE")).not.toBeInTheDocument();
    expect(network).toHaveBeenCalledTimes(phase === "uncertain" ? 1 : 0);
    if (phase === "uncertain") expect(hasPendingOperations()).toBe(true);
  });
  it("changes form ownership from SPMSQ to GDS without retaining another form's saved baseline", () => {
    const fixture = savedFixture(); const view = render(tree(fixture)); vi.setSystemTime(Date.now() + 1);
    const gds = savedFixture("gds_15", { versionId: ids.otherId, version: 4,
      context: { qualitative_note: "SYNTHETIC_GDS_NOTE" } });
    view.rerender(tree(gds));
    expect(screen.getByRole("heading", { level: 2, name: "GDS-15 老人憂鬱量表" })).toBeInTheDocument();
    expect(screen.getByText("修訂草稿 v4")).toBeInTheDocument(); expect(screen.getByDisplayValue("SYNTHETIC_GDS_NOTE")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("SYNTHETIC_SAVED_NOTE")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/教育程度/u)).not.toBeInTheDocument(); expect(network).not.toHaveBeenCalled();
  });
  it.each(["", "2025-02-29", "2026-02-30", "2026-13-01", "2026-9-1", "1999-12-31", "2099-01-01"])("rejects date %j without POST, preserves answers and focuses the field", date => {
    render(tree()); changeOriginalAnswers(); const input = screen.getByLabelText("評估日期");
    fireEvent.change(input, { target: { value: date } }); fireEvent.click(screen.getByRole("button", { name: "保存修訂版本" }));
    expect(network).not.toHaveBeenCalled(); expect(input).toHaveFocus(); expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("請填寫有效評估日期"); preservedAnswers();
    expect(within(panel()).queryByText(/候選試算/u)).not.toBeInTheDocument();
  });
  it("accepts a valid historical leap day and keeps it exact in the submitted draft", async () => {
    network.mockResolvedValue(Response.json({ errors: [] }, { status: 503 })); render(tree()); changeOriginalAnswers();
    fireEvent.change(screen.getByLabelText("評估日期"), { target: { value: "2024-02-29" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修訂版本" }));
    await waitFor(() => expect(network).toHaveBeenCalledOnce());
    expect(JSON.parse(String(network.mock.calls[0]![1]?.body))).toMatchObject({ assessedOn: "2024-02-29",
      answers: { spmsq_01: { state: "answered", value: "incorrect" } } });
    expect(screen.getByLabelText("評估日期")).toHaveAttribute("aria-invalid", "false");
  });
  it.each(formKeys)("admits saved %s through AppShell and never sends a write", async key => {
    const fixture = savedFixture(key); readiness(fixture); render(tree(fixture)); await check();
    expect(network).toHaveBeenCalledOnce(); expect(network.mock.calls[0]![1]?.method).toBe("GET");
    expect(screen.getByRole("button", { name: "保存修訂版本" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /正式簽署/u })).not.toBeInTheDocument();
  });
  it.each(["answer", "date", "context", "note"])("hides a confirmed report immediately after a dirty %s change", async field => {
    const fixture = savedFixture(); readiness(fixture); render(tree(fixture)); await check();
    if (field === "answer") fireEvent.click(within(firstQuestionGroup()).getByLabelText("答錯"));
    else if (field === "date") fireEvent.change(screen.getByLabelText("評估日期"), { target: { value: "2026-09-25" } });
    else if (field === "context") fireEvent.change(screen.getByLabelText(/教育程度/u), { target: { value: "beyond_high_school" } });
    else fireEvent.change(screen.getByLabelText(/補充觀察與後續事項/u), { target: { value: "SYNTHETIC_UNSAVED_NOTE" } });
    expect(inspect()).toBeDisabled(); expect(within(panel()).queryByText("題目已填齊")).not.toBeInTheDocument();
    expect(within(panel()).queryByText(/候選試算/u)).not.toBeInTheDocument();
    expect(within(panel()).getByRole("status")).toHaveTextContent("內容已修改");
    fireEvent.click(inspect()); expect(network).toHaveBeenCalledOnce(); expect(hasPendingOperations()).toBe(false);
  });
  it.each([401, 403, "malformed", "forged score"] as const)("hides the whole clinical view after %s and rejects old SSR on remount", async failure => {
    const fixture = savedFixture();
    network.mockImplementation(async input => {
      if (typeof failure === "number") return Response.json({ error: "PRIVATE_PROVIDER_ERROR" }, { status: failure });
      if (failure === "malformed") return Response.json({ status: "ok", data: { secret: "PRIVATE_PROVIDER_ERROR" } });
      const envelope = readinessEnvelope(String(input), fixture.draft);
      return Response.json({ ...envelope, data: { ...envelope.data, candidate: { ...envelope.data.candidate,
        score: { ...envelope.data.candidate.score, adjusted: 999 } } } });
    });
    const view = render(tree(fixture)); fireEvent.click(inspect()); await waitFor(hiddenClinical);
    expect(screen.queryByText(/PRIVATE_PROVIDER_ERROR/u)).not.toBeInTheDocument();
    view.unmount(); render(tree(fixture)); hiddenClinical();
    expect(network).toHaveBeenCalledOnce(); expect(hasViewTransition()).toBe(false);
  });
  it("requires a newer source after denial; a fresh copied old snapshot does not restore it", async () => {
    const fixture = savedFixture(); network.mockResolvedValue(Response.json({}, { status: 403 }));
    const view = render(tree(fixture)); fireEvent.click(inspect()); await waitFor(hiddenClinical);
    view.rerender(tree({ ...fixture, snapshot: structuredClone(fixture.snapshot) })); hiddenClinical();
    vi.setSystemTime(Date.now() + 1); const newer = savedFixture(); readiness(newer); view.rerender(tree(newer));
    expect(inspect()).not.toBeDisabled(); await check(); expect(network).toHaveBeenCalledTimes(2);
  });
  it("preserves baseline during a transport failure without granting a score", async () => {
    network.mockRejectedValue(new TypeError("PRIVATE_NETWORK_PROVIDER_ERROR")); render(tree()); fireEvent.click(inspect());
    await waitFor(() => expect(within(panel()).getByRole("alert")).toHaveTextContent("暫時無法檢查"));
    expect(screen.getByDisplayValue("SYNTHETIC_SAVED_NOTE")).toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_NETWORK_PROVIDER_ERROR/u)).not.toBeInTheDocument();
    expect(within(panel()).queryByText(/候選試算/u)).not.toBeInTheDocument(); expect(inspect()).not.toBeDisabled();
  });
  it("tracks authority changes while the questionnaire route is unmounted and rejects A after A→B→A", () => {
    const fixture = savedFixture(), actorB = { ...context, scopes: ["clients.read"] };
    const view = render(tree(fixture)); expect(inspect()).not.toBeDisabled();
    view.rerender(<AppShell context={actorB} navigation={[]}><p>合成其他頁面</p></AppShell>);
    view.rerender(tree(fixture)); hiddenClinical(); expect(network).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 1); view.rerender(tree(savedFixture())); expect(inspect()).not.toBeDisabled();
  });
  it.each(["assignment", "same-time replacement", "older-source ABA"])("does not accept late readiness after %s", async boundary => {
    const fixture = savedFixture(), body = deferred<unknown>();
    network.mockImplementation(async () => { const response = Response.json({}); vi.spyOn(response, "json").mockReturnValue(body.promise); return response; });
    const view = render(tree(fixture)); fireEvent.click(inspect()); await waitFor(() => expect(network).toHaveBeenCalledOnce());
    const payload = readinessEnvelope(String(network.mock.calls[0]![0]), fixture.draft);
    if (boundary === "assignment") view.rerender(tree({ ...fixture, snapshot: { ...fixture.snapshot, clients: [], matchingTotal: 0 } }));
    else if (boundary === "same-time replacement") {
      const replacement = savedFixture("spmsq", { versionId: ids.otherId, version: 2, contentHash: "b".repeat(64) });
      view.rerender(tree(replacement));
    } else {
      vi.setSystemTime(Date.now() + 1); view.rerender(tree(savedFixture("spmsq", { versionId: ids.otherId, version: 2 })));
      view.rerender(tree(fixture)); hiddenClinical();
    }
    await act(async () => { body.resolve(payload); });
    expect(screen.queryByText("題目已填齊")).not.toBeInTheDocument(); expect(hasViewTransition()).toBe(false);
    expect(network).toHaveBeenCalledOnce();
  });
  it("stops pending readiness before safe logout and rejects its late body", async () => {
    const fixture = savedFixture(), body = deferred<unknown>();
    network.mockImplementation(async input => {
      if (String(input).startsWith("/api/context/branch")) return Response.json({ status: "ok", data: { cleared: true } });
      const response = Response.json({}); vi.spyOn(response, "json").mockReturnValue(body.promise); return response;
    });
    render(tree(fixture)); fireEvent.click(inspect()); await waitFor(() => expect(network).toHaveBeenCalledOnce());
    const payload = readinessEnvelope(String(network.mock.calls[0]![0]), fixture.draft);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]!);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(getQuestionnaireViewState().signature).toBeNull();
    await act(async () => { body.resolve(payload); });
    await waitFor(() => expect(shell.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("題目已填齊")).not.toBeInTheDocument(); expect(hasViewTransition()).toBe(false);
    expect(network.mock.calls.filter(([input]) => String(input).includes("/readiness?"))).toHaveLength(1);
    expect(network.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
  it("rejects readiness while the workspace has an uncertain write, retaining the original write lease", async () => {
    network.mockResolvedValue(Response.json({ errors: [] }, { status: 503 })); render(tree());
    fireEvent.click(screen.getByRole("button", { name: "保存修訂版本" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeInTheDocument());
    expect(inspect()).toBeDisabled(); fireEvent.click(inspect());
    expect(network).toHaveBeenCalledOnce(); expect(network.mock.calls[0]![1]?.method).toBe("POST");
    expect(hasPendingOperations()).toBe(true);
    // Exercise the existing explicit unknown-write logout acknowledgement so
    // teardown does not manufacture a release of an unresolved write.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    network.mockResolvedValue(Response.json({ status: "ok", data: { cleared: true } }));
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]!);
    await waitFor(() => expect(hasPendingOperations()).toBe(false));
  });
  it("does not GET beside a foreign write lease", () => {
    render(tree()); act(() => { const release = tryAcquirePendingOperation(); expect(release).not.toBeNull(); leases.push(release!); });
    expect(inspect()).toBeDisabled(); fireEvent.click(inspect()); expect(network).not.toHaveBeenCalled(); expect(hasPendingOperations()).toBe(true);
  });
  it("allows a read-only actor to inspect a saved draft without enabling revision", async () => {
    const actor = { ...context, scopes: context.scopes.filter(scope => !scope.endsWith(".manage")) };
    const fixture = savedFixture(); readiness(fixture, actor); render(tree(fixture, actor, false)); await check();
    expect(screen.queryByRole("button", { name: "修訂此草稿" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存修訂版本" })).not.toBeInTheDocument();
    expect(network).toHaveBeenCalledOnce();
  });
  it("same-time assignment withdrawal cannot be reversed using the old SSR source", () => {
    const fixture = savedFixture(); const view = render(tree(fixture));
    view.rerender(tree({ ...fixture, snapshot: { ...fixture.snapshot, clients: [], matchingTotal: 0 } }));
    hiddenClinical(); view.rerender(tree(fixture)); hiddenClinical(); expect(network).not.toHaveBeenCalled();
  });
  it("bounds history body decoding and rejects its late draft instead of enabling readiness", async () => {
    vi.useFakeTimers(); const fixture = savedFixture(), body = deferred<unknown>();
    const response = Response.json({}); vi.spyOn(response, "json").mockReturnValue(body.promise); network.mockResolvedValue(response);
    render(tree(fixture)); fireEvent.click(screen.getByRole("button", { name: "查看版本歷程" }));
    await act(async () => { await Promise.resolve(); }); expect(inspect()).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(CLIENT_WRITE_TIMEOUT_MS + 1); });
    expect(screen.getByRole("alert")).toHaveTextContent("歷程暫時無法載入");
    expect(inspect()).not.toBeDisabled();
    await act(async () => { body.resolve({ data: { versions: [{ ...fixture.draft, version: 99 }] } }); });
    expect(screen.queryByText(/v99/u)).not.toBeInTheDocument(); expect(network).toHaveBeenCalledOnce();
    expect(screen.getByText("修訂草稿 v1")).toBeInTheDocument();
  });
  it("a malformed history source hides old answers and disables candidate inspection", async () => {
    network.mockResolvedValue(Response.json({ data: { versions: [{ secret: "PRIVATE_HISTORY_ERROR" }] } }));
    render(tree()); fireEvent.click(screen.getByRole("button", { name: "查看版本歷程" }));
    await waitFor(hiddenClinical); expect(screen.queryByText(/PRIVATE_HISTORY_ERROR/u)).not.toBeInTheDocument();
  });
  it("inspects a selected historical version without changing the latest revision target", async () => {
    const old = savedFixture().draft, fixture = savedFixture("spmsq", { version: 2, versionId: ids.otherId, contentHash: "b".repeat(64) });
    network.mockImplementation(async input => {
      if (String(input).includes("/readiness?")) return Response.json(readinessEnvelope(String(input), old, context, true));
      return Response.json({ requestId: ids.requestId, status: "ok", data: { formKey: "spmsq", clientId: ids.clientId, assessmentKey: ids.assessmentKey,
        versions: [{ ...fixture.draft, recordState: "draft" }, { ...old, recordState: "draft" }].map(item => {
          const { assessmentCreatedAt, ...draft } = item; void assessmentCreatedAt; return draft;
        }),
        total: 2, nextBeforeVersion: null }, errors: [] });
    });
    render(tree(fixture)); fireEvent.click(screen.getByRole("button", { name: "查看版本歷程" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "查看 v1" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "查看 v1" })); await check();
    expect(within(panel()).getByText(/已有較新版本/u)).toBeInTheDocument();
    expect(screen.getByText("查看草稿 v1", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "修訂此草稿" }));
    expect(screen.getByText("修訂草稿 v2")).toBeInTheDocument();
    expect(within(panel()).getByText(`已保存 v2・${fixture.draft.assessedOn}`)).toBeInTheDocument();
    expect(network.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
});
