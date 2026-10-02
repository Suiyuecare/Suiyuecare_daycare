// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RuleGovernanceClientError, type RuleGovernanceScope } from "@/lib/questionnaire-assessments/rule-governance-client";
import type { RuleReviewInput } from "@/lib/questionnaire-assessments/rule-review-contract";
import type { RuleRetirementInput } from "@/lib/questionnaire-assessments/rule-retirement-shared";
import { RuleGovernanceAction, type RuleGovernanceActionProps } from "./rule-governance-action";

const mocks = vi.hoisted(() => ({ write: vi.fn(), acquire: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/questionnaire-assessments/rule-governance-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/questionnaire-assessments/rule-governance-client")>(),
  writeRuleGovernance: mocks.write,
}));
vi.mock("@/lib/navigation/pending-operation-lock", () => ({ tryAcquirePendingOperation: mocks.acquire }));
// The shared primitive has its own real-dialog focus, cancel and inert tests.
// This boundary mock exercises the action's explicit dismissal policy.
vi.mock("@/components/ui/governance-dialog", () => ({ GovernanceDialog: ({ open, title, children, busy, onRequestClose }: {
  open: boolean; title: string; children: ReactNode; busy?: boolean; onRequestClose: () => void;
}) => open ? <dialog open aria-labelledby="governance-test-title" onKeyDown={(event) => {
  if (event.key === "Escape" && !busy) onRequestClose();
}}><h2 id="governance-test-title" tabIndex={-1}>{title}</h2><button type="button" disabled={busy} onClick={onRequestClose}>取消</button>{children}</dialog> : null }));

const org = "ab000000-0000-4000-8000-000000000001";
const branch = "ab000000-0000-4000-8000-000000000002";
const user = "ab000000-0000-4000-8000-000000000003";
const request = "ab000000-0000-4000-8000-000000000004";
const event = "ab000000-0000-4000-8000-000000000005";
const other = "ab000000-0000-4000-8000-000000000006";
const activation = "ab000000-0000-4000-8000-000000000007";
const operation = "ab000000-0000-4000-8000-000000000008";
const operation2 = "ab000000-0000-4000-8000-000000000009";
const scope: RuleGovernanceScope = { organizationId: org, branchId: branch, userId: user };
const input: RuleReviewInput = { action: "request", formKey: "bsrs5", catalogHash: "a".repeat(64), requestId: null,
  effectiveFrom: "2026-10-01", effectiveTo: null, reason: null };
const retirementInput: RuleRetirementInput = { action: "approve", formKey: "bsrs5", catalogHash: "a".repeat(64),
  activationId: activation, requestId: request, effectiveThrough: null, reason: null };
const timestamp = "2026-09-26T08:00:00.000001Z";

