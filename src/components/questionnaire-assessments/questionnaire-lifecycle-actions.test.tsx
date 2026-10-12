// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionnaireLifecycleActions } from "./questionnaire-lifecycle-actions";
import type { QuestionnaireDraft } from "@/lib/questionnaire-assessments/types";
import { getScopeChangePendingReason } from "@/lib/navigation/scope-change-pending";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
const record: QuestionnaireDraft = { assessmentKey: "11111111-1111-4111-8111-111111111111", versionId: "22222222-2222-4222-8222-222222222222",
  version: 1, formVersion: "spmsq-pfeiffer-10-education-adjusted-v1", assessedOn: "2026-10-10", answers: {}, context: {},
  authorDisplayName: "合成評估人", createdAt: "2026-10-10T01:00:00Z", contentHash: "a".repeat(64), recordState: "draft", isLatest: true };
function component(extra: Partial<Parameters<typeof QuestionnaireLifecycleActions>[0]> = {}) {
  return <QuestionnaireLifecycleActions record={record} clientId="33333333-3333-4333-8333-333333333333" formKey="spmsq"
    canManage canSign complete dirty={false} safetyConcern={false} onWriteGuardChange={vi.fn()} {...extra} />;
}
function receipt(action: "submit" | "correct" = "submit", extra: Record<string, unknown> = {}) {
  return { action, clientId: "33333333-3333-4333-8333-333333333333", formKey: "spmsq", assessmentKey: record.assessmentKey,
    versionId: "44444444-4444-4444-8444-444444444444", version: 2, recordState: action === "submit" ? "submitted" : "draft",
    assessedOn: record.assessedOn, contentHash: record.contentHash, committedAt: "2026-10-12T01:00:00Z", replayed: false, ...extra };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("questionnaire operational lifecycle", () => {
  it("allows saved complete draft to be submitted, but not missing or dirty content", () => {
    const view = render(component({ dirty: true }));
    expect(screen.getByRole("button", { name: "送審" })).toBeDisabled();
    view.rerender(component({ complete: false })); expect(screen.getByRole("button", { name: "送審" })).toBeDisabled();
    view.rerender(component()); expect(screen.getByRole("button", { name: "送審" })).toBeEnabled();
  });
  it("holds candidate score and sign until actual governance publication", () => {
    const view = render(component({ record: { ...record, recordState: "submitted", ruleAvailable: false } }));
    expect(screen.getByRole("button", { name: "確認內容並簽署" })).toBeDisabled();
    view.rerender(component({ record: { ...record, recordState: "submitted", ruleAvailable: true } }));
    expect(screen.getByRole("button", { name: "確認內容並簽署" })).toBeEnabled();
  });
  it("requires manual safety confirmation before submitting a BSRS concern", () => {
    render(component({ safetyConcern: true, formKey: "bsrs5" }));
    expect(screen.getByRole("button", { name: "送審" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox")); expect(screen.getByRole("button", { name: "送審" })).toBeEnabled();
  });
  it("keeps pending-intake questionnaires draft-only even when a caller supplies signing permission", () => {
    render(component({ draftOnly: true }));
    expect(screen.getByText("待收案 · 可保存草稿，確認收案後再送審。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "送審" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "確認內容並簽署" })).not.toBeInTheDocument();
  });
  it("withholds all mutations for historical or non-signing viewers", () => {
    const view = render(component({ record: { ...record, isLatest: false } }));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    view.rerender(component({ record: { ...record, recordState: "signed" }, canSign: false }));
    expect(screen.queryByText("建立更正版")).not.toBeInTheDocument();
  });
  it("requires correction reason and appends a bound request rather than editing original", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: "ok", data: receipt("correct") }));
    vi.stubGlobal("fetch", fetch); render(component({ record: { ...record, recordState: "signed" } }));
    fireEvent.click(screen.getByText("建立更正版"));
    expect(screen.getByRole("button", { name: "建立更正草稿" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("原因"), { target: { value: "合成更正原因" } });
    fireEvent.click(screen.getByRole("button", { name: "建立更正草稿" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ action: "correct", previousVersionId: record.versionId, expectedVersion: 1, reason: "合成更正原因" });
  });
  it("retains same idempotency key and content after an unknown response", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: receipt() }));
    vi.stubGlobal("fetch", fetch); render(component());
    fireEvent.click(screen.getByRole("button", { name: "送審" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "重試同一次操作" })).toBeVisible());
    expect(screen.getByRole("button", { name: "送審" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重試同一次操作" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    expect(fetch.mock.calls[0][1].headers["idempotency-key"]).toBe(fetch.mock.calls[1][1].headers["idempotency-key"]);
  });
  it.each(["followUp", "safety", "reason"])("protects unsaved %s and clears only by an explicit discard", (field) => {
    const onDirtyChange = vi.fn();
    render(component({ onDirtyChange, safetyConcern: field === "safety", ...(field === "reason" ? { record: { ...record, recordState: "signed" as const } } : {}) }));
    if (field === "followUp") fireEvent.change(screen.getByLabelText("複評日期（選填）"), { target: { value: "2026-11-10" } });
    if (field === "safety") fireEvent.click(screen.getByRole("checkbox"));
    if (field === "reason") fireEvent.change(screen.getByLabelText("原因"), { target: { value: "待送出的合成更正原因" } });
    expect(getScopeChangePendingReason()).toBe("dirty");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "清除未送出的送審／補正內容" }));
    expect(getScopeChangePendingReason()).toBeNull();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it("preserves follow-up input and its exact retry until a matching receipt confirms success", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: receipt("submit", { clientId: record.assessmentKey }) }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: receipt() }));
    vi.stubGlobal("fetch", fetch); render(component());
    fireEvent.change(screen.getByLabelText("複評日期（選填）"), { target: { value: "2026-11-10" } });
    fireEvent.click(screen.getByRole("button", { name: "送審" }));
    await screen.findByRole("button", { name: "重試同一次操作" });
    expect(screen.getByLabelText("複評日期（選填）")).toHaveValue("2026-11-10");
    expect(getScopeChangePendingReason()).toBe("unknown"); expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重試同一次操作" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    expect(fetch.mock.calls[0][1].headers["idempotency-key"]).toBe(fetch.mock.calls[1][1].headers["idempotency-key"]);
    expect(getScopeChangePendingReason()).toBeNull();
  });
  it("requires explicit clearing of an unsent return reason before signing", () => {
    render(component({ record: { ...record, recordState: "submitted", ruleAvailable: true } }));
    fireEvent.change(screen.getByLabelText("原因"), { target: { value: "尚未送出的退回原因" } });
    expect(screen.getByRole("button", { name: "確認內容並簽署" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "退回補正" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "清除未送出的送審／補正內容" }));
    expect(screen.getByRole("button", { name: "確認內容並簽署" })).toBeEnabled();
  });
});
