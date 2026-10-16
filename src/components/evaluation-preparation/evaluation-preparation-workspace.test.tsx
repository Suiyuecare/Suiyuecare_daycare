// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationPreparationSnapshot } from "@/lib/evaluation-preparation/contract";
import { EvaluationPreparationWorkspace } from "./evaluation-preparation-workspace";
import { UnknownPreparationOutcome } from "./evaluation-preparation-request";
import { getHeldEvaluationPreparationOperation, settleEvaluationPreparationOperation } from "./evaluation-preparation-pending";

const stubs = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: stubs.refresh }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("./evaluation-preparation-request", async (importOriginal) => ({
  ...await importOriginal<typeof import("./evaluation-preparation-request")>(),
  sendEvaluationPreparationOperation: stubs.send,
}));

const actorUserId = "79000000-0000-4000-8000-000000000001";
function snapshot(): EvaluationPreparationSnapshot {
  const now = Date.now();
  return { organizationId: "79100000-0000-4000-8000-000000000001",
    branchId: "79200000-0000-4000-8000-000000000001", generatedAt: new Date(now).toISOString(),
    staleAfter: new Date(now + 300_000).toISOString(), page: 1, pageSize: 25, total: 0,
    items: [], owners: [], sourceStatus: "applicability_unapproved", formalSubmissionEnabled: false, demo: false };
}

beforeEach(() => { stubs.send.mockReset(); stubs.refresh.mockReset(); window.sessionStorage.clear(); });
afterEach(() => {
  cleanup();
  const held = getHeldEvaluationPreparationOperation();
  if (held) settleEvaluationPreparationOperation(held.operation);
  window.sessionStorage.clear();
});

describe("Page 79 navigation recovery", () => {
  it("retains the frozen request and key through page navigation and Back/Forward", async () => {
    stubs.send.mockRejectedValueOnce(new UnknownPreparationOutcome("結果未知"))
      .mockRejectedValueOnce(new UnknownPreparationOutcome("仍未知"));
    const first = render(<EvaluationPreparationWorkspace snapshot={snapshot()} actorUserId={actorUserId} />);
    fireEvent.click(screen.getByRole("button", { name: "新增準備項目" }));
    fireEvent.change(screen.getByRole("textbox", { name: "內部項目代碼" }), { target: { value: "WANHUA_01" } });
    fireEvent.click(screen.getByRole("button", { name: "保存內部版本" }));
    await waitFor(() => expect(getHeldEvaluationPreparationOperation()?.phase).toBe("unknown"));
    const original = getHeldEvaluationPreparationOperation()!.operation;
    expect(screen.getByRole("button", { name: "新增準備項目" }).hasAttribute("disabled")).toBe(true);

    first.unmount(); // Navigate to another route while the result is unresolved.
    window.history.pushState({}, "", "/app/staff/operations/evaluations?page=2");
    window.dispatchEvent(new PopStateEvent("popstate"));
    const second = render(<EvaluationPreparationWorkspace snapshot={snapshot()} actorUserId={actorUserId} />);
    fireEvent.click(screen.getByRole("button", { name: "同一操作核對與重試" }));
    await waitFor(() => expect(getHeldEvaluationPreparationOperation()?.phase).toBe("unknown"));
    expect(stubs.send).toHaveBeenNthCalledWith(2, original, true);
    expect(getHeldEvaluationPreparationOperation()?.operation).toBe(original);

    second.unmount(); // Return from history again; use the original key once more.
    window.history.pushState({}, "", "/app/staff/operations/evaluations?page=1");
    window.dispatchEvent(new PopStateEvent("popstate"));
    stubs.send.mockResolvedValueOnce({ replayed: true, result: { itemCode: "WANHUA_01", version: 1 } });
    render(<EvaluationPreparationWorkspace snapshot={snapshot()} actorUserId={actorUserId} />);
    fireEvent.click(screen.getByRole("button", { name: "同一操作核對與重試" }));
    await waitFor(() => expect(getHeldEvaluationPreparationOperation()).toBeNull());
    expect(stubs.send).toHaveBeenNthCalledWith(3, original, true);
    expect(window.sessionStorage.getItem("evaluation-preparation-unresolved-v1")).toBeNull();
    expect(stubs.refresh).toHaveBeenCalledOnce();
  });
  it("blocks a fresh write after reload when the original key is unavailable", async () => {
    window.sessionStorage.setItem("evaluation-preparation-unresolved-v1", "1");
    render(<EvaluationPreparationWorkspace snapshot={snapshot()} actorUserId={actorUserId} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "新增準備項目" }).hasAttribute("disabled")).toBe(true));
    expect(screen.getByText(/前次保存結果尚未確認/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新增準備項目" }));
    expect(stubs.send).not.toHaveBeenCalled();
  });
});