function receipt(key = operation, replayed = false) {
  return { organizationId: org, branchId: branch, formKey: input.formKey, catalogHash: input.catalogHash,
    operationId: key, actorId: user, committedAt: timestamp, eventId: event, action: "request", replayed,
    request: { requestId: event, formKey: input.formKey, catalogHash: input.catalogHash, effectiveFrom: input.effectiveFrom,
      effectiveTo: null, requestedBy: user, byCurrentUser: true, requestedAt: timestamp,
      status: "pending", decision: null, activation: null } };
}
function retirementReceipt(key = operation) {
  return { organizationId: org, branchId: branch, formKey: "bsrs5", catalogHash: input.catalogHash,
    activationId: activation, operationId: key, actorId: user, committedAt: timestamp, eventId: event,
    action: "approve", replayed: false, request: { requestId: request, activationId: activation, formKey: "bsrs5",
      catalogHash: input.catalogHash, effectiveThrough: "2026-10-01", reason: "合成停用原因", requestedBy: other,
      byCurrentUser: false, requestedAt: "2026-09-26T07:00:00Z", status: "approved",
      decision: { eventId: event, action: "approve", actorId: user, byCurrentUser: true, reason: null, createdAt: timestamp },
      retirement: { retirementId: event, effectiveThrough: "2026-10-01", retiredAt: timestamp } } };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function frameClock() {
  const pending = new Map<number, FrameRequestCallback>(); let sequence = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { pending.set(++sequence, callback); return sequence; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { pending.delete(id); });
  return { flush: () => act(() => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach((callback) => callback(performance.now())); }),
    pendingCount: () => pending.size };
}
function props(overrides: Partial<RuleGovernanceActionProps> = {}): RuleGovernanceActionProps {
  return { scope, kind: "review", input: { ...input }, label: "提出採用", summary: "合成分支 BSRS 候選版，2026-10-01 起生效。",
    enabled: true, onCompleted: vi.fn().mockResolvedValue(undefined), ...overrides };
}
function open() { fireEvent.click(screen.getByRole("button", { name: "提出採用" })); }
function acknowledge() { fireEvent.click(screen.getByRole("checkbox", { name: "我已核對此分支、版本與申請內容" })); }
function submit() { acknowledge(); fireEvent.click(screen.getByRole("button", { name: "確認送出" })); }
async function uncertain() { await waitFor(() => expect(screen.getByRole("button", { name: "以原操作重試" })).toBeTruthy()); }

