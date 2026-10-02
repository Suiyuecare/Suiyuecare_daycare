// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const reads = vi.hoisted(() => ({ review: vi.fn(), retirement: vi.fn() }));
vi.mock("@/lib/questionnaire-assessments/rule-governance-client", async (original) => ({
  ...await original<typeof import("@/lib/questionnaire-assessments/rule-governance-client")>(),
  readRuleReview: reads.review, readRuleRetirement: reads.retirement,
}));
vi.mock("./rule-governance-action", () => ({ RuleGovernanceAction: ({ label, enabled, input, scope }: {
  label: string; enabled: boolean; input: { action: string }; scope: { branchId: string };
}) => <button type="button" disabled={!enabled} data-action={input.action} data-branch={scope.branchId}>{label}</button> }));

import { buildQuestionnaireRuleCatalogEntry } from "@/lib/questionnaire-assessments/rule-catalog";
import { parseRuleReviewHistory, type RuleReviewRequest } from "@/lib/questionnaire-assessments/rule-review-contract";
import { parseRuleRetirementHistory, type RuleRetirementRequest } from "@/lib/questionnaire-assessments/rule-retirement-shared";
import { RuleGovernanceClientError, type RuleGovernanceScope } from "@/lib/questionnaire-assessments/rule-governance-client";
import type { QuestionnaireFormKey } from "@/lib/questionnaire-assessments/types";
import { QuestionnaireRuleWorkspace } from "./questionnaire-rule-workspace";

