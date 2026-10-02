// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import type { QuestionnaireClient, QuestionnaireFormKey, QuestionnaireSnapshot } from "@/lib/questionnaire-assessments/types";

import { QuestionnaireAssessmentsWorkspace } from "./questionnaire-assessment-editor";

const refresh = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace }) }));

const clientA: QuestionnaireClient = {
  clientId: "00000000-0000-4000-8000-000000000015",
  displayName: "合成測試個案甲",
  serviceStatus: "active",
  latest: null,
};
const clientB: QuestionnaireClient = {
  clientId: "00000000-0000-4000-8000-000000000016",
  displayName: "合成測試個案乙",
  serviceStatus: "suspended",
  latest: null,
};

function workspace(formKey: QuestionnaireFormKey, {
  canManage = true,
  selectedClientId = clientA.clientId,
  clients = [clientA],
}: {
  canManage?: boolean;
  selectedClientId?: string | null;
  clients?: QuestionnaireClient[];
} = {}) {
  const form = QUESTIONNAIRE_FORMS[formKey];
  const snapshot: QuestionnaireSnapshot = {
    formKey,
    generatedAt: "2026-10-03T00:00:00Z",
    matchingTotal: clients.length,
    clients,
    demo: true,
  };
  return <QuestionnaireAssessmentsWorkspace assessorName="合成測試評估員" canManage={canManage}
    form={form} loadError={false} pageTitle={form.title} selectedClientId={selectedClientId} snapshot={snapshot} />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("shared questionnaire assessment editor", () => {
  it("puts the first complete question before optional fields and keeps progress and source available", () => {
    const form = QUESTIONNAIRE_FORMS.spmsq;
    render(workspace("spmsq"));

    const first = document.getElementById(`spmsq-${form.questions[0].id}`)!;
    expect(first).toBeInTheDocument();
    expect(first).toHaveTextContent(form.questions[0].prompt);
    expect(first.compareDocumentPosition(screen.getByLabelText(/補充觀察與後續事項/u)) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(screen.getByRole("progressbar", { name: `${form.title}題目與計分條件進度` }))
      .toHaveAttribute("max", "11");
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
    expect(screen.getByText("填寫進度 0／11 項")).toBeVisible();
    const group = within(first).getByRole("radiogroup");
    expect(group).toHaveAccessibleName(`1. ${form.questions[0].prompt}`);
    expect(within(group).getAllByRole("radio")).toHaveLength(2);

    fireEvent.click(screen.getByText("填寫說明與來源"));
    expect(screen.getByRole("link", { name: form.sourceLabel })).toHaveAttribute("href", form.sourceUrl);
  });

  it("updates completion, can return a response to waiting, and focuses the first waiting question", () => {
    const form = QUESTIONNAIRE_FORMS.spmsq;
    render(workspace("spmsq"));
    const first = document.getElementById(`spmsq-${form.questions[0].id}`)!;
    fireEvent.click(within(first).getAllByRole("radio")[0]);
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
    expect(within(first).getByText("已答")).toBeVisible();
    fireEvent.click(within(first).getByRole("button", { name: "改為待答" }));
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
    expect(within(first).getByText("待答")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "前往第 1 題" }));
    expect(first).toHaveFocus();
  });

  it("does not report completion when all SPMSQ answers are present but the scoring condition is missing", () => {
    const form = QUESTIONNAIRE_FORMS.spmsq;
    render(workspace("spmsq"));
    for (const question of form.questions) {
      const card = document.getElementById(`spmsq-${question.id}`)!;
      fireEvent.click(within(card).getAllByRole("radio")[0]);
    }
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "10");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "11");
    expect(screen.getByText("題目已處理，待補教育程度（計分調整）")).toBeVisible();
    expect(screen.getByText(/待補計分條件：教育程度（計分調整）/u)).toBeVisible();
    expect(screen.queryByText("目前沒有待補項目")).not.toBeInTheDocument();
    const education = screen.getByRole("combobox", { name: "教育程度（計分調整）（計分必要）" });
    fireEvent.click(screen.getByRole("button", { name: "前往教育程度（計分調整）" }));
    expect(education).toHaveFocus();
    fireEvent.change(education, { target: { value: "grade_school_or_less" } });
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "11");
    expect(screen.getByText("目前沒有待補項目")).toBeVisible();
  });

  it("requires an explanation for a supported not-applicable answer before saving one draft", async () => {
    const form = QUESTIONNAIRE_FORMS.barthel_adl;
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    let finishFetch: (response: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finishFetch = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000099" });
    render(workspace("barthel_adl"));
    const first = document.getElementById(`barthel_adl-${form.questions[0].id}`)!;
    fireEvent.click(within(first).getByRole("button", { name: "此題不適用" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(fetchMock).not.toHaveBeenCalled();
    const reason = within(first).getByRole("textbox", { name: "不適用原因（必填）" });
    expect(reason).toHaveFocus();
    expect(reason).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(reason, { target: { value: "本次情況無法適用該項" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "保存中…" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/questionnaire-assessments?form_key=barthel_adl");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("00000000-0000-4000-8000-000000000099");
    const body = JSON.parse(String(init.body));
    expect(body.action).toBe("create");
    expect(body.clientId).toBe(clientA.clientId);
    expect(body.answers[form.questions[0].id]).toEqual({ state: "not_applicable", reason: "本次情況無法適用該項" });
    await act(async () => finishFetch(Response.json({ data: { recordState: "draft" } })));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/草稿已保存/u)).toBeVisible();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("keeps BSRS safety guidance immediate and does not allow read-only edits", () => {
    const form = QUESTIONNAIRE_FORMS.bsrs5;
    const writable = render(workspace("bsrs5"));
    const safety = document.getElementById("bsrs5-bsrs_suicide")!;
    fireEvent.click(within(safety).getByRole("radio", { name: form.questions[5].choices[1].label }));
    expect(within(safety).getByRole("alert")).toHaveTextContent("立即轉知護理／主管");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByText(/需立即關懷/u)).toBeVisible();

    writable.rerender(workspace("bsrs5", { canManage: false }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(within(safety).getAllByRole("radio")[0]).toBeDisabled();
    expect(screen.getByText("只有檢視權限；無法編輯或保存草稿。")).toBeVisible();
  });

  it("updates the native client selector when same-route navigation changes the selected client", () => {
    const clients = [clientA, clientB];
    const view = render(workspace("spmsq", { clients }));
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue(clientA.clientId);
    view.rerender(workspace("spmsq", { clients, selectedClientId: clientB.clientId }));
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue(clientB.clientId);
    expect(screen.getAllByText(/合成測試個案乙・暫停服務/u).some((element) => element.tagName === "STRONG")).toBe(true);
  });

  it("protects unsaved answers on client change, browser unload, and same-origin navigation", () => {
    render(workspace("spmsq", { clients: [clientA, clientB] }));
    const first = document.getElementById("spmsq-spmsq_01")!;
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    dialog.showModal = vi.fn(() => { dialog.open = true; });
    dialog.close = vi.fn(() => { dialog.open = false; fireEvent(dialog, new Event("close")); });
    fireEvent.click(within(first).getAllByRole("radio")[0]);

    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    const client = screen.getByRole("combobox", { name: "個案" });
    fireEvent.change(client, { target: { value: clientB.clientId } });
    expect(fireEvent.submit(client.closest("form")!)).toBe(false);
    expect(dialog.open).toBe(true);
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    expect(client).toHaveValue(clientA.clientId);
    expect(within(first).getAllByRole("radio")[0]).toBeChecked();

    const link = document.createElement("a");
    link.href = "/app/staff/workspace/case-center";
    link.textContent = "個案中心";
    document.body.append(link);
    try {
      expect(link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))).toBe(false);
      expect(dialog.open).toBe(true);
      expect(replace).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    } finally {
      link.remove();
    }

    fireEvent.change(client, { target: { value: clientB.clientId } });
    expect(fireEvent.submit(client.closest("form")!)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "放棄輸入並繼續" }));
    expect(replace).toHaveBeenCalledWith(`/app/staff/assessments/spmsq?client=${clientB.clientId}`);
  });

  it("guards browser Back with a non-sensitive same-URL sentinel and keeps answers after cancellation", () => {
    window.history.replaceState({ __NA: true, tree: ["synthetic"] }, "", window.location.href);
    const originalState = window.history.state;
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    render(workspace("spmsq"));
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    dialog.showModal = vi.fn(() => { dialog.open = true; });
    dialog.close = vi.fn(() => { dialog.open = false; fireEvent(dialog, new Event("close")); });
    const first = document.getElementById("spmsq-spmsq_01")!;
    fireEvent.click(within(first).getAllByRole("radio")[0]);
    const marker = window.history.state.__daycareAssessmentUnsavedGuard;
    expect(marker).toEqual(expect.any(String));
    expect(window.history.state.__NA).toBe(true);
    expect(window.history.state.tree).toEqual(["synthetic"]);
    expect(JSON.stringify(window.history.state)).not.toContain("correct");

    window.history.replaceState(originalState, "", window.location.href);
    fireEvent(window, new PopStateEvent("popstate", { state: originalState }));
    expect(dialog.open).toBe(true);
    expect(go).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    expect(window.history.state.__daycareAssessmentUnsavedGuard).toBe(marker);
    expect(within(first).getAllByRole("radio")[0]).toBeChecked();

    window.history.replaceState(originalState, "", window.location.href);
    fireEvent(window, new PopStateEvent("popstate", { state: originalState }));
    fireEvent.click(screen.getByRole("button", { name: "放棄輸入並繼續" }));
    expect(go).toHaveBeenCalledWith(-1);
    expect(within(document.getElementById("spmsq-spmsq_01")!).getAllByRole("radio")[0]).not.toBeChecked();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
  });

  it("does not stack a second sentinel if Forward returns while the Back confirmation is open", () => {
    window.history.replaceState({ __NA: true, tree: ["synthetic"] }, "", window.location.href);
    const originalState = window.history.state;
    const pushState = vi.spyOn(window.history, "pushState");
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    render(workspace("spmsq"));
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    dialog.showModal = vi.fn(() => { dialog.open = true; });
    dialog.close = vi.fn(() => { dialog.open = false; fireEvent(dialog, new Event("close")); });
    fireEvent.click(within(document.getElementById("spmsq-spmsq_01")!).getAllByRole("radio")[0]);
    const sentinelState = window.history.state;
    expect(pushState).toHaveBeenCalledTimes(1);

    window.history.replaceState(originalState, "", window.location.href);
    fireEvent(window, new PopStateEvent("popstate", { state: originalState }));
    expect(dialog.open).toBe(true);
    window.history.replaceState(sentinelState, "", window.location.href);
    fireEvent(window, new PopStateEvent("popstate", { state: sentinelState }));
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    expect(pushState).toHaveBeenCalledTimes(1);

    window.history.replaceState(originalState, "", window.location.href);
    fireEvent(window, new PopStateEvent("popstate", { state: originalState }));
    window.history.replaceState(sentinelState, "", window.location.href);
    fireEvent(window, new PopStateEvent("popstate", { state: sentinelState }));
    fireEvent.click(screen.getByRole("button", { name: "放棄輸入並繼續" }));
    expect(go).toHaveBeenCalledWith(-2);
  });

  it("removes the sentinel after reverting edits so clean Back needs one click", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    render(workspace("spmsq"));
    const first = document.getElementById("spmsq-spmsq_01")!;
    fireEvent.click(within(first).getAllByRole("radio")[0]);
    expect(window.history.state.__daycareAssessmentUnsavedGuard).toEqual(expect.any(String));
    fireEvent.click(within(first).getByRole("button", { name: "改為待答" }));
    expect(back).toHaveBeenCalledTimes(1);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });
});
