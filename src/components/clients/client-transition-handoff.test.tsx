// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ClientLifecycleClient } from "@/lib/clients/types";
import { ClientTransitionComposer } from "./client-transition-composer";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
const controls = vi.hoisted(() => ({ releases: [] as (() => void)[], refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: controls.refresh }) }));
vi.mock("@/lib/navigation/pending-operation-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/navigation/pending-operation-lock")>();
  return { ...actual,
    tryAcquirePendingOperation: () => { const release = actual.tryAcquirePendingOperation(); if (release) controls.releases.push(release); return release; },
    tryAcquireViewTransition: () => { const release = actual.tryAcquireViewTransition(); if (release) controls.releases.push(release); return release; },
  };
});
const id = "c1600000-0000-4000-8000-000000000001";
const client: ClientLifecycleClient = { id, clientCode: "SYN-01", displayName: "合成待收案", status: "active", serviceState: "pending_admission", admittedOn: null, endedOn: null, rowVersion: 1, updatedAt: "2026-09-15T00:00:00Z" };
const other = { ...client, id: "c1600000-0000-4000-8000-000000000002", clientCode: "SYN-02", displayName: "不能誤選的合成個案" };
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => { cleanup(); for (const release of controls.releases.splice(0)) release(); controls.refresh.mockReset(); vi.unstubAllGlobals(); });
function mount(clients = [other, client]) {
  return render(<ClientTransitionComposer clients={clients} canManage hasRecentAal2 demo={false} lockedClientId={id} />);
}
function openForm() {
  fireEvent.click(screen.getByRole("button", { name: "建立個案異動" }));
  fireEvent.change(screen.getByLabelText("生效日期 *"), { target: { value: "2026-09-15" } });
  fireEvent.change(screen.getByLabelText("異動理由 *"), { target: { value: "合成收案確認" } });
  return screen.getByRole("dialog").querySelector("form")!;
}
const rejected = () => Response.json({ requestId: id, status: "error", data: null, errors: [{ code: "CLIENT_VERSION_CONFLICT", message: "請核對最新版本" }] }, { status: 409 });
const receipt = (replayed = false) => Response.json({ requestId: id, status: "ok", errors: [], data: { persisted: true, demo: false, replayed, transition: { id, clientId: id, eventKind: "admit", effectiveOn: "2026-09-15", fromStatus: "active", toStatus: "active", baseRowVersion: 1, resultingRowVersion: 2 } } }, { status: replayed ? 200 : 201 });
describe("exact-client formal admission", () => {
  it("preselects and locks the exact authorized client without any write", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); mount(); openForm();
    expect(screen.getByLabelText("個案 *")).toHaveProperty("value", id);
    expect(screen.getByLabelText("個案 *")).toHaveProperty("disabled", true);
    expect(screen.queryByRole("option", { name: /不能誤選/ })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never falls back to the first client if the requested client is absent", () => {
    mount([other]); expect(screen.getByRole("button", { name: "建立個案異動" })).toHaveProperty("disabled", true);
  });
  it("keeps the same original operation after unknown then a valid conflict", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("合成斷線" )).mockResolvedValueOnce(rejected()).mockResolvedValueOnce(receipt(true));
    vi.stubGlobal("fetch", fetch); const { rerender } = mount(); const form = openForm(); fireEvent.submit(form);
    await screen.findByRole("button", { name: "重試確認原異動" });
    rerender(<ClientTransitionComposer clients={[{ ...client, rowVersion: 5 }]} canManage hasRecentAal2 demo={false} lockedClientId={id} />);
    fireEvent.submit(form); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /重新讀取狀態（清除/ })).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "重試確認原異動" })).toHaveProperty("disabled", false));
    fireEvent.submit(form); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls.map((call) => call[1].body)).toEqual(Array(3).fill(fetch.mock.calls[0][1].body));
    expect(new Set(fetch.mock.calls.map((call) => new Headers(call[1].headers).get("Idempotency-Key"))).size).toBe(1);
    expect(await screen.findByText(/已確認先前相同異動/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("requires manual reload after a first known version conflict and performs no automatic retry", async () => {
    const fetch = vi.fn().mockResolvedValue(rejected()); vi.stubGlobal("fetch", fetch); mount(); const form = openForm(); fireEvent.submit(form);
    expect(await screen.findByRole("button", { name: /重新讀取狀態（清除/ })).toBeTruthy();
    expect(hasPendingOperations()).toBe(false);
    fireEvent.submit(form); expect(fetch).toHaveBeenCalledOnce();
  });
  it("prevents synchronous double submission and closes only after an exact receipt", async () => {
    const fetch = vi.fn().mockResolvedValue(receipt()); vi.stubGlobal("fetch", fetch); mount(); const form = openForm();
    fireEvent.submit(form); fireEvent.submit(form);
    await screen.findByText(/收案已寫入歷程/); expect(fetch).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "建立個案異動" })).toHaveProperty("disabled", true);
    expect(hasPendingOperations()).toBe(false);
  });
  it("does not create or send an operation during a view update", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); mount(); const form = openForm();
    const release = tryAcquireViewTransition(); expect(release).not.toBeNull(); fireEvent.submit(form);
    expect(await screen.findByText(/畫面正在更新或切換分支/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled(); expect(hasPendingOperations()).toBe(false);
  });
  it("holds an unknown operation across unmount instead of silently allowing a branch change", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("合成斷線")); vi.stubGlobal("fetch", fetch);
    const { unmount } = mount(); fireEvent.submit(openForm());
    await screen.findByRole("button", { name: "重試確認原異動" });
    expect(hasPendingOperations()).toBe(true); expect(tryAcquireViewTransition()).toBeNull();
    unmount(); expect(hasPendingOperations()).toBe(true);
  });
  it("does not refresh over another pending writer after success", async () => {
    const fetch = vi.fn().mockResolvedValue(receipt()); vi.stubGlobal("fetch", fetch);
    const releaseOther = tryAcquirePendingOperation(); expect(releaseOther).not.toBeNull();
    mount(); fireEvent.submit(openForm()); await screen.findByText(/另有作業待確認/);
    expect(controls.refresh).not.toHaveBeenCalled(); expect(hasPendingOperations()).toBe(true);
    releaseOther?.(); expect(hasPendingOperations()).toBe(false);
  });
  it("releases a late exact success after unmount without refreshing the next page", async () => {
    let complete!: (value: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    vi.stubGlobal("fetch", fetch); const { unmount } = mount(); fireEvent.submit(openForm());
    expect(hasPendingOperations()).toBe(true); unmount(); complete(receipt());
    await waitFor(() => expect(hasPendingOperations()).toBe(false));
    expect(hasViewTransition()).toBe(false); expect(controls.refresh).not.toHaveBeenCalled();
  });
  it("does not send or retain an operation when local form preparation fails", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); mount(); const form = openForm();
    vi.stubGlobal("FormData", class { constructor() { throw new Error("synthetic preparation failure"); } });
    fireEvent.submit(form); expect(await screen.findByText(/無法建立本次異動，尚未送出/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled(); expect(hasPendingOperations()).toBe(false);
  });
});
