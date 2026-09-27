// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { CLIENT_WRITE_TIMEOUT_MS } from "@/lib/api/client-fetch";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { clearQuestionnaireViewOnLogout, getQuestionnaireViewState, observeQuestionnaireViewAuthority, questionnaireViewAuthority } from "@/lib/questionnaire-assessments/readiness-view";
import { QuestionnaireReadinessPanel } from "./questionnaire-readiness-panel";
import { context, deferred, formKeys, ids, readinessEnvelope, savedFixture } from "./questionnaire-readiness-test-fixtures";

const network = vi.fn<typeof fetch>();
let sequence = 0;
const leases: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-09-27T01:00:00.000Z") + ++sequence * 120_000);
  vi.stubGlobal("fetch", network); network.mockReset();
  observeQuestionnaireViewAuthority(questionnaireViewAuthority(context));
});
afterEach(() => {
  cleanup(); for (const release of leases.splice(0)) release(); clearQuestionnaireViewOnLogout();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
function show(fixture = savedFixture(), props: Partial<React.ComponentProps<typeof QuestionnaireReadinessPanel>> = {}) {
  return render(<QuestionnaireReadinessPanel context={context} form={fixture.form} clientId={ids.clientId}
    draft={fixture.draft} sourceKey="source-A" blockedReason="" {...props} />);
}
const button = () => screen.getByRole("button", { name: "檢查已保存評估" });
const panel = () => screen.getByRole("region", { name: "已保存評估完成檢查" });
function respond(fixture = savedFixture(), superseded = false) {
  network.mockImplementation(async input => Response.json(readinessEnvelope(String(input), fixture.draft, context, superseded)));
}

describe("manual saved-version readiness through the real reader", () => {
  it.each(formKeys)("reads exactly one private GET for complete %s, including an assessment-list draft", async key => {
    const fixture = savedFixture(key); respond(fixture); show(fixture);
    expect(network).not.toHaveBeenCalled(); fireEvent.click(button());
    await waitFor(() => expect(within(panel()).getByText("題目已填齊")).toBeInTheDocument());
    expect(network).toHaveBeenCalledOnce();
    const [input, init] = network.mock.calls[0]!;
    const query = new URL(String(input), "https://synthetic.invalid").searchParams;
    expect(query.get("form_key")).toBe(key); expect(query.get("version_id")).toBe(fixture.draft.versionId);
    expect(query.get("content_hash")).toBe(fixture.draft.contentHash);
    expect(query.get("read_nonce")).toMatch(/^[a-f0-9-]{36}$/u);
    expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error" });
    expect(init?.body).toBeUndefined(); expect(String(input)).not.toMatch(/SYNTHETIC_SAVED_NOTE|answers|assessmentCreatedAt/u);
    expect(within(panel()).getByText(/候選試算：.*非正式分數/u)).toBeInTheDocument();
    expect(within(panel()).getByText(/尚不可正式簽署/u)).toBeInTheDocument();
    expect(within(panel()).queryByRole("button", { name: /簽署/u })).not.toBeInTheDocument();
    expect(hasPendingOperations()).toBe(false); expect(hasViewTransition()).toBe(false);
  });
  for (const scenario of ["missing", "invalid", "not_applicable"] as const) {
    it.each(formKeys)(`does not invent a score for ${scenario} %s`, async key => {
      const initial = savedFixture(key), first = initial.form.questions[0]!.id;
      const answer = scenario === "missing" ? { state: "missing" as const } : scenario === "invalid"
        ? { state: "answered" as const, value: "UNTRUSTED_CHOICE" } : { state: "not_applicable" as const, reason: "SYNTHETIC_PRIVATE_REASON" };
      const fixture = savedFixture(key, { answers: { ...initial.draft.answers, [first]: answer } });
      respond(fixture); show(fixture); fireEvent.click(button());
      await waitFor(() => expect(within(panel()).getByText(/有欄位需要修正|還有題目或必要資料未填/u)).toBeInTheDocument());
      expect(within(panel()).queryByText(/候選試算/u)).not.toBeInTheDocument();
      expect(within(panel()).queryByText(/UNTRUSTED_CHOICE|SYNTHETIC_PRIVATE_REASON/u)).not.toBeInTheDocument();
      expect(network).toHaveBeenCalledOnce();
    });
  }
  it.each(formKeys)("reports superseded %s without changing selected historical state", async key => {
    const fixture = savedFixture(key); respond(fixture, true); show(fixture); fireEvent.click(button());
    await waitFor(() => expect(within(panel()).getByText(/已有較新版本/u)).toBeInTheDocument());
    expect(within(panel()).getByText(`已保存 v1・${fixture.draft.assessedOn}`)).toBeInTheDocument();
    expect(fixture.draft.versionId).toBe(ids.versionId); expect(network).toHaveBeenCalledOnce();
  });
  it("preserves a BSRS suicide alert despite another missing answer", async () => {
    const initial = savedFixture("bsrs5");
    const fixture = savedFixture("bsrs5", { answers: { ...initial.draft.answers,
      [initial.form.questions[0]!.id]: { state: "missing" }, bsrs_suicide: { state: "answered", value: "1" } } });
    respond(fixture); show(fixture); fireEvent.click(button());
    await waitFor(() => expect(within(panel()).getByText(/還有題目/u)).toBeInTheDocument());
    expect(within(panel()).getAllByRole("alert").some(node => /自殺|安全|立即/u.test(node.textContent ?? ""))).toBe(true);
    expect(within(panel()).queryByText(/候選試算/u)).not.toBeInTheDocument();
  });
  it.each(["no draft", "dirty", "locked"])("does not read when %s", reason => {
    show(savedFixture(), reason === "no draft" ? { draft: null } : { blockedReason: reason });
    expect(button()).toBeDisabled(); fireEvent.click(button()); expect(network).not.toHaveBeenCalled();
  });
  it.each(["operation", "view"])("does not GET under another %s lease", kind => {
    show(); act(() => { const release = kind === "operation" ? tryAcquirePendingOperation() : tryAcquireViewTransition();
      expect(release).not.toBeNull(); leases.push(release!); });
    expect(button()).toBeDisabled(); fireEvent.click(button()); expect(network).not.toHaveBeenCalled();
  });
  it.each(["unmount", "source ABA", "authority ABA", "logout"])("rejects late JSON after %s", async boundary => {
    const fixture = savedFixture(), body = deferred<unknown>();
    network.mockImplementation(async input => {
      const response = Response.json(readinessEnvelope(String(input), fixture.draft));
      vi.spyOn(response, "json").mockReturnValue(body.promise); return response;
    });
    const view = show(fixture); fireEvent.click(button()); await waitFor(() => expect(network).toHaveBeenCalledOnce());
    const payload = readinessEnvelope(String(network.mock.calls[0]![0]), fixture.draft);
    if (boundary === "unmount") view.unmount();
    else if (boundary === "logout") act(() => clearQuestionnaireViewOnLogout());
    else if (boundary === "authority ABA") act(() => {
      observeQuestionnaireViewAuthority(questionnaireViewAuthority({ ...context, scopes: [] }));
      observeQuestionnaireViewAuthority(questionnaireViewAuthority(context));
    });
    else {
      view.rerender(<QuestionnaireReadinessPanel context={context} form={fixture.form} clientId={ids.clientId} draft={fixture.draft} sourceKey="source-B" blockedReason="" />);
      view.rerender(<QuestionnaireReadinessPanel context={context} form={fixture.form} clientId={ids.clientId} draft={fixture.draft} sourceKey="source-A" blockedReason="" />);
    }
    await act(async () => { body.resolve(payload); await Promise.resolve(); });
    expect(screen.queryByText("題目已填齊")).not.toBeInTheDocument(); expect(hasViewTransition()).toBe(false);
  });
  it("old read cleanup cannot release a newer read lease", async () => {
    const fixture = savedFixture(), first = deferred<unknown>(), second = deferred<unknown>(); let calls = 0;
    network.mockImplementation(async () => {
      const response = Response.json({}); vi.spyOn(response, "json").mockReturnValue(++calls === 1 ? first.promise : second.promise); return response;
    });
    const view = show(fixture); fireEvent.click(button()); await waitFor(() => expect(network).toHaveBeenCalledOnce());
    view.rerender(<QuestionnaireReadinessPanel context={context} form={fixture.form} clientId={ids.clientId} draft={fixture.draft} sourceKey="source-B" blockedReason="" />);
    fireEvent.click(button()); await waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    await act(async () => { first.resolve(readinessEnvelope(String(network.mock.calls[0]![0]), fixture.draft)); });
    expect(hasViewTransition()).toBe(true);
    await act(async () => { second.resolve(readinessEnvelope(String(network.mock.calls[1]![0]), fixture.draft)); });
    await waitFor(() => expect(within(panel()).getByText("題目已填齊")).toBeInTheDocument()); expect(hasViewTransition()).toBe(false);
  });
  it("a completed report cannot revive after saved source A→B→A", async () => {
    const fixture = savedFixture(); respond(fixture); const view = show(fixture); fireEvent.click(button());
    await waitFor(() => expect(within(panel()).getByText("題目已填齊")).toBeInTheDocument());
    view.rerender(<QuestionnaireReadinessPanel context={context} form={fixture.form} clientId={ids.clientId} draft={fixture.draft} sourceKey="source-B" blockedReason="" />);
    view.rerender(<QuestionnaireReadinessPanel context={context} form={fixture.form} clientId={ids.clientId} draft={fixture.draft} sourceKey="source-A" blockedReason="" />);
    expect(within(panel()).queryByText("題目已填齊")).not.toBeInTheDocument();
    expect(within(panel()).queryByText(/候選試算/u)).not.toBeInTheDocument(); expect(network).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 200])("quarantines owner after status %s denial or malformed response", async status => {
    network.mockResolvedValue(Response.json({ private_provider_error: "SECRET_DO_NOT_RENDER" }, { status }));
    show(); const before = getQuestionnaireViewState().epoch; fireEvent.click(button());
    await waitFor(() => expect(getQuestionnaireViewState().epoch).toBeGreaterThan(before));
    expect(screen.queryByText(/SECRET_DO_NOT_RENDER/u)).not.toBeInTheDocument(); expect(hasViewTransition()).toBe(false);
  });
  it.each(["fetch", "JSON"])("bounds an uncooperative %s and releases its read without retry", async phase => {
    vi.useFakeTimers();
    const body = deferred<unknown>();
    if (phase === "fetch") network.mockImplementation(() => new Promise(() => {}));
    else { const response = Response.json({}); vi.spyOn(response, "json").mockReturnValue(body.promise); network.mockResolvedValue(response); }
    show(); fireEvent.click(button()); await act(async () => { await Promise.resolve(); });
    expect(hasViewTransition()).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(CLIENT_WRITE_TIMEOUT_MS + 1); });
    expect(within(panel()).getByRole("alert")).toHaveTextContent("暫時無法檢查");
    expect(hasViewTransition()).toBe(false); expect(network).toHaveBeenCalledOnce(); expect(button()).not.toBeDisabled();
  });
  it("expires a displayed report without rereading or retaining a candidate score", async () => {
    vi.useFakeTimers(); const fixture = savedFixture(); respond(fixture); show(fixture); fireEvent.click(button());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(within(panel()).getByText("題目已填齊")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
    expect(within(panel()).getByText("檢查結果已過期，請重新檢查。")).toBeInTheDocument();
    expect(within(panel()).queryByText(/候選試算/u)).not.toBeInTheDocument(); expect(network).toHaveBeenCalledOnce();
  });
});