const uuid = (value: number) => `a0000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const scope = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3) };
const other = uuid(4);
const today = "2026-09-26";
const at = (value: number) => new Date(Date.UTC(2026, 8, 26, 4, 0, value)).toISOString();
const base = { scope, canManage: true, hasRecentAal2: true, demo: false, today };

function request(value: number, status: RuleReviewRequest["status"] = "withdrawn", own = true,
  formKey: QuestionnaireFormKey = "spmsq", catalogHash = buildQuestionnaireRuleCatalogEntry(formKey).catalogHash): RuleReviewRequest {
  const requestedBy = own ? scope.userId : other;
  const action = status === "approved" ? "approve" : status === "returned" ? "return" : "withdraw";
  const actorId = action === "withdraw" ? requestedBy : own ? other : scope.userId;
  return { requestId: uuid(value + 100), formKey, catalogHash, effectiveFrom: "2026-10-01", effectiveTo: null,
    requestedBy, byCurrentUser: own, requestedAt: at(value), status,
    decision: status === "pending" ? null : { eventId: uuid(value + 200), action, actorId,
      byCurrentUser: actorId === scope.userId, reason: action === "approve" ? null : "重新核對規則內容", createdAt: at(value + 1) },
    activation: status === "approved" ? { activationId: uuid(value + 300), catalogHash,
      effectiveFrom: "2026-10-01", effectiveTo: null, activatedAt: at(value + 1) } : null };
}

function history(requests: RuleReviewRequest[] = [], total = requests.length, continuation = false,
  formKey: QuestionnaireFormKey = "spmsq", authoritative: RuleGovernanceScope = scope) {
  const entry = buildQuestionnaireRuleCatalogEntry(formKey);
  const nextCursor = continuation ? { createdAt: requests.at(-1)!.requestedAt, id: requests.at(-1)!.requestId } : null;
  const value = { organizationId: authoritative.organizationId, branchId: authoritative.branchId, formKey,
    catalogs: [{ formKey, formVersion: entry.formVersion, ruleVersion: entry.ruleVersion,
      ruleRevision: entry.manifest.ruleRevision, catalogHash: entry.catalogHash }], requests, total, nextCursor, generatedAt: at(59) };
  parseRuleReviewHistory(value, authoritative, formKey, null);
  return { ...value, candidate: { ...entry, registered: true, adoptionRequired: true as const,
    metadata: { title: entry.manifest.form.title, sourceLabel: entry.manifest.form.sourceLabel,
      sourceUrl: entry.manifest.form.sourceUrl ?? null, questionCount: entry.manifest.form.questions.length } } };
}

function retirement(activation: NonNullable<RuleReviewRequest["activation"]>, requests: RuleRetirementRequest[] = [],
  total = requests.length, effectiveThrough: string | null = null, continuation = false) {
  const value = { organizationId: scope.organizationId, branchId: scope.branchId, activationId: activation.activationId,
    formKey: "spmsq" as const, catalogHash: activation.catalogHash, originalEffectiveTo: activation.effectiveTo,
    effectiveThrough, requests, total, nextCursor: continuation ? {
      createdAt: requests.at(-1)!.requestedAt, id: requests.at(-1)!.requestId,
    } : null, generatedAt: at(59) };
  parseRuleRetirementHistory(value, scope, activation.activationId, null);
  return value;
}

function retirementRequest(activation: NonNullable<RuleReviewRequest["activation"]>, value: number): RuleRetirementRequest {
  return { requestId: uuid(value + 500), activationId: activation.activationId, formKey: "spmsq", catalogHash: activation.catalogHash,
    effectiveThrough: "2026-10-15", reason: "改用下一個規則版本", requestedBy: other, byCurrentUser: false,
    requestedAt: at(value), status: "returned", retirement: null, decision: { eventId: uuid(value + 600),
      action: "return", actorId: scope.userId, byCurrentUser: true, reason: "需要重新核對截止日期", createdAt: at(value + 1) } };
}

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => { reads.review.mockReset(); reads.retirement.mockReset(); reads.review.mockResolvedValue(history()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const send = () => screen.getByRole("button", { name: "送交第二人核准" });
const reviewLoaded = () => screen.findByRole("form", { name: "量表採用期間" });

describe("questionnaire governance workspace scoped user behavior", () => {
  it("does not call formal APIs in demo or for revoked management permission", () => {
    const { rerender } = render(<QuestionnaireRuleWorkspace {...base} demo />);
    expect(reads.review).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "送交第二人核准" })).toBeNull();
    rerender(<QuestionnaireRuleWorkspace {...base} canManage={false} />);
    expect(reads.review).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("沒有規則管理權限");
  });

  it("allows a registered AAL2 candidate request, without claiming clinical signing is ready", async () => {
    render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    expect(send()).toHaveProperty("disabled", false);
    expect(screen.getByText("規則核准不等於正式評估簽署已開放。")).toBeDefined();
    expect(screen.queryByText(/目前生效/u)).toBeNull();
  });

  it("AAL1 can read but cannot request or independently approve", async () => {
    reads.review.mockResolvedValue(history([request(50, "pending", false)]));
    render(<QuestionnaireRuleWorkspace {...base} hasRecentAal2={false} />); await reviewLoaded();
    expect(send()).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "核准" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("link", { name: "重新確認身分" })).toBeDefined();
  });

  it("never offers self-approval and blocks a new request while another hash is pending", async () => {
    reads.review.mockResolvedValue(history([request(50, "pending", true, "spmsq", "b".repeat(64))]));
    render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    expect(send()).toHaveProperty("disabled", true); expect(screen.queryByRole("button", { name: "核准" })).toBeNull();
    fireEvent.change(screen.getByLabelText(/撤回理由/u), { target: { value: "改用目前題庫版本" } });
    expect(screen.getByRole("button", { name: "撤回申請" })).toHaveProperty("disabled", false);
  });

  it("a different candidate hash can be returned but never approved using the current content", async () => {
    reads.review.mockResolvedValue(history([request(50, "pending", false, "spmsq", "b".repeat(64))]));
    render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    expect(screen.getByRole("button", { name: "核准" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(/退回理由/u), { target: { value: "請重新確認原題庫" } });
    expect(screen.getByRole("button", { name: "退回修改" })).toHaveProperty("disabled", false);
  });

  it.each(["2026-02-29", "2026-9-26", "2026-09-25"])("rejects invalid or past effective start %s", async (value) => {
    render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    fireEvent.change(screen.getByLabelText("生效日（YYYY-MM-DD）"), { target: { value } });
    expect(send()).toHaveProperty("disabled", true);
  });

  it("keeps failed initial loading distinct from empty data", async () => {
    reads.review.mockRejectedValue(new RuleGovernanceClientError("forbidden", "沒有此分支權限"));
    render(<QuestionnaireRuleWorkspace {...base} />);
    await screen.findByRole("alert"); expect(screen.queryByText("尚無申請，可設定期間後送審。")).toBeNull();
    expect(screen.queryByRole("button", { name: "送交第二人核准" })).toBeNull();
  });

  it("ignores a late form response and aborts the old bounded read", async () => {
    const late = deferred<ReturnType<typeof history>>(); reads.review.mockReturnValueOnce(late.promise).mockResolvedValueOnce(history([], 0, false, "gds_15"));
    render(<QuestionnaireRuleWorkspace {...base} />);
    await waitFor(() => expect(reads.review).toHaveBeenCalledOnce());
    const oldSignal = reads.review.mock.calls[0]![3] as AbortSignal;
    fireEvent.change(screen.getByLabelText("評估量表"), { target: { value: "gds_15" } }); await reviewLoaded();
    await act(async () => late.resolve(history()));
    expect(oldSignal.aborted).toBe(true);
    expect(screen.getByLabelText("評估量表")).toHaveProperty("value", "gds_15");
    expect(reads.review).toHaveBeenCalledTimes(2);
  });

  it("does not keep stale history/actions after management permission is revoked", async () => {
    const { rerender } = render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    rerender(<QuestionnaireRuleWorkspace {...base} canManage={false} />);
    expect(screen.queryByRole("form", { name: "量表採用期間" })).toBeNull();
    expect(screen.queryByText("題庫已登錄")).toBeNull();
  });

  it("hides old scope immediately while the same-form new branch read waits", async () => {
    const pending = deferred<ReturnType<typeof history>>();
    reads.review.mockResolvedValueOnce(history()).mockReturnValueOnce(pending.promise);
    const { rerender } = render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    rerender(<QuestionnaireRuleWorkspace {...base} scope={{ ...scope, branchId: uuid(8) }} />);
    expect(screen.queryByText("題庫已登錄")).toBeNull();
    expect(screen.queryByRole("form", { name: "量表採用期間" })).toBeNull();
    await act(async () => pending.resolve(history([], 0, false, "spmsq", { ...scope, branchId: uuid(8) })));
    await reviewLoaded(); expect(send().getAttribute("data-branch")).toBe(uuid(8));
  });

  it("refresh invalidates an in-flight load-more without leaving its busy flag stuck", async () => {
    const first = history(Array.from({ length: 20 }, (_, index) => request(50 - index)), 21, true);
    const late = deferred<ReturnType<typeof history>>();
    reads.review.mockResolvedValueOnce(first).mockReturnValueOnce(late.promise).mockResolvedValueOnce(first);
    render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    fireEvent.click(screen.getByRole("button", { name: "載入較早紀錄" }));
    fireEvent.click(screen.getByRole("button", { name: "重新載入" }));
    await waitFor(() => expect(reads.review).toHaveBeenCalledTimes(3));
    await act(async () => late.resolve(history([request(20)], 21)));
    expect(screen.getByRole("button", { name: "載入較早紀錄" })).toHaveProperty("disabled", false);
    expect(screen.getByText(/已載入 20／21 件/u)).toBeDefined();
  });

  it("load-more permission denial pauses new writes rather than treating it as a partial non-auth error", async () => {
    reads.review.mockResolvedValueOnce(history(Array.from({ length: 20 }, (_, index) => request(50 - index)), 21, true))
      .mockRejectedValueOnce(new RuleGovernanceClientError("forbidden", "授權已撤銷"));
    render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    fireEvent.click(screen.getByRole("button", { name: "載入較早紀錄" })); await screen.findByRole("alert");
    expect((screen.queryByRole("button", { name: "送交第二人核准" }) as HTMLButtonElement | null)?.disabled ?? true).toBe(true);
  });

  it("never derives a cutoff from a merely pending retirement proposal", async () => {
    const approved = request(50, "approved"); const activation = approved.activation!;
    const pending: RuleRetirementRequest = { requestId: uuid(500), activationId: activation.activationId, formKey: "spmsq",
      catalogHash: activation.catalogHash, effectiveThrough: "2026-10-15", reason: "改用下一個規則版本",
      requestedBy: scope.userId, byCurrentUser: true, requestedAt: at(55), status: "pending", decision: null, retirement: null };
    reads.review.mockResolvedValue(history([approved])); reads.retirement.mockResolvedValue(retirement(activation, [pending]));
    render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    fireEvent.change(screen.getByLabelText(/核准版本/u), { target: { value: activation.activationId } });
    await screen.findByText("原核准截止：未設定 · 現行截止（含當日）：未設定");
    expect(screen.getByRole("button", { name: "申請版本退休" })).toHaveProperty("disabled", true);
    expect(screen.queryByText(/已核准新的截止日/u)).toBeNull();
  });

  it("honors derived approved cutoff when approved request is outside the bounded history page", async () => {
    const approved = request(50, "approved"); const activation = approved.activation!;
    reads.review.mockResolvedValue(history([approved])); reads.retirement.mockResolvedValue(retirement(activation, [], 21, "2026-10-15"));
    render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    fireEvent.change(screen.getByLabelText(/核准版本/u), { target: { value: activation.activationId } });
    await screen.findByText(/已核准新的截止日/u);
    expect(screen.queryByRole("button", { name: "申請版本退休" })).toBeNull();
    expect(screen.getByText("原核准截止：未設定 · 現行截止（含當日）：2026-10-15")).toBeDefined();
  });

  it("rejects retirement metadata from another catalog even if the activation ID matches", async () => {
    const approved = request(50, "approved"); const activation = approved.activation!;
    reads.review.mockResolvedValue(history([approved])); reads.retirement.mockResolvedValue({ ...retirement(activation), catalogHash: "f".repeat(64) });
    render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    fireEvent.change(screen.getByLabelText(/核准版本/u), { target: { value: activation.activationId } });
    await screen.findByRole("alert"); expect(screen.queryByRole("button", { name: "申請版本退休" })).toBeNull();
    expect(screen.queryByText(/現行截止/u)).toBeNull();
  });

  it("rejects a premature or non-shortening retirement cutoff", async () => {
    const approved = request(50, "approved"); approved.effectiveTo = "2026-12-31";
    approved.activation!.effectiveTo = "2026-12-31"; const activation = approved.activation!;
    reads.review.mockResolvedValue(history([approved])); reads.retirement.mockResolvedValue(retirement(activation, [], 0, "2026-12-31"));
    render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    fireEvent.change(screen.getByLabelText(/核准版本/u), { target: { value: activation.activationId } });
    await screen.findByLabelText(/退休理由/u);
    fireEvent.change(screen.getByLabelText(/退休理由/u), { target: { value: "改用下一個規則版本" } });
    for (const cutoff of ["2026-09-30", "2026-12-31", "2026-02-29"]) {
      fireEvent.change(screen.getByLabelText(/新截止日/u), { target: { value: cutoff } });
      expect(screen.getByRole("button", { name: "申請版本退休" })).toHaveProperty("disabled", true);
    }
    fireEvent.change(screen.getByLabelText(/新截止日/u), { target: { value: "2026-10-15" } });
    expect(screen.getByRole("button", { name: "申請版本退休" })).toHaveProperty("disabled", false);
  });

  it("retirement activation changes abort and ignore late cutoff metadata and reset the reason", async () => {
    const a = request(50, "approved"); const b = request(40, "approved");
    const late = deferred<ReturnType<typeof retirement>>();
    reads.review.mockResolvedValue(history([a, b])); reads.retirement.mockResolvedValueOnce(retirement(a.activation!))
      .mockReturnValueOnce(late.promise).mockResolvedValueOnce(retirement(a.activation!));
    render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    fireEvent.change(screen.getByLabelText(/核准版本/u), { target: { value: a.activation!.activationId } });
    await screen.findByLabelText(/退休理由/u);
    fireEvent.change(screen.getByLabelText(/退休理由/u), { target: { value: "不可沿用到另一個版本" } });
    fireEvent.change(screen.getByLabelText(/核准版本/u), { target: { value: b.activation!.activationId } });
    await waitFor(() => expect(reads.retirement).toHaveBeenCalledTimes(2));
    const oldSignal = reads.retirement.mock.calls[1]![3] as AbortSignal;
    fireEvent.change(screen.getByLabelText(/核准版本/u), { target: { value: a.activation!.activationId } });
    await screen.findByLabelText(/退休理由/u);
    await act(async () => late.resolve(retirement(b.activation!, [], 21, "2026-10-15")));
    expect(oldSignal.aborted).toBe(true); expect(screen.getByLabelText(/退休理由/u)).toHaveProperty("value", "");
    expect(screen.getByText("原核准截止：未設定 · 現行截止（含當日）：未設定")).toBeDefined();
    expect(screen.queryByText(/已核准新的截止日/u)).toBeNull();
  });

  it("retirement load-more denial pauses the visible selected activation", async () => {
    const approved = request(50, "approved"); const activation = approved.activation!;
    reads.review.mockResolvedValue(history([approved])); reads.retirement.mockResolvedValueOnce(retirement(activation,
      Array.from({ length: 20 }, (_, index) => retirementRequest(activation, 50 - index)), 21, null, true))
      .mockRejectedValueOnce(new RuleGovernanceClientError("unconfirmed", "退休紀錄逾時"));
    render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    fireEvent.change(screen.getByLabelText(/核准版本/u), { target: { value: activation.activationId } });
    await screen.findByRole("button", { name: "載入較早退休紀錄" });
    fireEvent.change(screen.getByLabelText(/退休理由/u), { target: { value: "改用下一個規則版本" } });
    fireEvent.change(screen.getByLabelText(/新截止日/u), { target: { value: "2026-10-15" } });
    expect(screen.getByRole("button", { name: "申請版本退休" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "載入較早退休紀錄" })); await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "申請版本退休" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "重新載入退休紀錄" })).toBeDefined();
  });

  it("older pending records cannot be approved or silently permit a new proposal", async () => {
    reads.review.mockResolvedValueOnce(history(Array.from({ length: 20 }, (_, index) => request(50 - index)), 21, true))
      .mockResolvedValueOnce(history([request(20, "pending", false)], 21));
    render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    fireEvent.click(screen.getByRole("button", { name: "載入較早紀錄" }));
    await screen.findByRole("button", { name: "核准" });
    expect(screen.getByRole("button", { name: "核准" })).toHaveProperty("disabled", true);
    expect(send()).toHaveProperty("disabled", true);
  });

  it("same-branch actor changes hide the old actor's application while fresh history waits", async () => {
    const waiting = deferred<ReturnType<typeof history>>();
    reads.review.mockResolvedValueOnce(history([request(50, "pending", true)])).mockReturnValueOnce(waiting.promise);
    const { rerender } = render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    expect(screen.getByText("申請人不能核准自己的申請。")).toBeDefined();
    rerender(<QuestionnaireRuleWorkspace {...base} scope={{ ...scope, userId: other }} />);
    expect(screen.queryByText("申請人不能核准自己的申請。")).toBeNull();
    expect(screen.queryByRole("button", { name: "核准" })).toBeNull();
  });

  it("does not reuse the former actor's retirement decision flags after new review data has arrived", async () => {
    const approved = request(50, "approved"); const activation = approved.activation!;
    const pending = { ...retirementRequest(activation, 55), status: "pending" as const, decision: null };
    const nextScope = { ...scope, userId: other };
    const nextApproved: RuleReviewRequest = { ...approved, byCurrentUser: false,
      decision: { ...approved.decision!, byCurrentUser: true } };
    const waiting = deferred<ReturnType<typeof retirement>>();
    reads.review.mockResolvedValueOnce(history([approved])).mockResolvedValueOnce(history([nextApproved], 1, false, "spmsq", nextScope));
    reads.retirement.mockResolvedValueOnce(retirement(activation, [pending])).mockReturnValueOnce(waiting.promise);
    const { rerender } = render(<QuestionnaireRuleWorkspace {...base} />); await reviewLoaded();
    fireEvent.change(screen.getByLabelText(/核准版本/u), { target: { value: activation.activationId } });
    await screen.findByRole("button", { name: "核准" });
    expect(screen.getByRole("button", { name: "核准" })).toHaveProperty("disabled", false);
    rerender(<QuestionnaireRuleWorkspace {...base} scope={nextScope} />);
    await waitFor(() => expect(reads.retirement).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "核准" })).toBeNull();
    expect(screen.queryByText(/現行截止/u)).toBeNull();
  });
});
