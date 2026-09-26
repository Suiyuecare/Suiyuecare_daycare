// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const adapter = vi.hoisted(() => ({ review: vi.fn(), retirement: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/questionnaire-assessments/rule-governance-client", async (original) => ({
  ...await original<typeof import("@/lib/questionnaire-assessments/rule-governance-client")>(),
  readRuleReview: adapter.review, readRuleRetirement: adapter.retirement, writeRuleGovernance: adapter.write,
}));

import { hasPendingOperations } from "@/lib/navigation/pending-operation-lock";
import { buildQuestionnaireRuleCatalogEntry } from "@/lib/questionnaire-assessments/rule-catalog";
import { RuleGovernanceClientError } from "@/lib/questionnaire-assessments/rule-governance-client";
import { parseRuleReviewHistory, parseRuleReviewReceipt, type RuleReviewInput, type RuleReviewRequest } from "@/lib/questionnaire-assessments/rule-review-contract";
import { parseRuleRetirementHistory, parseRuleRetirementReceipt, type RuleRetirementInput, type RuleRetirementRequest } from "@/lib/questionnaire-assessments/rule-retirement-shared";
import { QuestionnaireRuleWorkspace } from "./questionnaire-rule-workspace";

// Real workspace + action + shared dialog + tab-local lease are integrated here.
// Only the pure read/write adapter is mocked; these are not hosted HTTP proofs.
const uuid = (value: number) => `ac000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const scope = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3) };
const other = uuid(4);
const timestamp = "2026-09-26T08:00:00.000001Z";
const later = "2026-09-26T08:01:00.000001Z";
const today = "2026-09-26";
const catalog = buildQuestionnaireRuleCatalogEntry("spmsq");
const activationId = uuid(10);
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

function reviewRequest(): RuleReviewRequest {
  return { requestId: uuid(5), formKey: "spmsq", catalogHash: catalog.catalogHash,
    effectiveFrom: today, effectiveTo: null, requestedBy: scope.userId, byCurrentUser: true,
    requestedAt: timestamp, status: "pending", decision: null, activation: null };
}
function approvedReview(): RuleReviewRequest {
  return { ...reviewRequest(), status: "approved", decision: { eventId: uuid(6), action: "approve", actorId: other,
    byCurrentUser: false, reason: null, createdAt: later }, activation: { activationId, catalogHash: catalog.catalogHash,
      effectiveFrom: today, effectiveTo: null, activatedAt: later } };
}
function reviewHistory(requests: RuleReviewRequest[] = []) {
  const history = { organizationId: scope.organizationId, branchId: scope.branchId, formKey: "spmsq" as const,
    catalogs: [{ formKey: "spmsq" as const, formVersion: catalog.formVersion, ruleVersion: catalog.ruleVersion,
      ruleRevision: catalog.manifest.ruleRevision, catalogHash: catalog.catalogHash }], requests, total: requests.length,
    nextCursor: null, generatedAt: later };
  parseRuleReviewHistory(history, scope, "spmsq", null);
  return { ...history, candidate: { ...catalog, registered: true, adoptionRequired: true as const, metadata: {
    title: catalog.manifest.form.title, sourceLabel: catalog.manifest.form.sourceLabel,
    sourceUrl: catalog.manifest.form.sourceUrl ?? null, questionCount: catalog.manifest.form.questions.length,
  } } };
}
function retirementRequest(): RuleRetirementRequest {
  return { requestId: uuid(7), activationId, formKey: "spmsq", catalogHash: catalog.catalogHash,
    effectiveThrough: "2026-09-30", reason: "改用下一個規則版本", requestedBy: scope.userId, byCurrentUser: true,
    requestedAt: timestamp, status: "pending", decision: null, retirement: null };
}
function retirementHistory(requests: RuleRetirementRequest[] = []) {
  const history = { organizationId: scope.organizationId, branchId: scope.branchId, activationId,
    formKey: "spmsq" as const, catalogHash: catalog.catalogHash, originalEffectiveTo: null, effectiveThrough: null,
    requests, total: requests.length, nextCursor: null, generatedAt: later };
  parseRuleRetirementHistory(history, scope, activationId, null);
  return history;
}
function receipt(kind: "review" | "retirement", input: RuleReviewInput | RuleRetirementInput, operationId: string) {
  const common = { organizationId: scope.organizationId, branchId: scope.branchId, actorId: scope.userId,
    operationId, eventId: uuid(8), committedAt: timestamp, action: "request", formKey: "spmsq",
    catalogHash: catalog.catalogHash, replayed: false };
  if (kind === "review") return parseRuleReviewReceipt({ ...common, request: reviewRequest() }, scope, input as RuleReviewInput, operationId);
  return parseRuleRetirementReceipt({ ...common, activationId, request: retirementRequest() }, scope, input as RuleRetirementInput, operationId);
}
function submit(label: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  const dialog = screen.getByRole("dialog", { name: label });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "我已核對此分支、版本與申請內容" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "確認送出" }));
}

beforeEach(() => {
  adapter.review.mockReset(); adapter.retirement.mockReset(); adapter.write.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
  adapter.write.mockImplementation(async (_scope, kind, input, operationId) => receipt(kind, input, operationId));
  expect(hasPendingOperations()).toBe(false);
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  for (const [name, original] of [["showModal", originalShowModal], ["close", originalClose]] as const) {
    if (original) Object.defineProperty(HTMLDialogElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

describe("validated save followed by failed authoritative read retains a usable recovery dialog", () => {
  it("review request keeps the saved-stale modal and lease, then retries GET only", async () => {
    adapter.review.mockResolvedValueOnce(reviewHistory())
      .mockRejectedValueOnce(new RuleGovernanceClientError("unconfirmed", "合成 GET 503：未確認讀取"))
      .mockResolvedValueOnce(reviewHistory([reviewRequest()]));
    render(<QuestionnaireRuleWorkspace scope={scope} canManage hasRecentAal2 demo={false} today={today} />);
    await screen.findByRole("form", { name: "量表採用期間" });
    submit("送交第二人核准");
    const retry = await screen.findByRole("button", { name: "重新載入清單" });
    const dialog = screen.getByRole("dialog", { name: "送交第二人核准" });
    expect(within(dialog).getByRole("alert").textContent).toContain("已保存，但清單尚未更新");
    expect(dialog).toHaveProperty("open", true); expect(hasPendingOperations()).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByLabelText("評估量表")).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveProperty("disabled", true);
    fireEvent.keyDown(dialog, { key: "Escape" }); expect(dialog).toHaveProperty("open", true);
    expect(adapter.write).toHaveBeenCalledOnce(); expect(adapter.review).toHaveBeenCalledTimes(2);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(adapter.write).toHaveBeenCalledOnce(); expect(adapter.review).toHaveBeenCalledTimes(3);
    expect(hasPendingOperations()).toBe(false);
    expect(screen.getByLabelText("評估量表")).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "送交第二人核准" })).toHaveProperty("disabled", true);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "評估量表規則審核" }));
  });

  it("retirement request keeps bound history and saved-stale recovery through GET failure", async () => {
    adapter.review.mockResolvedValue(reviewHistory([approvedReview()]));
    adapter.retirement.mockResolvedValueOnce(retirementHistory())
      .mockRejectedValueOnce(new RuleGovernanceClientError("unconfirmed", "合成 GET 503：未確認讀取"))
      .mockResolvedValueOnce(retirementHistory([retirementRequest()]));
    render(<QuestionnaireRuleWorkspace scope={scope} canManage hasRecentAal2 demo={false} today={today} />);
    await screen.findByRole("form", { name: "量表採用期間" });
    fireEvent.change(screen.getByLabelText(/核准版本/u), { target: { value: activationId } });
    await screen.findByLabelText(/退休理由/u);
    fireEvent.change(screen.getByLabelText(/退休理由/u), { target: { value: "改用下一個規則版本" } });
    fireEvent.change(screen.getByLabelText(/新截止日/u), { target: { value: "2026-09-30" } });
    submit("申請版本退休");
    const retry = await screen.findByRole("button", { name: "重新載入清單" });
    const dialog = screen.getByRole("dialog", { name: "申請版本退休" });
    expect(within(dialog).getByRole("alert").textContent).toContain("已保存，但清單尚未更新");
    expect(dialog).toHaveProperty("open", true); expect(hasPendingOperations()).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByLabelText(/核准版本/u)).toHaveProperty("disabled", true);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(adapter.write).toHaveBeenCalledOnce(); expect(adapter.retirement).toHaveBeenCalledTimes(3);
    expect(adapter.review).toHaveBeenCalledOnce(); expect(hasPendingOperations()).toBe(false);
    expect(screen.getByRole("button", { name: "申請版本退休" })).toHaveProperty("disabled", true);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "評估量表規則審核" }));
  });
});
