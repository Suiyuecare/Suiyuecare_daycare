// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TenantContext } from "@/lib/domain/types";
import { getNavigationGroups } from "@/lib/catalog";
import { tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { useScopeChangeDraftRegistration } from "@/lib/navigation/scope-change-pending";
const mocks = vi.hoisted(() => ({ pathname: "/app/staff/workspace/dashboard", clear: vi.fn(), inspect: vi.fn(), checkedClear: vi.fn(), fetch: vi.fn(), signOut: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => { const router = { replace: mocks.replace, refresh: mocks.refresh }; return { usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(), useRouter: () => router }; });
vi.mock("@/lib/offline/draft-store", () => ({ clearOfflineDrafts: mocks.clear, inspectOfflineDraftsForLogout: mocks.inspect, clearOfflineDraftsIfUnchanged: mocks.checkedClear }));
vi.mock("@/lib/api/client-fetch", () => ({ fetchWithTimeout: mocks.fetch }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabaseClient: () => ({ auth: { signOut: mocks.signOut } }) }));
vi.mock("./branch-switcher", () => ({ BranchSwitcher: () => <span>合成分支選單</span> }));
import { AppShell } from "./app-shell";
import { useCoreDraftGuard } from "@/components/core-care/client-continuation";
const actor: TenantContext = { organizationId: "synthetic", branchId: "synthetic", userId: "synthetic", organizationName: "synthetic", branchName: "synthetic", displayName: "合成員工姓名", roles: ["care_worker"], scopes: [], assuranceLevel: "aal2", recentAal2At: null, demo: false };
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
beforeEach(() => {
  mocks.pathname = "/app/staff/workspace/dashboard";
  vi.clearAllMocks(); mocks.clear.mockResolvedValue(undefined); mocks.inspect.mockResolvedValue({ generation: "g1", revision: "r1", count: 0 });
  mocks.checkedClear.mockResolvedValue("cleared"); mocks.signOut.mockResolvedValue({ error: null });
  mocks.fetch.mockImplementation(async () => Response.json({ status: "ok", data: { cleared: true } }));
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("staff shell logout privacy", () => {
  it("returns to the fixed company portal without forwarding identity or request context", () => {
    render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    const links = screen.getAllByRole("link", { name: "回模組頁" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "https://login.suiyuecare.com/portal/");
      expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
      expect(link).toHaveAttribute("rel", "noreferrer");
      expect(link).not.toHaveAttribute("target");
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("keeps the module return visible but non-navigable during uncertain writes, including a same-tick click", () => {
    let prevented = false;
    function ScopeDraft() {
      const update = useScopeChangeDraftRegistration();
      return <><button onClick={() => {
        update({ dirty: false, busy: false, unknown: true });
        const portal = document.querySelector<HTMLAnchorElement>("a.sidebar__module-return")!;
        prevented = !portal.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      }}>結果未知並點回模組頁</button>
        <button onClick={() => update({ dirty: false, busy: false, unknown: false })}>核對完成</button></>;
    }
    render(<AppShell context={actor} navigation={[]}><ScopeDraft /></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "結果未知並點回模組頁" }));
    expect(prevented).toBe(true);
    expect(screen.queryByRole("link", { name: "回模組頁" })).not.toBeInTheDocument();
    expect(screen.getAllByText("回模組頁")).toHaveLength(2);
    expect(within(screen.getByRole("main")).getByText(/暫時不能切換分支、重新整理或登出/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "核對完成" }));
    expect(screen.getAllByRole("link", { name: "回模組頁" })).toHaveLength(2);
  });
  it("lets the existing draft guard block a portal departure", () => {
    function DirtyDraft() { const guard = useCoreDraftGuard(); return <button onClick={guard.changed}>合成未儲存草稿</button>; }
    const nativeConfirm = vi.spyOn(window, "confirm");
    render(<AppShell context={actor} navigation={[]}><DirtyDraft /></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "合成未儲存草稿" }));
    const departure = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(screen.getAllByRole("link", { name: "回模組頁" })[0], departure);
    expect(departure.defaultPrevented).toBe(true);
    const dialog = screen.getByRole("alertdialog", { name: "放棄未儲存的內容並離開？" });
    expect(dialog).toHaveAttribute("open");
    fireEvent.click(within(dialog).getByRole("button", { name: "繼續填寫" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("asks once before a user-initiated logout and leaves the draft intact on cancel", async () => {
    function DirtyDraft() { const guard = useCoreDraftGuard(); return <button onClick={guard.changed}>合成未儲存草稿</button>; }
    const nativeConfirm = vi.spyOn(window, "confirm");
    render(<AppShell context={actor} navigation={[]}><DirtyDraft /></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "合成未儲存草稿" }));
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("open");
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "繼續填寫" }));
    expect(screen.getByRole("button", { name: "合成未儲存草稿" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    fireEvent.click(within(dialog).getByRole("button", { name: "放棄輸入並離開" }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
  it("explains why logout is disabled during a write and keeps an unknown result held", () => {
    function WriteDraft() {
      const guard = useCoreDraftGuard();
      return <><button onClick={guard.begin}>開始寫入</button>
        <button onClick={() => { guard.hold(); guard.finish(); }}>結果未知</button>
        <button onClick={guard.saved}>已核對結果</button></>;
    }
    render(<AppShell context={actor} navigation={[]}><WriteDraft /></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "開始寫入" }));
    expect(screen.getAllByRole("button", { name: "登出" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByText("資料儲存中，請稍候再登出。")).toBeInTheDocument();
    expect(screen.queryByText(/暫時不能離開或登出/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "結果未知" }));
    expect(screen.getByText(/暫時不能離開或登出/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "登出" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "已核對結果" }));
    expect(screen.getAllByRole("button", { name: "登出" }).every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("disables manual refresh while a core draft is dirty", () => {
    function DirtyDraft() { const guard = useCoreDraftGuard(); return <><button onClick={guard.changed}>編輯草稿</button><button onClick={guard.saved}>確認儲存</button></>; }
    render(<AppShell context={actor} navigation={[]}><DirtyDraft /></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "編輯草稿" }));
    expect(screen.getByRole("button", { name: "重新整理" })).toBeDisabled();
    expect(screen.getByText(/才能重新整理或切換分支/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新整理" }));
    expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "確認儲存" }));
    expect(screen.getByRole("button", { name: "重新整理" })).toBeEnabled();
  });
  it("keeps active logout disabled while an unresolved operation lease survives its composer", () => {
    render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    let release: (() => void) | null = null;
    try {
      act(() => { release = tryAcquirePendingOperation(); });
      expect(release).not.toBeNull();
      expect(screen.getAllByRole("button", { name: "登出" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
      expect(screen.getByText(/不能登出並清除裝置草稿/)).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
      expect(mocks.clear).not.toHaveBeenCalled();
      expect(mocks.signOut).not.toHaveBeenCalled();
    } finally { act(() => { release?.(); }); }
  });
  it("rechecks an operation lease acquired while draft-leave consent is open", () => {
    function DirtyDraft() { const guard = useCoreDraftGuard(); return <button onClick={guard.changed}>編輯草稿</button>; }
    render(<AppShell context={actor} navigation={[]}><DirtyDraft /></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "編輯草稿" }));
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    const dialog = screen.getByRole("alertdialog");
    let release: (() => void) | null = null;
    try {
      act(() => { release = tryAcquirePendingOperation(); });
      expect(release).not.toBeNull();
      fireEvent.click(within(dialog).getByRole("button", { name: "放棄輸入並離開" }));
      expect(mocks.clear).not.toHaveBeenCalled();
      expect(mocks.signOut).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "編輯草稿" })).toBeInTheDocument();
    } finally { act(() => { release?.(); }); }
  });
  it("disables active logout during a view transition", () => {
    render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    let release: (() => void) | null = null;
    try {
      act(() => { release = tryAcquireViewTransition(); });
      expect(release).not.toBeNull();
      expect(screen.getAllByRole("button", { name: "登出" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
      expect(screen.getByText(/系統正在更新或切換分支/)).toBeInTheDocument();
      expect(mocks.signOut).not.toHaveBeenCalled();
    } finally { act(() => { release?.(); }); }
  });
  it("marks only intake current in the sidebar, not a fallback care page", () => {
    mocks.pathname = "/app/client-intake";
    const { container } = render(<AppShell context={{ ...actor, roles: ["branch_supervisor"], demo: true }} navigation={getNavigationGroups("staff")}><p>合成收案頁</p></AppShell>);
    const current = container.querySelectorAll('.sidebar__nav [aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/app/client-intake");
  });
  it("keeps the Finance-style header identity and refresh action separate from logout", async () => {
    render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);

    expect(screen.getByRole("status")).toHaveTextContent("合成員工姓名・照顧服務員・正式系統");
    expect(screen.getByLabelText(/台北時間/u)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "系統功能" })).toHaveTextContent("登出");
    fireEvent.click(screen.getByRole("button", { name: "重新整理" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("immediately removes the whole sensitive shell and still signs out after cache failure", async () => {
    mocks.checkedClear.mockRejectedValue(new Error("blocked"));
    render(<AppShell context={actor} navigation={[]}><p>合成個案健康內容</p></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    await waitFor(() => expect(screen.queryByText("合成個案健康內容")).not.toBeInTheDocument());
    expect(screen.queryByText("合成員工姓名")).not.toBeInTheDocument();
    expect(await screen.findByText(/裝置資料尚未確認清除/)).toBeVisible();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" }); expect(mocks.fetch).toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "檢查清理狀態並重試登出" })).toBeEnabled();
  });
  it("redirects only once all three cleanup confirmations succeed", async () => {
    const clearEphemeral = vi.fn();
    document.addEventListener("daycare:session-ending", clearEphemeral, { once: true });
    render(<AppShell context={actor} navigation={[]}><p>合成個案</p></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    await waitFor(() => expect(clearEphemeral).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("keeps the synthetic return action free of storage or authentication operations", () => {
    vi.stubEnv("NEXT_PUBLIC_SYNTHETIC_PREVIEW", "true");
    render(<AppShell context={{ ...actor, demo: true }} navigation={[]}><p>合成展示</p></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "返回試用入口" }));
    expect(mocks.replace).toHaveBeenCalledWith("/login"); expect(mocks.clear).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("offers retry without restoring data when sign-out itself is uncertain", async () => {
    mocks.signOut.mockResolvedValue({ error: new Error("uncertain") });
    render(<AppShell context={actor} navigation={[]}><p>不可恢復之合成個案畫面</p></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    expect(await screen.findByText(/尚未確認登入已結束/)).toBeVisible();
    expect(screen.queryByText("不可恢復之合成個案畫面")).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it.each(["本機草稿", "待送草稿", "待核對草稿"])("warns before deleting a %s on this device", async () => {
    mocks.inspect.mockResolvedValue({ generation: "g1", revision: "r1", count: 1 });
    render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    const trigger = screen.getAllByRole("button", { name: "登出" })[0];
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("alertdialog", { name: "此裝置仍有 1 筆本機紀錄" });
    expect(dialog).toHaveTextContent("未送出或待核對");
    expect(mocks.checkedClear).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "返回核對／同步" }));
    expect(screen.getByText("合成工作頁")).toBeInTheDocument();
    expect(mocks.checkedClear).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("re-prompts without deleting when the device inventory changes after confirmation", async () => {
    mocks.inspect.mockResolvedValueOnce({ generation: "g1", revision: "r1", count: 1 })
      .mockResolvedValueOnce({ generation: "g1", revision: "r2", count: 2 });
    mocks.checkedClear.mockResolvedValueOnce("changed").mockResolvedValueOnce("cleared");
    render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    const first = await screen.findByRole("alertdialog", { name: "此裝置仍有 1 筆本機紀錄" });
    fireEvent.click(within(first).getByRole("button", { name: "放棄裝置紀錄並登出" }));
    const changed = await screen.findByRole("alertdialog", { name: "此裝置仍有 2 筆本機紀錄" });
    expect(changed).toHaveTextContent("裝置紀錄已變動");
    expect(mocks.checkedClear).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
    fireEvent.click(within(changed).getByRole("button", { name: "放棄裝置紀錄並登出" }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(mocks.checkedClear).toHaveBeenCalledTimes(2);
  });
  it("uses an unknown-count warning when IndexedDB cannot be read", async () => {
    mocks.inspect.mockRejectedValue(new Error("unreadable"));
    render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    const dialog = await screen.findByRole("alertdialog", { name: "無法確認此裝置的本機紀錄筆數" });
    expect(dialog).toHaveTextContent("筆數不明");
    expect(mocks.checkedClear).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "放棄裝置紀錄並登出" }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.checkedClear).not.toHaveBeenCalled();
  });
  it("bounds a blocked inventory read and never assumes it is empty", async () => {
    vi.useFakeTimers();
    try {
      mocks.inspect.mockImplementation(() => new Promise(() => {}));
      render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
      fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
      await act(async () => { await vi.advanceTimersByTimeAsync(5_001); });
      expect(screen.getByRole("alertdialog", { name: "無法確認此裝置的本機紀錄筆數" })).toBeInTheDocument();
      expect(mocks.checkedClear).not.toHaveBeenCalled();
      expect(mocks.signOut).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("masks the shell and exposes retry when a confirmed clear fails", async () => {
    mocks.inspect.mockResolvedValue({ generation: "g1", revision: "r1", count: 1 });
    mocks.checkedClear.mockRejectedValue(new Error("blocked"));
    render(<AppShell context={actor} navigation={[]}><p>合成個案內容</p></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    const dialog = await screen.findByRole("alertdialog", { name: "此裝置仍有 1 筆本機紀錄" });
    fireEvent.click(within(dialog).getByRole("button", { name: "放棄裝置紀錄並登出" }));
    expect(await screen.findByRole("button", { name: "檢查清理狀態並重試登出" })).toBeEnabled();
    expect(screen.queryByRole("alertdialog", { name: /本機紀錄/u })).not.toBeInTheDocument();
    expect(screen.queryByText("合成個案內容")).not.toBeInTheDocument();
    expect(mocks.signOut).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "檢查清理狀態並重試登出" }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(2));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.checkedClear).toHaveBeenCalledOnce();
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it("never starts a second deletion while the first confirmed delete is still blocked", async () => {
    vi.useFakeTimers();
    try {
      mocks.inspect.mockResolvedValue({ generation: "g1", revision: "r1", count: 0 });
      let finishDelete!: (value: "cleared") => void;
      mocks.checkedClear.mockImplementation(() => new Promise((resolve) => { finishDelete = resolve; }));
      render(<AppShell context={actor} navigation={[]}><p>合成個案內容</p></AppShell>);
      fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
      await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(10_001); });
      const retry = screen.getByRole("button", { name: "檢查清理狀態並重試登出" });
      expect(retry).toBeEnabled();
      expect(mocks.checkedClear).toHaveBeenCalledOnce();
      expect(mocks.clear).not.toHaveBeenCalled();
      fireEvent.click(retry);
      expect(mocks.checkedClear).toHaveBeenCalledOnce();
      expect(mocks.clear).not.toHaveBeenCalled();
      await act(async () => { finishDelete("cleared"); await Promise.resolve(); });
      expect(mocks.replace).toHaveBeenCalledWith("/login");
    } finally { vi.useRealTimers(); }
  });
  it("keeps two rapid logout clicks in one inventory flow", async () => {
    mocks.inspect.mockResolvedValue({ generation: "g1", revision: "r1", count: 1 });
    render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    const buttons = screen.getAllByRole("button", { name: "登出" });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    await screen.findByRole("alertdialog", { name: "此裝置仍有 1 筆本機紀錄" });
    expect(mocks.inspect).toHaveBeenCalledOnce();
    expect(mocks.checkedClear).not.toHaveBeenCalled();
  });
  it("returns through Escape without deleting any device record", async () => {
    mocks.inspect.mockResolvedValue({ generation: "g1", revision: "r1", count: 1 });
    render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    const trigger = screen.getAllByRole("button", { name: "登出" })[0];
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("alertdialog", { name: "此裝置仍有 1 筆本機紀錄" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog).not.toHaveAttribute("open");
    expect(mocks.checkedClear).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("does not clear or sign out after unmount during an inventory read", async () => {
    let resolveInspection!: (value: { generation: string; revision: string; count: number }) => void;
    mocks.inspect.mockImplementation(() => new Promise((resolve) => { resolveInspection = resolve; }));
    const view = render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    expect(screen.getByRole("alertdialog", { name: "檢查此裝置的本機紀錄" })).toBeInTheDocument();
    view.unmount();
    await act(async () => { resolveInspection({ generation: "g1", revision: "r1", count: 0 }); });
    expect(mocks.checkedClear).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("preserves the original draft when a write begins during the inventory read", async () => {
    function WriteDraft() { const guard = useCoreDraftGuard(); return <button onClick={guard.begin}>開始寫入</button>; }
    let resolveInspection!: (value: { generation: string; revision: string; count: number }) => void;
    mocks.inspect.mockImplementation(() => new Promise((resolve) => { resolveInspection = resolve; }));
    render(<AppShell context={actor} navigation={[]}><WriteDraft /></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "開始寫入" }));
    await act(async () => { resolveInspection({ generation: "g1", revision: "r1", count: 0 }); });
    expect(mocks.checkedClear).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "開始寫入" })).toBeInTheDocument();
    expect(screen.getByText("資料儲存中，請稍候再登出。")).toBeInTheDocument();
  });
  it("returns to the usable draft if a write starts just before checked deletion", async () => {
    function WriteDraft() { const guard = useCoreDraftGuard(); return <button onClick={guard.begin}>開始寫入</button>; }
    mocks.inspect.mockResolvedValue({ generation: "g1", revision: "r1", count: 1 });
    mocks.checkedClear.mockImplementation(async (_snapshot, _signal, canDelete) => {
      fireEvent.click(screen.getByRole("button", { name: "開始寫入" }));
      return canDelete() ? "cleared" : "blocked";
    });
    render(<AppShell context={actor} navigation={[]}><WriteDraft /></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    const dialog = await screen.findByRole("alertdialog", { name: "此裝置仍有 1 筆本機紀錄" });
    fireEvent.click(within(dialog).getByRole("button", { name: "放棄裝置紀錄並登出" }));
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    expect(mocks.checkedClear).toHaveBeenCalledOnce();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "開始寫入" })).toBeInTheDocument();
  });
  it("still revokes the session after an already-confirmed clear succeeds following unmount", async () => {
    mocks.inspect.mockResolvedValue({ generation: "g1", revision: "r1", count: 1 });
    const clearTabResumeState = vi.fn();
    document.addEventListener("daycare:session-ending", clearTabResumeState, { once: true });
    let finishClear!: (value: "cleared") => void;
    mocks.checkedClear.mockImplementation(() => new Promise((resolve) => { finishClear = resolve; }));
    const view = render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    const dialog = await screen.findByRole("alertdialog", { name: "此裝置仍有 1 筆本機紀錄" });
    fireEvent.click(within(dialog).getByRole("button", { name: "放棄裝置紀錄並登出" }));
    expect(mocks.checkedClear).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => { finishClear("cleared"); });
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(clearTabResumeState).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("still revokes the session if confirmed cleanup fails after the shell unmounts", async () => {
    mocks.inspect.mockResolvedValue({ generation: "g1", revision: "r1", count: 1 });
    let failClear!: (reason: Error) => void;
    mocks.checkedClear.mockImplementation(() => new Promise((_resolve, reject) => { failClear = reject; }));
    const view = render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    const dialog = await screen.findByRole("alertdialog", { name: "此裝置仍有 1 筆本機紀錄" });
    fireEvent.click(within(dialog).getByRole("button", { name: "放棄裝置紀錄並登出" }));
    view.unmount();
    await act(async () => { failClear(new Error("blocked")); });
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
