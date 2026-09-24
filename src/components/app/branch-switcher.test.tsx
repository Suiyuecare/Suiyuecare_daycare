// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";

import { BranchSwitcher } from "./branch-switcher";
const navigation = vi.hoisted(() => ({ reload: vi.fn() }));
vi.mock("./branch-navigation", () => ({ reloadCurrentStaffRoute: navigation.reload }));
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const releases: (() => void)[] = [];
function remember(release: (() => void) | null) { if (release) releases.push(release); return release; }

beforeEach(() => {
  navigation.reload.mockReset();
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); }) });
});

afterEach(() => {
  cleanup();
  for (const release of releases.splice(0)) release();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

describe("BranchSwitcher request boundaries", () => {
  const branchA = "22000000-0000-4000-8000-000000000001";
  const branchB = "22000000-0000-4000-8000-000000000002";
  const requestId = "22000000-0000-4000-8000-000000000003";

  it("keeps the synthetic preview branch fixed without requesting the blocked API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="合成分支" organizationName="合成機構" readOnly />);
    const trigger = screen.getByRole("button", { name: /目前分支/u });
    expect(trigger).toHaveProperty("disabled", true);
    fireEvent.click(trigger);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("固定合成分支 · 不切換真實機構")).toBeDefined();
  });

  it("leaves the trigger usable after a failed branch-list request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);

    const trigger = screen.getByRole("button", { name: /目前分支/u });
    fireEvent.click(trigger);
    expect((await screen.findByRole("alert")).textContent).toContain("無法讀取分支");
    expect(trigger).toHaveProperty("disabled", false);
  });

  it("reports an unknown switch outcome and keeps the old label on timeout", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        requestId, status: "ok", errors: [],
        data: {
          branches: [{ id: branchA, name: "甲分支" }, { id: branchB, name: "乙分支" }],
          currentBranchId: branchA,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockRejectedValueOnce(new ClientFetchTimeoutError(20_000));
    vi.stubGlobal("fetch", fetchMock);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);

    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("結果未知"));
    const trigger = screen.getByRole("button", { name: /目前分支/u });
    expect(trigger.textContent).toContain("甲分支");
    expect(trigger).toHaveProperty("disabled", true);
    expect(screen.getByRole("dialog")).toHaveProperty("open", true);
    fireEvent.click(screen.getByRole("button", { name: "安全重新載入系統" }));
    expect(navigation.reload).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not change the visible branch for an uncorrelated success receipt", async () => {
    const list = {
      requestId, status: "ok", errors: [],
      data: {
        branches: [{ id: branchA, name: "甲分支" }, { id: branchB, name: "乙分支" }],
        currentBranchId: branchA,
      },
    };
    const forgedSwitch = {
      requestId, status: "ok", errors: [],
      data: { branch: { id: branchB, name: "遭竄改的名稱" }, demo: false },
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(list), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(forgedSwitch), { status: 200 })));
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);

    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /目前分支/u }).textContent).toContain("甲分支");
    expect(screen.getByRole("dialog")).toHaveProperty("open", true);
    expect(navigation.reload).not.toHaveBeenCalled();
  });
  function branchList() { return Response.json({ requestId, status: "ok", errors: [], data: { branches: [{ id: branchA, name: "甲分支" }, { id: branchB, name: "乙分支" }], currentBranchId: branchA } }); }
  it("allows cancelling before any switch request or modal lock", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    const fetch = vi.fn().mockResolvedValueOnce(branchList()); vi.stubGlobal("fetch", fetch);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    expect(fetch).toHaveBeenCalledTimes(1); expect(screen.queryByRole("dialog")).toBeNull();
    expect(navigation.reload).not.toHaveBeenCalled();
  });
  it("locks before POST and keeps the modal until a full navigation replaces client state", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(branchList()).mockImplementationOnce(async () => {
      expect(document.querySelector("dialog")).toHaveProperty("open", true);
      return Response.json({ requestId, status: "ok", errors: [], data: { branch: { id: branchB, name: "乙分支" }, demo: false } });
    }); vi.stubGlobal("fetch", fetch);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    await waitFor(() => expect(navigation.reload).toHaveBeenCalledOnce());
    expect(screen.getByRole("dialog")).toHaveProperty("open", true);
    expect(screen.getByRole("button", { name: /目前分支/u })).toHaveProperty("disabled", true);
    const cancel = new Event("cancel", { bubbles: true, cancelable: true });
    fireEvent(screen.getByRole("dialog"), cancel); expect(cancel.defaultPrevented).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps a rejected switch locked and reloads safely instead of resending POST", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(branchList()).mockResolvedValueOnce(Response.json({ status: "error" }, { status: 403 })); vi.stubGlobal("fetch", fetch);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    expect((await screen.findByRole("alert")).textContent).toContain("舊頁面已鎖定");
    expect(screen.getByRole("dialog")).toHaveProperty("open", true);
    fireEvent.click(screen.getByRole("button", { name: "安全重新載入系統" }));
    expect(navigation.reload).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not send a switch if native background locking is unavailable", async () => {
    vi.mocked(HTMLDialogElement.prototype.showModal).mockImplementation(() => { throw new Error("unsupported"); });
    const fetch = vi.fn().mockResolvedValueOnce(branchList()); vi.stubGlobal("fetch", fetch);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    expect((await screen.findByRole("alert")).textContent).toContain("尚未送出切換");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(remember(tryAcquirePendingOperation())).not.toBeNull();
  });
  it("blocks opening and cookie-changing POST during an unresolved write", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    const trigger = screen.getByRole("button", { name: /目前分支/ });
    act(() => { remember(tryAcquirePendingOperation()); fireEvent.click(trigger); });
    expect(trigger).toHaveProperty("disabled", true);
    expect(screen.getByRole("status").textContent).toContain("暫停切換分支");
    expect(fetch).not.toHaveBeenCalled(); expect(navigation.reload).not.toHaveBeenCalled();
  });
  it("rechecks pending writes when an already-started branch list finishes", async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; })); vi.stubGlobal("fetch", fetch);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/ }));
    act(() => { remember(tryAcquirePendingOperation()); });
    await act(async () => finish(branchList()));
    expect(screen.queryByRole("button", { name: "乙分支" })).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("rechecks after confirmation and never changes the cookie if a write acquired first", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(branchList()); vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("confirm", vi.fn(() => { remember(tryAcquirePendingOperation()); return true; }));
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/ }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(navigation.reload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("儲存結果尚待確認");
  });
  it("blocks a new write until uncertain scope change is replaced by a full view", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(branchList()).mockImplementationOnce(async () => {
      expect(tryAcquirePendingOperation()).toBeNull();
      return Response.json({ status: "error" }, { status: 403 });
    }); vi.stubGlobal("fetch", fetch);
    const { unmount } = render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/ }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    await screen.findByRole("alert");
    expect(tryAcquirePendingOperation()).toBeNull();
    expect(tryAcquireViewTransition()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "安全重新載入系統" }));
    expect(tryAcquirePendingOperation()).toBeNull();
    unmount();
    expect(remember(tryAcquirePendingOperation())).not.toBeNull();
  });
});
