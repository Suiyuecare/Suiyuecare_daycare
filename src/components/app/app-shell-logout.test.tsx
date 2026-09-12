// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TenantContext } from "@/lib/domain/types";
const mocks = vi.hoisted(() => ({ clear: vi.fn(), fetch: vi.fn(), signOut: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => { const router = { replace: mocks.replace, refresh: mocks.refresh }; return { usePathname: () => "/app/staff/workspace/dashboard", useRouter: () => router }; });
vi.mock("@/lib/offline/draft-store", () => ({ clearOfflineDrafts: mocks.clear }));
vi.mock("@/lib/api/client-fetch", () => ({ fetchWithTimeout: mocks.fetch }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabaseClient: () => ({ auth: { signOut: mocks.signOut } }) }));
vi.mock("./branch-switcher", () => ({ BranchSwitcher: () => <span>合成分支選單</span> }));
import { AppShell } from "./app-shell";
const actor: TenantContext = { organizationId: "synthetic", branchId: "synthetic", userId: "synthetic", organizationName: "synthetic", branchName: "synthetic", displayName: "合成員工姓名", roles: ["care_worker"], scopes: [], assuranceLevel: "aal2", recentAal2At: null, demo: false };
beforeEach(() => {
  vi.clearAllMocks(); mocks.clear.mockResolvedValue(undefined); mocks.signOut.mockResolvedValue({ error: null });
  mocks.fetch.mockResolvedValue(Response.json({ status: "ok", data: { cleared: true } }));
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("staff shell logout privacy", () => {
  it("immediately removes the whole sensitive shell and still signs out after cache failure", async () => {
    mocks.clear.mockRejectedValue(new Error("blocked"));
    render(<AppShell context={actor} navigation={[]}><p>合成個案健康內容</p></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "登出" }));
    expect(screen.queryByText("合成個案健康內容")).not.toBeInTheDocument();
    expect(screen.queryByText("合成員工姓名")).not.toBeInTheDocument();
    expect(await screen.findByText(/裝置草稿尚未確認清除/)).toBeVisible();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" }); expect(mocks.fetch).toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "重試清理並登出" })).toBeEnabled();
  });
  it("redirects only once all three cleanup confirmations succeed", async () => {
    render(<AppShell context={actor} navigation={[]}><p>合成個案</p></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "登出" }));
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
    fireEvent.click(screen.getByRole("button", { name: "登出" }));
    expect(await screen.findByText(/尚未確認登入已結束/)).toBeVisible();
    expect(screen.queryByText("不可恢復之合成個案畫面")).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
