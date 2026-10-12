// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionnaireRuleGovernance } from "./questionnaire-rule-governance";
import type { QuestionnaireGovernanceSnapshot } from "@/lib/questionnaire-assessments/governance";
import { getScopeChangePendingReason } from "@/lib/navigation/scope-change-pending";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const snapshot: QuestionnaireGovernanceSnapshot = { generatedAt: "2026-10-11T01:00:00Z",
  catalogue: [{ formKey: "spmsq", formVersion: "test-v1", catalogHash: "a".repeat(64), title: "合成 SPMSQ", questionCount: 10, sources: [], rule: {} }],
  publications: [{ publicationId: "11111111-1111-4111-8111-111111111111", formKey: "spmsq", formVersion: "test-v1", effectiveFrom: "2026-10-10", effectiveTo: null,
    evidenceReference: "合成審查文件", requestedAt: "2026-10-10T01:00:00Z", requestedBy: "22222222-2222-4222-8222-222222222222", requestedName: "合成提案人",
    approvedAt: null, approvedName: null, canApprove: false, status: "pending" }],
};
function navigationAttempt() {
  const anchor = document.createElement("a"); anchor.href = "/app/staff/workspace/case-center"; document.body.append(anchor);
  let capturedDefault: boolean | undefined;
  anchor.addEventListener("click", event => { capturedDefault = event.defaultPrevented; event.preventDefault(); });
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }); fireEvent(anchor, event); anchor.remove();
  return capturedDefault ?? event.defaultPrevented;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("questionnaire governance UI", () => {
  it("does not offer self-approval and names pending status accurately", () => {
    render(<QuestionnaireRuleGovernance snapshot={snapshot} />);
    expect(screen.getByText("待第二人覆核")).toBeVisible();
    expect(screen.queryByRole("button", { name: "核對公式、題目與文件後發布" })).not.toBeInTheDocument();
  });
  it("allows only an independent approver to call the bound approval action", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: "ok", data: { publicationId: snapshot.publications[0].publicationId, status: "approved", replayed: false } }));
    vi.stubGlobal("fetch", fetch);
    render(<QuestionnaireRuleGovernance snapshot={{ ...snapshot, publications: [{ ...snapshot.publications[0], canApprove: true }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "核對公式、題目與文件後發布" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: "approve", publicationId: snapshot.publications[0].publicationId });
    expect(screen.getByText("規則已由第二人覆核發布。")).toBeVisible();
  });
  it("guards publication input on scope changes and unload until explicit discard", () => {
    render(<QuestionnaireRuleGovernance snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("審查／授權文件編號"), { target: { value: "合成待送審文件" } });
    expect(getScopeChangePendingReason()).toBe("dirty");
    expect(navigationAttempt()).toBe(true);
    expect(screen.getByText(/請先送出提案或清除未送出內容/u)).toBeVisible();
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "清除未送出內容" }));
    expect(screen.getByLabelText("審查／授權文件編號")).toHaveValue("");
    expect(getScopeChangePendingReason()).toBeNull();
    expect(navigationAttempt()).toBe(false);
    const cleanUnload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
  });
  it("retains proposal inputs through an invalid receipt and clears them after the original retry is confirmed", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: { publicationId: "not-an-id", status: "pending", replayed: false } }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { publicationId: snapshot.publications[0].publicationId, status: "pending", replayed: true } }));
    vi.stubGlobal("fetch", fetch); render(<QuestionnaireRuleGovernance snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("生效日"), { target: { value: "2026-10-12" } });
    fireEvent.change(screen.getByLabelText("審查／授權文件編號"), { target: { value: "合成待送審文件" } });
    fireEvent.submit(screen.getByLabelText("生效日").closest("form")!);
    await screen.findByRole("button", { name: "重試同一次操作" });
    expect(screen.getByLabelText("審查／授權文件編號")).toHaveValue("合成待送審文件");
    expect(screen.getByLabelText("生效日")).toBeDisabled();
    expect(refresh).not.toHaveBeenCalled(); expect(getScopeChangePendingReason()).toBe("unknown");
    expect(navigationAttempt()).toBe(true);
    expect(screen.queryByRole("button", { name: "清除未送出內容" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "在新分頁完成近期驗證" })).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/原頁.*新分頁/u)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重試同一次操作" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    expect(fetch.mock.calls[0][1].headers["idempotency-key"]).toBe(fetch.mock.calls[1][1].headers["idempotency-key"]);
    expect(screen.getByLabelText("審查／授權文件編號")).toHaveValue(""); expect(getScopeChangePendingReason()).toBeNull();
    expect(navigationAttempt()).toBe(false);
  });
  it("does not accept an approval receipt for a different publication", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: "ok", data: { publicationId: "33333333-3333-4333-8333-333333333333", status: "approved", replayed: false } }));
    vi.stubGlobal("fetch", fetch); render(<QuestionnaireRuleGovernance snapshot={{ ...snapshot, publications: [{ ...snapshot.publications[0], canApprove: true }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "核對公式、題目與文件後發布" }));
    await screen.findByRole("button", { name: "重試同一次操作" }); expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText("規則已由第二人覆核發布。")).not.toBeInTheDocument();
  });
  it("keeps an unrelated unsent proposal after approving another publication", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: "ok", data: { publicationId: snapshot.publications[0].publicationId, status: "approved", replayed: false } }));
    vi.stubGlobal("fetch", fetch); render(<QuestionnaireRuleGovernance snapshot={{ ...snapshot, publications: [{ ...snapshot.publications[0], canApprove: true }] }} />);
    fireEvent.change(screen.getByLabelText("審查／授權文件編號"), { target: { value: "另外一份待送出的合成文件" } });
    fireEvent.click(screen.getByRole("button", { name: "核對公式、題目與文件後發布" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByLabelText("審查／授權文件編號")).toHaveValue("另外一份待送出的合成文件");
    expect(getScopeChangePendingReason()).toBe("dirty");
  });
  it("focuses and associates invalid publication fields without discarding input or sending a write", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<QuestionnaireRuleGovernance snapshot={snapshot} />);
    const from = screen.getByLabelText("生效日");
    expect(from.closest("form")).toHaveAttribute("novalidate");
    fireEvent.submit(from.closest("form")!);
    expect(from).toHaveFocus(); expect(from).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(from, { target: { value: "2026-10-12" } });
    fireEvent.change(screen.getByLabelText("終止日（選填）"), { target: { value: "2026-10-11" } });
    fireEvent.change(screen.getByLabelText("審查／授權文件編號"), { target: { value: "已輸入的合成文件" } });
    fireEvent.submit(from.closest("form")!);
    expect(screen.getByLabelText("終止日（選填）")).toHaveFocus();
    expect(screen.getByLabelText("終止日（選填）")).toHaveAccessibleDescription("終止日不可早於生效日。");
    expect(screen.getByLabelText("審查／授權文件編號")).toHaveValue("已輸入的合成文件"); expect(fetch).not.toHaveBeenCalled();
  });
});
