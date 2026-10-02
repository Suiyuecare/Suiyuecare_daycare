// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { registerUnsavedChangesOwner } from "@/lib/navigation/unsaved-changes";

import { BranchSwitcher } from "./branch-switcher";
const navigation = vi.hoisted(() => ({ reload: vi.fn() }));
vi.mock("./branch-navigation", () => ({ reloadCurrentStaffRoute: navigation.reload }));
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const releases: (() => void)[] = [];
function remember(release: (() => void) | null) { if (release) releases.push(release); return release; }

beforeEach(() => {
  navigation.reload.mockReset();
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); }) });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); }) });
});

afterEach(() => {
  cleanup();
  for (const release of releases.splice(0)) release();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
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

  it("uses unique dialog labels when desktop and mobile branch pickers are both rendered", () => {
    const branchProps = { currentBranchId: branchA, currentBranchName: "合成分支", organizationName: "合成機構", readOnly: true, compact: true };
    const { container } = render(<><BranchSwitcher {...branchProps} /><BranchSwitcher {...branchProps} /></>);
    const dialogs = Array.from(container.querySelectorAll("dialog[aria-describedby]"));
    const labels = dialogs.flatMap((dialog) => [dialog.getAttribute("aria-labelledby"), dialog.getAttribute("aria-describedby")]);
    expect(labels).toHaveLength(4);
    expect(new Set(labels).size).toBe(4);
    for (const dialog of dialogs) {
      expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)).not.toBeNull();
      expect(document.getElementById(dialog.getAttribute("aria-describedby")!)).not.toBeNull();
    }
  });

  it("shows the full organization name and keeps the current branch distinct", () => {
    const legalName = "樂齡歲悅股份有限公司附設臺北市私立歲悅萬華社區長照機構";
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="歲悅萬華" organizationName={legalName} compact readOnly />);
    const trigger = screen.getByRole("button", { name: `${legalName}，目前分支：歲悅萬華` });
    expect(trigger.textContent).toContain(legalName);
    expect(trigger.textContent).toContain("目前分支：歲悅萬華");
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
    fireEvent.click(await screen.findByRole("button", { name: "切換分支" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "切換分支" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /目前分支/u }).textContent).toContain("甲分支");
    expect(screen.getByRole("dialog")).toHaveProperty("open", true);
    expect(navigation.reload).not.toHaveBeenCalled();
  });
  function branchList() { return Response.json({ requestId, status: "ok", errors: [], data: { branches: [{ id: branchA, name: "甲分支" }, { id: branchB, name: "乙分支" }], currentBranchId: branchA } }); }
  it("uses an app-owned cancelable confirmation, without browser confirm or a switch POST", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(branchList()); vi.stubGlobal("fetch", fetch);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    const confirmation = screen.getByRole("dialog", { name: "確認切換分支" });
    expect(confirmation.textContent).toContain("將切換至「乙分支」");
    expect(window.confirm).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
    const cancel = new Event("cancel", { bubbles: true, cancelable: true });
    fireEvent(confirmation, cancel);
    expect(cancel.defaultPrevented).toBe(true); expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetch).toHaveBeenCalledOnce(); expect(navigation.reload).not.toHaveBeenCalled();
  });
  it("waits for the dirty editor before showing branch confirmation or changing cookies", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(branchList()); vi.stubGlobal("fetch", fetch);
    let dirty = true; let proceed: (() => void) | null = null;
    releases.push(registerUnsavedChangesOwner({ isDirty: () => dirty, requestDiscard: (action) => { proceed = action; }, onInvalidate: () => {} }));
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    expect(proceed).not.toBeNull(); expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    act(() => { dirty = false; proceed!(); });
    expect(screen.getByRole("dialog", { name: "確認切換分支" })).toHaveProperty("open", true);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not confirm a branch using IME Enter", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(branchList()); vi.stubGlobal("fetch", fetch);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    const key = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", isComposing: true });
    fireEvent(screen.getByRole("button", { name: "切換分支" }), key);
    expect(key.defaultPrevented).toBe(true); expect(fetch).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "確認切換分支" })).toHaveProperty("open", true);
  });
  it("rechecks a newly dirty owner at the last cookie-changing boundary", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(branchList()).mockRejectedValueOnce(new Error("unknown"));
    vi.stubGlobal("fetch", fetch);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    let dirty = true; let proceed: (() => void) | null = null;
    releases.push(registerUnsavedChangesOwner({ isDirty: () => dirty, requestDiscard: (action) => { proceed = action; }, onInvalidate: () => {} }));
    fireEvent.click(screen.getByRole("button", { name: "切換分支" }));
    expect(proceed).not.toBeNull(); expect(fetch).toHaveBeenCalledOnce();
    expect(navigation.reload).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { dirty = false; proceed!(); });
    await screen.findByRole("alert"); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not restore an obsolete branch list after its actor-scoped picker unmounts", async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/u })); unmount();
    await act(async () => finish(branchList()));
    expect(screen.queryByRole("button", { name: "乙分支" })).toBeNull(); expect(navigation.reload).not.toHaveBeenCalled();
  });
  it("does not navigate after an obsolete cookie-changing request returns", async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(branchList()).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    fireEvent.click(screen.getByRole("button", { name: "切換分支" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); unmount();
    await act(async () => finish(Response.json({ requestId, status: "ok", errors: [], data: { branch: { id: branchB, name: "乙分支" }, demo: false } })));
    expect(navigation.reload).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("allows cancelling before any switch request or modal lock", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(branchList()); vi.stubGlobal("fetch", fetch);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    expect(screen.getByRole("dialog", { name: "確認切換分支" })).toHaveProperty("open", true);
    expect(screen.getByRole("button", { name: "取消" })).toBe(document.activeElement);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(fetch).toHaveBeenCalledTimes(1); expect(screen.queryByRole("dialog")).toBeNull();
    expect(navigation.reload).not.toHaveBeenCalled();
  });
  it("locks before POST and keeps the modal until a full navigation replaces client state", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(branchList()).mockImplementationOnce(async () => {
      expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
      expect(screen.getByRole("dialog", { name: "正在安全切換分支" })).toHaveProperty("open", true);
      return Response.json({ requestId, status: "ok", errors: [], data: { branch: { id: branchB, name: "乙分支" }, demo: false } });
    }); vi.stubGlobal("fetch", fetch);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    fireEvent.click(await screen.findByRole("button", { name: "切換分支" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "切換分支" }));
    expect((await screen.findByRole("alert")).textContent).toContain("舊頁面已鎖定");
    expect(screen.getByRole("dialog")).toHaveProperty("open", true);
    fireEvent.click(screen.getByRole("button", { name: "安全重新載入系統" }));
    expect(navigation.reload).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not send a switch if native background locking is unavailable", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(branchList()); vi.stubGlobal("fetch", fetch);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    vi.mocked(HTMLDialogElement.prototype.showModal).mockImplementation(() => { throw new Error("unsupported"); });
    fireEvent.click(await screen.findByRole("button", { name: "切換分支" }));
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
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);
    fireEvent.click(screen.getByRole("button", { name: /目前分支/ }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    act(() => { remember(tryAcquirePendingOperation()); });
    fireEvent.click(screen.getByRole("button", { name: "切換分支" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "切換分支" }));
    await screen.findByRole("alert");
    expect(tryAcquirePendingOperation()).toBeNull();
    expect(tryAcquireViewTransition()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "安全重新載入系統" }));
    expect(tryAcquirePendingOperation()).toBeNull();
    unmount();
    expect(remember(tryAcquirePendingOperation())).not.toBeNull();
  });
});
