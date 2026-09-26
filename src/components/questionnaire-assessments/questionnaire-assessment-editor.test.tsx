// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import Link from "next/link";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ fetch: vi.fn(), release: vi.fn(), acquire: vi.fn() }));
vi.mock("@/lib/api/client-fetch", () => ({ fetchWithTimeout: stubs.fetch }));
vi.mock("@/lib/navigation/pending-operation-lock", () => ({ tryAcquirePendingOperation: stubs.acquire, useViewTransitionPending: () => false }));
vi.mock("@/components/clients/client-selection-card", () => ({
  ClientSelectionCard: ({ disabled }: { disabled?: boolean }) => <select aria-label="個案" disabled={disabled}><option>合成個案</option></select>,
}));

import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import type { QuestionnaireAnswers, QuestionnaireAssessment, QuestionnaireDraft, QuestionnaireSnapshot } from "@/lib/questionnaire-assessments/types";
import { QuestionnaireAssessmentsWorkspace } from "./questionnaire-assessment-editor";

const clientId = "10000000-0000-4000-8000-000000000001";
const key = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const versionId = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = "2026-09-25T01:00:00Z";
const form = QUESTIONNAIRE_FORMS.spmsq;
const answers = Object.fromEntries(form.questions.map(({ id }) => [id, { state: "answered", value: "correct" }])) as QuestionnaireAnswers;
const draft = (chain = 1, version = 1): QuestionnaireDraft & { recordState: "draft" } => ({ assessmentKey: key(chain), versionId: versionId(chain * 100 + version),
  version, formVersion: form.version, assessedOn: "2026-09-25", answers, context: { education_adjustment: "middle_or_high_school" },
  recordState: "draft", authorDisplayName: `評估人員 ${chain}`, createdAt: stamp, contentHash: "a".repeat(64) });
const assessment = (chain = 1, version = 1): QuestionnaireAssessment => ({ ...draft(chain, version), assessmentCreatedAt: stamp });
const defaultSnapshot = (): QuestionnaireSnapshot => ({ formKey: "spmsq", generatedAt: stamp, matchingTotal: 1,
  clients: [{ clientId, displayName: "合成個案", serviceStatus: "active", latest: draft(), assessments: [assessment(), assessment(2)], assessmentTotal: 2, nextAssessmentCursor: null }] });
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data, errors: [] }), { status });
const history = (chain = 1, versions = [1], nextBeforeVersion: number | null = null, total = versions.length) => ({
  formKey: "spmsq", clientId, assessmentKey: key(chain), versions: versions.map((v) => draft(chain, v)), total, nextBeforeVersion,
});
const page = (assessments = [assessment(), assessment(2)], total = assessments.length) => ({ formKey: "spmsq", clientId, assessments, total, nextCursor: null });
const receipt = (action: "create" | "revise", chain = 1, version = 1, assessedOn = "2026-09-25") => ({ action, clientId, formKey: "spmsq", assessmentKey: key(chain),
  versionId: versionId(chain * 100 + version), version, recordState: "draft", assessedOn, contentHash: "a".repeat(64), committedAt: stamp, replayed: false });
const workspace = (snapshot = defaultSnapshot(), canManage = true, selectedForm = form) => render(<QuestionnaireAssessmentsWorkspace assessorName="目前登入人員" canManage={canManage}
  form={selectedForm} loadError={false} pageTitle={selectedForm.title} selectedClientId={clientId} snapshot={snapshot} />);
const button = (name: string) => screen.getByRole("button", { name });
const posts = () => stubs.fetch.mock.calls.filter(([, init]) => init?.method === "POST");

