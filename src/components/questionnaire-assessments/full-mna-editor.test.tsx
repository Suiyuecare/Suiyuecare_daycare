// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FULL_MNA_DEFINITION, FULL_MNA_PROTEIN_FIELDS } from "@/lib/assessments/full-mna";
import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import { QuestionnaireAssessmentsWorkspace } from "./questionnaire-assessment-editor";
const refresh = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace }) }));
const client = { clientId: "12100000-0000-4000-8000-000000000091", displayName: "合成完整量表個案", serviceStatus: "active" as const, latest: null };
function workspace(formKey: "full_mna" | "mna_sf" = "full_mna") {
  return <QuestionnaireAssessmentsWorkspace assessorName="合成測試評估員" canManage form={QUESTIONNAIRE_FORMS[formKey]}
    loadError={false} pageTitle="MNA 營養評估" selectedClientId={client.clientId}
    snapshot={{ formKey, generatedAt: "2026-10-12T00:00:00Z", matchingTotal: 1, clients: [client], demo: true }} />;
}
const show = () => render(workspace());
const card = (id: string) => document.getElementById(`full_mna-${id}`)!;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("full18 shared questionnaire editor", () => {
  it("shows all18 questions, inline K fields and four independently labelled measurements", () => {
    show();
    for (const question of QUESTIONNAIRE_FORMS.full_mna.questions) expect(card(question.id)).toBeVisible();
    expect(screen.getAllByRole("spinbutton")).toHaveLength(4);
    for (const field of FULL_MNA_PROTEIN_FIELDS) expect(within(card("protein_intake")).getByRole("combobox", { name: field.label })).toBeVisible();
    expect(within(card("anthropometry")).queryByRole("radio", { name: /BMI 無法取得/u })).not.toBeInTheDocument();
    expect(screen.getByText(/計分規則尚待核准/u)).toBeVisible();
    expect(screen.queryByLabelText("量表計分預覽")).not.toBeInTheDocument();
  });
  it("keeps long source instructions folded and shows a short task cue", () => {
    show();
    expect(screen.getByText("逐題填寫；量測值與 K 子題在對應題目完成。")).toBeVisible();
    const instructions = screen.getByText(QUESTIONNAIRE_FORMS.full_mna.instructions);
    expect(instructions.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("待答 18 題・待補 K 子題 3 項")).toBeVisible();
  });
  it.each(["submitted", "signed"] as const)("does not mislabel a %s record whose server confirms published rules as unapproved", (state) => {
    const form = QUESTIONNAIRE_FORMS.full_mna;
    const latest = { assessmentKey: client.clientId, versionId: "12100000-0000-4000-8000-000000000092", version: 3,
      formVersion: form.version, assessedOn: "2026-10-12", answers: {
        ...Object.fromEntries(FULL_MNA_DEFINITION.items.map(q => [q.id, { state: "answered" as const,
          value: [...q.choices].sort((a, b) => b.points - a.points)[0]!.value }])),
        protein_intake: { state: "answered" as const, value: "two_yes" },
      }, context: { height_cm: "160", weight_kg: "64", arm_circumference_cm: "22", calf_circumference_cm: "31",
        protein_dairy: "yes", protein_legumes_eggs: "yes", protein_meat_fish_poultry: "no" },
      authorDisplayName: "合成評估員", createdAt: "2026-10-12T00:00:00Z", contentHash: "a".repeat(64),
      recordState: state, isLatest: true, ruleAvailable: true, signerDisplayName: state === "signed" ? "合成簽署員" : null,
      signedAt: state === "signed" ? "2026-10-12T00:01:00Z" : null,
      resultSnapshot: state === "signed" ? { status: "complete" as const, raw: 29.5, adjusted: 29.5,
        classification: { label: "完整 MNA 24–30 分參考區間" }, unit: "points", incompleteCount: 0 } : null };
    render(<QuestionnaireAssessmentsWorkspace assessorName="合成評估員" canManage form={form}
      loadError={false} pageTitle="MNA 營養評估" selectedClientId={client.clientId}
      snapshot={{ formKey: "full_mna", generatedAt: "2026-10-12T00:00:00Z", matchingTotal: 1, clients: [{ ...client, latest }] }} />);
    expect(screen.queryByText(/計分規則尚待核准/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("量表計分預覽")).not.toBeInTheDocument();
    if (state === "signed") expect(screen.getByText(/29.5 points/u)).toBeVisible();
    else expect(screen.getByText(/此版本的計分規則已核定/u)).toBeVisible();
  });
  it("derives K only after all3 answers and changes to missing when one is cleared", () => {
    show(); const protein = within(card("protein_intake"));
    const fields = FULL_MNA_PROTEIN_FIELDS.map((field) => protein.getByRole("combobox", { name: field.label }));
    fireEvent.change(fields[0], { target: { value: "yes" } }); fireEvent.change(fields[1], { target: { value: "yes" } });
    expect(protein.getByRole("radio", { name: "2 個「是」" })).not.toBeChecked();
    fireEvent.change(fields[2], { target: { value: "no" } });
    expect(protein.getByRole("radio", { name: "2 個「是」" })).toBeChecked();
    expect(protein.getByRole("radio", { name: "2 個「是」" })).toBeDisabled();
    fireEvent.click(protein.getByRole("button", { name: "改為待答" }));
    for (const field of fields) expect(field).toHaveValue("");
    fireEvent.change(fields[0], { target: { value: "yes" } }); fireEvent.change(fields[1], { target: { value: "yes" } });
    fireEvent.change(fields[2], { target: { value: "no" } });
    fireEvent.change(fields[0], { target: { value: "" } });
    expect(protein.getByRole("radio", { name: "2 個「是」" })).not.toBeChecked();
  });
  it("focuses a mismatched Q item and keeps its actual measurement without sending", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); show();
    fireEvent.change(screen.getByRole("spinbutton", { name: "上手臂中點臂圍（公分）" }), { target: { value: "21.5" } });
    fireEvent.click(within(card("arm_circumference")).getByRole("radio", { name: "MAC 22 或以上" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(fetchMock).not.toHaveBeenCalled(); expect(card("arm_circumference")).toHaveFocus();
    expect(within(card("arm_circumference")).getByRole("alert")).toHaveTextContent("選項與實測值不一致");
    expect(screen.getByRole("spinbutton", { name: "上手臂中點臂圍（公分）" })).toHaveValue(21.5);
  });
  it("saves all18 and compound inputs using the same immutable draft path", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body); return { ok: true, status: 201, json: async () => ({ status: "ok", data: {
        action: "create", clientId: client.clientId, formKey: "full_mna", assessmentKey: client.clientId,
        versionId: "12100000-0000-4000-8000-000000000092", version: 1, recordState: "draft", assessedOn: body.assessedOn,
        contentHash: "a".repeat(64), committedAt: "2026-10-12T00:00:00Z", replayed: false,
      } }) };
    });
    vi.stubGlobal("fetch", fetchMock); show();
    for (const question of QUESTIONNAIRE_FORMS.full_mna.questions) if (question.id !== "protein_intake") fireEvent.click(within(card(question.id)).getAllByRole("radio")[0]);
    for (const [name, value] of [["身高（公分）", "160"], ["體重（公斤）", "40"], ["上手臂中點臂圍（公分）", "20"], ["小腿圍（公分）", "30"]]) fireEvent.change(screen.getByRole("spinbutton", { name }), { target: { value } });
    for (const field of FULL_MNA_PROTEIN_FIELDS) fireEvent.change(within(card("protein_intake")).getByRole("combobox", { name: field.label }), { target: { value: "no" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]; expect(url).toBe("/api/questionnaire-assessments?form_key=full_mna");
    const body = JSON.parse(options.body); expect(Object.keys(body.answers)).toHaveLength(18);
    expect(body.context).toMatchObject({ arm_circumference_cm: "20", calf_circumference_cm: "30", protein_dairy: "no", protein_legumes_eggs: "no", protein_meat_fish_poultry: "no" });
    expect(body).not.toHaveProperty("score"); expect(screen.getByText("草稿已保存。")).toBeVisible();
  });
  it("keeps the full variant in native client GET selection", () => {
    show(); const selector = screen.getByRole("combobox", { name: "個案" });
    const form = selector.closest("form")!;
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/app/staff/professional-care/mna");
    expect(new FormData(form).get("variant")).toBe("full");
    expect(new FormData(form).get("client")).toBe(client.clientId);
  });
  it("rejects an empty client selection before native GET navigation and focuses the selector", () => {
    show(); const selector = screen.getByRole("combobox", { name: "個案" });
    fireEvent.change(selector, { target: { value: "" } });
    expect(fireEvent.submit(selector.closest("form")!)).toBe(false);
    expect(selector).toHaveFocus(); expect(selector).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/選擇.*個案/u);
  });
  it("protects dirty Full input on variant switch and preserves it after cancellation", () => {
    show(); const dialog = document.querySelector("dialog") as HTMLDialogElement;
    dialog.showModal = vi.fn(() => { dialog.open = true; });
    dialog.close = vi.fn(() => { dialog.open = false; fireEvent(dialog, new Event("close")); });
    const answer = within(card("food_intake")).getAllByRole("radio")[1]; fireEvent.click(answer);
    const link = screen.getByRole("link", { name: "篩檢 · 6 題" });
    expect(link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))).toBe(false);
    expect(dialog.open).toBe(true); expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    expect(answer).toBeChecked(); expect(dialog.open).toBe(false);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    fireEvent.click(screen.getByRole("button", { name: "放棄輸入並繼續" }));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining(`/app/staff/professional-care/mna?client=${client.clientId}`));
  });
  it("blocks variant switch after an unknown Full save and retains only the original retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("synthetic lost response")); vi.stubGlobal("fetch", fetchMock);
    show(); const dialog = document.querySelector("dialog") as HTMLDialogElement;
    dialog.showModal = vi.fn(() => { dialog.open = true; });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(await screen.findByRole("button", { name: "重試同一次保存" })).toBeEnabled();
    const link = screen.getByRole("link", { name: "篩檢 · 6 題" });
    expect(link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))).toBe(false);
    expect(dialog.open).toBe(false); expect(replace).not.toHaveBeenCalled();
    expect(within(card("food_intake")).getAllByRole("radio")[0]).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重試同一次保存" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[1][1].headers["idempotency-key"]).toBe(fetchMock.mock.calls[0][1].headers["idempotency-key"]);
  });
  it("creates independent answer state when the same client switches between SF and Full", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: "error", errors: [{ code: "REJECTED", message: "合成拒絕" }] }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(workspace("mna_sf"));
    fireEvent.click(within(document.getElementById("mna_sf-food_intake")!).getAllByRole("radio")[1]);
    view.rerender(workspace("full_mna"));
    expect(within(card("food_intake")).getAllByRole("radio")[1]).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.formKey).toBe("full_mna"); expect(Object.keys(body.answers)).toHaveLength(18);
    expect(body.answers.food_intake).toEqual({ state: "missing" });
  });
});