beforeEach(() => {
  mocks.write.mockReset(); mocks.acquire.mockReset(); mocks.release.mockReset();
  mocks.acquire.mockReturnValue(mocks.release);
  vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(operation).mockReturnValue(operation2);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("rule governance confirmation and recovery", () => {
  it("does not open, acquire or write when disabled and associates the reason", () => {
    render(<RuleGovernanceAction {...props({ enabled: false, disabledReason: "展示環境不可送出。" })} />);
    const button = screen.getByRole("button", { name: "提出採用" }); fireEvent.click(button);
    expect(button.getAttribute("aria-describedby")).toBe(screen.getByText("展示環境不可送出。").id);
    expect(screen.queryByRole("dialog")).toBeNull(); expect(mocks.acquire).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("requires explicit content acknowledgement and allows cancel before any write", () => {
    render(<RuleGovernanceAction {...props()} />); open();
    fireEvent.click(screen.getByRole("button", { name: "確認送出" })); expect(mocks.write).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "確認送出" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "取消" })); expect(screen.queryByRole("dialog")).toBeNull();
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });
  it("a same-scope authorization expiry blocks a new send and resets acknowledgement", async () => {
    mocks.write.mockResolvedValue(receipt()); const configured = props();
    const view = render(<RuleGovernanceAction {...configured} />); open(); acknowledge();
    view.rerender(<RuleGovernanceAction {...configured} enabled={false} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "確認送出" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "確認送出" })); expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.acquire).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("重新確認權限與身分驗證");
    view.rerender(<RuleGovernanceAction {...configured} enabled />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    submit(); await waitFor(() => expect(configured.onCompleted).toHaveBeenCalledOnce());
  });
  it("an authorization change after uncertainty does not discard the exact operation retry", async () => {
    mocks.write.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(receipt()); const configured = props();
    const view = render(<RuleGovernanceAction {...configured} />); open(); submit(); await uncertain();
    view.rerender(<RuleGovernanceAction {...configured} enabled={false} />);
    expect((screen.getByRole("button", { name: "以原操作重試" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "以原操作重試" }));
    await waitFor(() => expect(configured.onCompleted).toHaveBeenCalledOnce());
    expect(mocks.write.mock.calls.map((call) => call[3])).toEqual([operation, operation]);
  });
  it("does not submit invalid input or reflect unsafe content", () => {
    render(<RuleGovernanceAction {...props({ input: { ...input, effectiveFrom: "not-a-date" } })} />); open();
    expect(screen.queryByRole("dialog")).toBeNull(); expect(mocks.write).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("待審內容無效，請重新載入清單後再操作。");
  });
  it("freezes the displayed confirmation and input before the first send", async () => {
    mocks.write.mockResolvedValue(receipt()); const configured = props();
    const view = render(<RuleGovernanceAction {...configured} />); open();
    view.rerender(<RuleGovernanceAction {...configured} input={{ ...input, effectiveFrom: "2026-11-01" }} summary="不能偷換已確認內容" />);
    expect(screen.getByText(configured.summary)).toBeTruthy(); expect(screen.queryByText("不能偷換已確認內容")).toBeNull();
    submit(); await waitFor(() => expect(configured.onCompleted).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith(scope, "review", input, operation);
  });
  it("acquires before creating a UUID and prevents duplicate sending", async () => {
    const pending = deferred<unknown>(); mocks.write.mockReturnValue(pending.promise);
    const configured = props(); render(<RuleGovernanceAction {...configured} />); open(); acknowledge();
    const button = screen.getByRole("button", { name: "確認送出" }); fireEvent.click(button); fireEvent.click(button);
    expect(mocks.write).toHaveBeenCalledTimes(1); expect(mocks.acquire.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(crypto.randomUUID).mock.invocationCallOrder[0]!);
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
    pending.resolve(receipt()); await waitFor(() => expect(configured.onCompleted).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it("does not create a key or send during an existing view transition", () => {
    mocks.acquire.mockReturnValue(null); render(<RuleGovernanceAction {...props()} />); open(); submit();
    expect(crypto.randomUUID).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("畫面正在更新或切換分支，請稍候再操作。");
  });
  it("cleans up a lease if safe UUID creation fails", () => {
    vi.mocked(crypto.randomUUID).mockReset().mockImplementation(() => { throw new Error("secret-UUID-error"); });
    render(<RuleGovernanceAction {...props()} />); open(); submit(); expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.write).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("secret-UUID-error");
  });
  it.each(["auth", "forbidden", "reauth", "conflict", "invalid"] as const)("a first known %s denial permits a fresh acknowledged retry", async (kind) => {
    mocks.write.mockRejectedValueOnce(new RuleGovernanceClientError(kind, "unsafe server secret")).mockResolvedValueOnce(receipt(operation2));
    const configured = props(); render(<RuleGovernanceAction {...configured} />); open(); submit();
    await waitFor(() => expect(mocks.release).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(document.body.textContent).not.toContain("unsafe server secret"); submit();
    await waitFor(() => expect(configured.onCompleted).toHaveBeenCalledTimes(1));
    expect(mocks.write.mock.calls[0]![3]).toBe(operation); expect(mocks.write.mock.calls[1]![3]).toBe(operation2);
    expect(mocks.write.mock.calls[0]![2]).toEqual(mocks.write.mock.calls[1]![2]);
  });
  it.each(["auth", "forbidden", "reauth", "conflict", "invalid"] as const)("a later %s denial after uncertainty retains original frozen key and content", async (kind) => {
    mocks.write.mockRejectedValueOnce(new RuleGovernanceClientError("unconfirmed", "private"))
      .mockRejectedValueOnce(new RuleGovernanceClientError(kind, "private"))
      .mockResolvedValueOnce(receipt(operation, true));
    const configured = props(); const view = render(<RuleGovernanceAction {...configured} />); open(); submit(); await uncertain();
    view.rerender(<RuleGovernanceAction {...configured} input={{ ...input, effectiveFrom: "2026-11-01" }} summary="新的內容不可取代原確認" />);
    fireEvent.click(screen.getByRole("button", { name: "以原操作重試" })); await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));
    await uncertain(); expect(mocks.release).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "以原操作重試" }));
    await waitFor(() => expect(configured.onCompleted).toHaveBeenCalledOnce());
    expect(mocks.write.mock.calls.map((call) => call[3])).toEqual([operation, operation, operation]);
    expect(mocks.write.mock.calls.map((call) => call[2])).toEqual([input, input, input]);
    expect(mocks.acquire).toHaveBeenCalledTimes(1); expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it.each([null, false, { persisted: true }, receipt(operation2), { ...receipt(), branchId: other }])("rejects a false or uncorrelated receipt without claiming success", async (value) => {
    mocks.write.mockResolvedValue(value); const configured = props(); render(<RuleGovernanceAction {...configured} />); open(); submit(); await uncertain();
    expect(configured.onCompleted).not.toHaveBeenCalled(); expect(mocks.release).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("已保存，清單已更新");
  });
  it("uses the retirement receipt contract including null approval fields", async () => {
    mocks.write.mockResolvedValue(retirementReceipt()); const configured = props({ kind: "retirement", input: retirementInput });
    render(<RuleGovernanceAction {...configured} />); open(); submit(); await waitFor(() => expect(configured.onCompleted).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith(scope, "retirement", retirementInput, operation); expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("shows saved-but-stale separately and retries only the authoritative read", async () => {
    mocks.write.mockResolvedValue(receipt()); const onCompleted = vi.fn().mockRejectedValueOnce(new Error("secret read error")).mockResolvedValueOnce(undefined);
    render(<RuleGovernanceAction {...props({ onCompleted })} />); open(); submit();
    await waitFor(() => expect(screen.getByRole("button", { name: "重新載入清單" })).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("已保存，但清單尚未更新"); expect(mocks.release).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "以原操作重試" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新載入清單" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); expect(mocks.write).toHaveBeenCalledOnce();
    expect(onCompleted).toHaveBeenCalledTimes(2); expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("requires an in-modal stop confirmation and a successful read before releasing unknown", async () => {
    mocks.write.mockRejectedValue(new Error("network")); const read = deferred<void>(); const onCompleted = vi.fn().mockReturnValue(read.promise);
    const onLockChange = vi.fn(); render(<RuleGovernanceAction {...props({ onCompleted, onLockChange })} />); open(); submit(); await uncertain();
    fireEvent.click(screen.getByRole("button", { name: "停止重試並回查" }));
    expect(onCompleted).not.toHaveBeenCalled(); expect(mocks.release).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回原操作重試" })); await uncertain();
    fireEvent.click(screen.getByRole("button", { name: "停止重試並回查" }));
    fireEvent.click(screen.getByRole("button", { name: "確認停止重試並回查" })); expect(onCompleted).toHaveBeenCalledOnce();
    expect(mocks.release).not.toHaveBeenCalled(); read.resolve(); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("原操作可能已保存"); expect(onLockChange.mock.calls).toEqual([[true], [false]]);
  });
  it("failed stop-and-read keeps uncertainty, original key and lease", async () => {
    mocks.write.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(receipt());
    const onCompleted = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    render(<RuleGovernanceAction {...props({ onCompleted })} />); open(); submit(); await uncertain();
    fireEvent.click(screen.getByRole("button", { name: "停止重試並回查" })); fireEvent.click(screen.getByRole("button", { name: "確認停止重試並回查" }));
    await uncertain(); expect(mocks.release).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("原操作結果仍未確認");
    fireEvent.click(screen.getByRole("button", { name: "以原操作重試" })); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.write.mock.calls.map((call) => call[3])).toEqual([operation, operation]);
  });
  it("a scope change cannot retry or announce a stale late success", async () => {
    const pending = deferred<unknown>(); mocks.write.mockReturnValue(pending.promise); const configured = props();
    const view = render(<RuleGovernanceAction {...configured} />); open(); submit();
    view.rerender(<RuleGovernanceAction {...configured} scope={{ ...scope, branchId: other }} />); pending.resolve(receipt());
    await waitFor(() => expect(screen.getByText("帳號或分支已變更；請保留本頁，由原帳號與分支回查操作結果。")).toBeTruthy());
    expect(configured.onCompleted).not.toHaveBeenCalled(); expect(mocks.release).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("已保存，清單已更新");
    const unload = new Event("beforeunload", { cancelable: true }); fireEvent(window, unload);
    expect(unload.defaultPrevented).toBe(true);
  });
  it("unmounting does not discard an unknown operation or call a stale completion", async () => {
    const pending = deferred<unknown>(); mocks.write.mockReturnValue(pending.promise); const configured = props();
    const view = render(<RuleGovernanceAction {...configured} />); open(); submit(); view.unmount(); pending.reject(new Error("network"));
    await Promise.resolve(); await Promise.resolve(); expect(mocks.release).not.toHaveBeenCalled(); expect(configured.onCompleted).not.toHaveBeenCalled();
  });
  it("a successful authoritative read can remove the action and clear both same-scope locks", async () => {
    mocks.write.mockResolvedValue(receipt()); const onLockChange = vi.fn();
    const onCompleted = vi.fn(async () => { view.unmount(); });
    const view = render(<RuleGovernanceAction {...props({ onCompleted, onLockChange })} />);
    open(); submit(); await waitFor(() => expect(mocks.release).toHaveBeenCalledOnce());
    expect(onLockChange.mock.calls).toEqual([[true], [false]]); expect(screen.queryByRole("status")).toBeNull();
  });
  it("unmounting during a failed authoritative read retains the same-scope operation lease", async () => {
    mocks.write.mockResolvedValue(receipt()); const onLockChange = vi.fn(); const pending = deferred<void>();
    const onCompleted = vi.fn(() => pending.promise);
    const view = render(<RuleGovernanceAction {...props({ onCompleted, onLockChange })} />); open(); submit();
    await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce()); view.unmount(); pending.reject(new Error("offline"));
    await Promise.resolve(); await Promise.resolve(); expect(mocks.release).not.toHaveBeenCalled();
    expect(onLockChange.mock.calls).toEqual([[true]]);
  });
  it("does not persist raw content or keys, navigate, or invoke native confirmation", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem"); const history = vi.spyOn(window.history, "pushState"); const confirm = vi.spyOn(window, "confirm");
    mocks.write.mockResolvedValue(receipt()); render(<RuleGovernanceAction {...props()} />); open(); submit();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); expect(local).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  });
  it("guards hard unload only after sending and cleans up after a confirmed read", async () => {
    mocks.write.mockRejectedValue(new Error("offline")); render(<RuleGovernanceAction {...props()} />); open();
    const before = new Event("beforeunload", { cancelable: true }); fireEvent(window, before); expect(before.defaultPrevented).toBe(false);
    submit(); await uncertain(); const pending = new Event("beforeunload", { cancelable: true }); fireEvent(window, pending);
    expect(pending.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "停止重試並回查" })); fireEvent.click(screen.getByRole("button", { name: "確認停止重試並回查" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const after = new Event("beforeunload", { cancelable: true }); fireEvent(window, after); expect(after.defaultPrevented).toBe(false);
  });
  it("saved-but-stale continues to guard hard unload without retrying writes", async () => {
    mocks.write.mockResolvedValue(receipt()); render(<RuleGovernanceAction {...props({ onCompleted: vi.fn().mockRejectedValue(new Error("offline")) })} />);
    open(); submit(); await waitFor(() => expect(screen.getByRole("button", { name: "重新載入清單" })).toBeTruthy());
    const event = new Event("beforeunload", { cancelable: true }); fireEvent(window, event); expect(event.defaultPrevented).toBe(true);
    expect(mocks.write).toHaveBeenCalledOnce();
  });
  it("cancels a cancellable native traversal without rewriting history", async () => {
    const navigation = Object.assign(new EventTarget(), { currentEntry: { index: 4, key: "original-entry" } }); vi.stubGlobal("navigation", navigation);
    const push = vi.spyOn(window.history, "pushState"); const replace = vi.spyOn(window.history, "replaceState"); const go = vi.spyOn(window.history, "go");
    mocks.write.mockRejectedValue(new Error("offline")); render(<RuleGovernanceAction {...props()} />); open(); submit(); await uncertain();
    const event = Object.assign(new Event("navigate", { cancelable: true }), { navigationType: "traverse", destination: { key: "previous-entry" } });
    act(() => { navigation.dispatchEvent(event); }); expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText(/仍有未確認或尚未完成回查的操作/)).toBeTruthy(); expect(go).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  });
  it("returns BODY focus to the existing dialog title after cancelling a native traversal", async () => {
    const frames = frameClock(); const navigation = Object.assign(new EventTarget(), { currentEntry: { index: 4, key: "original-entry" } }); vi.stubGlobal("navigation", navigation);
    mocks.write.mockRejectedValue(new Error("offline")); render(<RuleGovernanceAction {...props()} />); open(); submit(); await uncertain();
    expect(document.activeElement).toBe(document.body);
    const event = Object.assign(new Event("navigate", { cancelable: true }), { navigationType: "traverse", destination: { key: "previous-entry" } });
    act(() => { navigation.dispatchEvent(event); }); frames.flush();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "提出採用" }));
    expect(mocks.release).not.toHaveBeenCalled(); expect(mocks.write).toHaveBeenCalledOnce();
  });
  it("restores focus only after native index recovery reaches the original entry", async () => {
    const frames = frameClock(); const navigation = Object.assign(new EventTarget(), { currentEntry: { index: 4, key: "original-entry" } }); vi.stubGlobal("navigation", navigation);
    vi.spyOn(window.history, "go").mockImplementation(() => {}); mocks.write.mockRejectedValue(new Error("offline"));
    render(<RuleGovernanceAction {...props()} />); open(); submit(); await uncertain();
    navigation.currentEntry = { index: 3, key: "previous-entry" }; fireEvent(window, new PopStateEvent("popstate")); frames.flush();
    expect(document.activeElement).toBe(document.body);
    navigation.currentEntry = { index: 4, key: "original-entry" }; fireEvent(window, new PopStateEvent("popstate")); frames.flush();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "提出採用" }));
  });
  it("does not steal usable focus inside the same modal during navigation recovery", async () => {
    const frames = frameClock(); const navigation = Object.assign(new EventTarget(), { currentEntry: { index: 4, key: "original-entry" } }); vi.stubGlobal("navigation", navigation);
    mocks.write.mockRejectedValue(new Error("offline")); render(<RuleGovernanceAction {...props()} />); open(); submit(); await uncertain();
    const retry = screen.getByRole("button", { name: "以原操作重試" }); retry.focus();
    const event = Object.assign(new Event("navigate", { cancelable: true }), { navigationType: "traverse", destination: { key: "previous-entry" } });
    act(() => { navigation.dispatchEvent(event); }); frames.flush(); expect(document.activeElement).toBe(retry);
  });
  it.each(["scope", "unmount"] as const)("a scheduled focus restoration is stale-safe after %s changes", async (change) => {
    const frames = frameClock(); const navigation = Object.assign(new EventTarget(), { currentEntry: { index: 4, key: "original-entry" } }); vi.stubGlobal("navigation", navigation);
    mocks.write.mockRejectedValue(new Error("offline")); const configured = props(); const view = render(<RuleGovernanceAction {...configured} />); open(); submit(); await uncertain();
    const event = Object.assign(new Event("navigate", { cancelable: true }), { navigationType: "traverse", destination: { key: "previous-entry" } });
    act(() => { navigation.dispatchEvent(event); }); expect(frames.pendingCount()).toBe(1);
    if (change === "scope") view.rerender(<RuleGovernanceAction {...configured} scope={{ ...scope, branchId: other }} />);
    else { view.unmount(); expect(frames.pendingCount()).toBe(0); }
    frames.flush(); expect(document.activeElement).toBe(document.body); expect(mocks.release).not.toHaveBeenCalled();
  });
  it.each([{ index: 1, delta: 3 }, { index: 7, delta: -3 }])("restores a non-cancellable traversal at native index $index without loops or new history", async ({ index, delta }) => {
    const navigation = Object.assign(new EventTarget(), { currentEntry: { index: 4, key: "original-entry" } }); vi.stubGlobal("navigation", navigation);
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {}); const push = vi.spyOn(window.history, "pushState"); const replace = vi.spyOn(window.history, "replaceState");
    const nextRouter = vi.fn(); window.addEventListener("popstate", nextRouter);
    try {
      mocks.write.mockRejectedValue(new Error("offline")); render(<RuleGovernanceAction {...props()} />); open(); submit(); await uncertain();
      navigation.currentEntry = { index, key: "destination-entry" };
      fireEvent(window, new PopStateEvent("popstate", { state: { __NA: true } }));
      expect(go).toHaveBeenCalledExactlyOnceWith(delta); expect(nextRouter).not.toHaveBeenCalled();
      fireEvent(window, new PopStateEvent("popstate", { state: { __NA: true } })); expect(go).toHaveBeenCalledOnce();
      const restoring = Object.assign(new Event("navigate", { cancelable: true }), { navigationType: "traverse", destination: { key: "original-entry" } });
      act(() => { navigation.dispatchEvent(restoring); }); expect(restoring.defaultPrevented).toBe(false);
      navigation.currentEntry = { index: 4, key: "original-entry" }; fireEvent(window, new PopStateEvent("popstate", { state: { __NA: true } }));
      expect(go).toHaveBeenCalledOnce(); expect(nextRouter).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(mocks.write).toHaveBeenCalledOnce(); expect(mocks.release).not.toHaveBeenCalled();
    } finally { window.removeEventListener("popstate", nextRouter); }
  });
  it("without native indices warns honestly rather than guessing direction or destroying the stack", async () => {
    const go = vi.spyOn(window.history, "go"); const push = vi.spyOn(window.history, "pushState"); const replace = vi.spyOn(window.history, "replaceState");
    mocks.write.mockRejectedValue(new Error("offline")); render(<RuleGovernanceAction {...props()} />); open(); submit(); await uncertain();
    expect(screen.getByText(/此瀏覽器無法完整保護返回／前進歷程/)).toBeTruthy();
    fireEvent(window, new PopStateEvent("popstate", { state: { __NA: true } }));
    expect(go).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(mocks.release).not.toHaveBeenCalled();
  });
  it("an inactive native entry index cannot be guessed or used as a traversal delta", async () => {
    const navigation = Object.assign(new EventTarget(), { currentEntry: { index: -1, key: "inactive-entry" } }); vi.stubGlobal("navigation", navigation);
    const go = vi.spyOn(window.history, "go"); mocks.write.mockRejectedValue(new Error("offline"));
    render(<RuleGovernanceAction {...props()} />); open(); submit(); await uncertain();
    fireEvent(window, new PopStateEvent("popstate", { state: { __NA: true } })); expect(go).not.toHaveBeenCalled();
    expect(screen.getByText(/此瀏覽器無法完整保護返回／前進歷程/)).toBeTruthy();
  });
  it("StrictMode cleanup removes navigation handlers but does not release an unknown lease", async () => {
    const navigation = Object.assign(new EventTarget(), { currentEntry: { index: 4, key: "original-entry" } }); vi.stubGlobal("navigation", navigation);
    const add = vi.spyOn(navigation, "addEventListener"); const remove = vi.spyOn(navigation, "removeEventListener");
    mocks.write.mockRejectedValue(new Error("offline")); const view = render(<StrictMode><RuleGovernanceAction {...props()} /></StrictMode>);
    open(); submit(); await uncertain(); view.unmount(); expect(mocks.release).not.toHaveBeenCalled();
    expect(add.mock.calls.filter(([name]) => name === "navigate")).toHaveLength(1);
    expect(remove.mock.calls.filter(([name]) => name === "navigate")).toHaveLength(1);
    const event = new Event("beforeunload", { cancelable: true }); fireEvent(window, event); expect(event.defaultPrevented).toBe(false);
  });
});