describe("questionnaire independent drafts and version browsing", () => {
  beforeEach(() => { vi.clearAllMocks(); stubs.acquire.mockReturnValue(stubs.release); vi.spyOn(window, "confirm").mockReturnValue(false); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it.each(Object.values(QUESTIONNAIRE_FORMS))("directly renders every question of $key after client selection", (selectedForm) => {
    const snapshot: QuestionnaireSnapshot = { ...defaultSnapshot(), formKey: selectedForm.key,
      clients: [{ ...defaultSnapshot().clients[0]!, latest: null, assessments: [], assessmentTotal: 0 }] };
    workspace(snapshot, true, selectedForm);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(selectedForm.questions.length);
    expect(screen.getByText("僅供草稿核對，正式計分尚未啟用")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /簽署/ })).toBeNull();
  });

  it("starts a separate assessment with blank answers rather than revising the existing chain", async () => {
    workspace(); fireEvent.click(button("新增一次評估"));
    expect(screen.getAllByRole("radio").every((element) => !(element as HTMLInputElement).checked)).toBe(true);
    fireEvent.change(screen.getByLabelText("評估日期"), { target: { value: "2026-09-25" } });
    stubs.fetch.mockResolvedValueOnce(response(receipt("create", 3)))
      .mockResolvedValueOnce(response(history(3))).mockResolvedValueOnce(response(page([assessment(), assessment(2), assessment(3)])));
    fireEvent.click(button("保存本次評估"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const payload = JSON.parse(posts()[0]![1].body as string);
    expect(payload).toMatchObject({ action: "create", clientId, formKey: "spmsq" });
    expect(payload).not.toHaveProperty("assessmentKey"); expect(payload.answers.spmsq_01).toEqual({ state: "missing" });
    await waitFor(() => expect(screen.getByText("已保存 3 次評估；每次評估與修訂版本分開保留。")).toBeTruthy());
    expect(stubs.release).toHaveBeenCalledTimes(2);
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

  it("freezes uncertain saves and retries the same body/key without allowing assessment switches", async () => {
    workspace(); stubs.fetch.mockRejectedValueOnce(new Error("連線中斷"));
    fireEvent.click(button("保存修訂版本"));
    await waitFor(() => expect(button("以相同內容重試")).toBeTruthy());
    expect(screen.getByLabelText("評估日期")).toBeDisabled(); expect(button("新增一次評估")).toBeDisabled();
    expect(screen.getByLabelText("個案")).toBeDisabled(); expect(stubs.release).not.toHaveBeenCalled();
    stubs.fetch.mockResolvedValueOnce(response(receipt("revise", 1, 2))).mockResolvedValueOnce(response(history(1, [2, 1]))).mockResolvedValueOnce(response(page()));
    fireEvent.click(button("以相同內容重試"));
    await waitFor(() => expect(screen.getByText("草稿已保存並讀回；尚未簽署。")).toBeTruthy());
    const calls = posts(); expect(calls).toHaveLength(2);
    expect(calls[0]![1].body).toBe(calls[1]![1].body);
    expect(calls[0]![1].headers["idempotency-key"]).toBe(calls[1]![1].headers["idempotency-key"]);
    expect(stubs.release).toHaveBeenCalledTimes(1);
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
    workspace(); fireEvent.click(within(screen.getByRole("radiogroup", { name: "第 1 題" })).getByLabelText("答錯"));
    fireEvent.click(button("新增一次評估"));
    expect(screen.getByRole("region", { name: "尚未保存的內容" })).toBeTruthy();
    fireEvent.click(button("繼續填寫"));
    expect(within(screen.getByRole("radiogroup", { name: "第 1 題" })).getByLabelText("答錯")).toBeChecked();
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
    expect(screen.getByRole("alert").textContent).toContain("實測值不符");
    expect(screen.getByText("計分預覽：尚未完整作答")).toBeTruthy();
    fireEvent.click(button("保存本次評估")); expect(stubs.fetch).not.toHaveBeenCalled();
  });

  it("requires explicit discard before a sidebar, brand, or notification Link can unmount a dirty draft", () => {
    const view = workspace(); const navigate = vi.fn(() => view.unmount());
    render(<Link href="/app/staff/other" onClick={(event) => { event.preventDefault(); navigate(); }}>側欄切頁</Link>);
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "第 1 題" })).getByLabelText("答錯"));
    fireEvent.click(screen.getByRole("link", { name: "側欄切頁" }));
    expect(window.confirm).toHaveBeenCalledTimes(1); expect(navigate).not.toHaveBeenCalled();
    expect(within(screen.getByRole("radiogroup", { name: "第 1 題" })).getByLabelText("答錯")).toBeChecked();
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("link", { name: "側欄切頁" })); expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("does not block new-tab source links or same-page hashes that keep the draft mounted", () => {
    workspace(); const navigate = vi.fn();
    render(<><a href="/app/staff/other" target="_blank" onClick={(event) => { event.preventDefault(); navigate(); }}>另開分頁</a>
      <a href="#details" onClick={(event) => { event.preventDefault(); navigate(); }}>同頁段落</a></>);
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "第 1 題" })).getByLabelText("答錯"));
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
      expect(nextRouterPopstate).not.toHaveBeenCalled(); expect(restore).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(restore.mock.calls[0]![0])).not.toContain("answers"); expect(JSON.stringify(restore.mock.calls[0]![0])).not.toContain("idempotencyKey");
      stubs.fetch.mockResolvedValueOnce(response(receipt("revise", 1, 2))).mockResolvedValueOnce(response(history(1, [2, 1]))).mockResolvedValueOnce(response(page()));
      fireEvent.click(button("以相同內容重試"));
      await waitFor(() => expect(screen.getByText("草稿已保存並讀回；尚未簽署。")).toBeTruthy());
      const calls = posts(); expect(calls[0]![1].body).toBe(calls[1]![1].body);
      expect(calls[0]![1].headers["idempotency-key"]).toBe(calls[1]![1].headers["idempotency-key"]);
      fireEvent.click(screen.getByRole("link", { name: "側欄切頁" })); expect(navigate).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener("popstate", nextRouterPopstate); }
  });

  it("captures dirty browser Back before the Next router and preserves its opaque history state", () => {
    const state = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { opaque: "test-router-state" } };
    window.history.replaceState(state, "", window.location.href); workspace();
    const nextRouter = vi.fn(); window.addEventListener("popstate", nextRouter);
    const restore = vi.spyOn(window.history, "pushState");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "第 1 題" })).getByLabelText("答錯"));
    try {
      fireEvent(window, new PopStateEvent("popstate", { state: { __NA: true } }));
      expect(nextRouter).not.toHaveBeenCalled(); expect(restore).toHaveBeenCalledWith(state, "", window.location.href);
      vi.mocked(window.confirm).mockReturnValue(true);
      fireEvent(window, new PopStateEvent("popstate", { state: { __NA: true } })); expect(nextRouter).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener("popstate", nextRouter); }
  });

  it("cannot discard through an already-open switch confirmation while a POST is pending", async () => {
    workspace(); fireEvent.click(within(screen.getByRole("radiogroup", { name: "第 1 題" })).getByLabelText("答錯"));
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
    workspace(); fireEvent.click(within(screen.getByRole("radiogroup", { name: "第 1 題" })).getByLabelText("答錯"));
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
    expect(screen.getByText("僅供檢視")).toBeTruthy();
    expect(screen.queryByText(/vundefined/)).toBeNull(); expect(screen.queryByText(/請填寫下方量表保存/)).toBeNull();
  });
});
