// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasPendingOperations } from "@/lib/navigation/pending-operation-lock";
import {
  beginEvaluationPreparationOperation, getHeldEvaluationPreparationOperation,
  hasLostEvaluationPreparationOperation, markEvaluationPreparationUnknown,
  retryEvaluationPreparationOperation, settleEvaluationPreparationOperation,
  useHeldEvaluationPreparationOperation,
} from "./evaluation-preparation-pending";
import type { EvaluationPreparationOperation } from "./evaluation-preparation-request";

const operation: EvaluationPreparationOperation = {
  idempotencyKey: "79800000-0000-4000-8000-000000000001",
  organizationId: "79100000-0000-4000-8000-000000000001",
  branchId: "79200000-0000-4000-8000-000000000001",
  actorUserId: "79000000-0000-4000-8000-000000000001",
  input: { itemCode: "WANHUA_01", expectedVersion: 0, ownerUserId: null, dueOn: null,
    evidenceReference: null, progress: "collecting", changeReason: "initial" },
};
function Observer() {
  const held = useHeldEvaluationPreparationOperation();
  return <p>{held ? `${held.phase}:${held.operation.idempotencyKey}` : "clear"}</p>;
}
afterEach(() => {
  cleanup();
  const held = getHeldEvaluationPreparationOperation();
  if (held) settleEvaluationPreparationOperation(held.operation);
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Page 79 tab-local recovery", () => {
  it("keeps the same operation and lease across route navigation and Back/Forward remounts", () => {
    const first = render(<Observer />);
    act(() => { expect(beginEvaluationPreparationOperation(() => operation)).toBe(operation); });
    expect(hasPendingOperations()).toBe(true);
    act(() => markEvaluationPreparationUnknown(operation));
    first.unmount();
    window.history.pushState({}, "", "/app/staff/operations/evaluations?page=2");
    window.dispatchEvent(new PopStateEvent("popstate"));
    const second = render(<Observer />);
    expect(screen.getByText(`unknown:${operation.idempotencyKey}`)).toBeTruthy();
    expect(getHeldEvaluationPreparationOperation()?.operation).toBe(operation);
    second.unmount();
    window.history.pushState({}, "", "/app/staff/operations/evaluations?page=1");
    window.dispatchEvent(new PopStateEvent("popstate"));
    render(<Observer />);
    act(() => expect(retryEvaluationPreparationOperation(operation)).toBe(true));
    expect(screen.getByText(`busy:${operation.idempotencyKey}`)).toBeTruthy();
    expect(beginEvaluationPreparationOperation(() => ({ ...operation, idempotencyKey: crypto.randomUUID() }))).toBeNull();
    act(() => markEvaluationPreparationUnknown(operation));
    expect(hasPendingOperations()).toBe(true);
    act(() => settleEvaluationPreparationOperation(operation));
    expect(screen.getByText("clear")).toBeTruthy();
    expect(hasPendingOperations()).toBe(false);
  });
  it("fails closed after a document reload loses the in-memory key", async () => {
    beginEvaluationPreparationOperation(() => operation);
    markEvaluationPreparationUnknown(operation);
    vi.resetModules();
    const reloaded = await import("./evaluation-preparation-pending");
    expect(reloaded.hasLostEvaluationPreparationOperation()).toBe(true);
    expect(reloaded.beginEvaluationPreparationOperation(() => ({ ...operation, idempotencyKey: crypto.randomUUID() }))).toBeNull();
    expect(hasLostEvaluationPreparationOperation()).toBe(false);
  });
  it("does not send a write when a recovery marker cannot be stored", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage denied"); });
    expect(beginEvaluationPreparationOperation(() => operation)).toBeNull();
    expect(hasPendingOperations()).toBe(false);
  });
});
