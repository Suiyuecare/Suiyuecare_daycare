// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import type { TenantContext } from "@/lib/domain/types";
import { getNavigationGroups } from "@/lib/catalog";
const mocks = vi.hoisted(() => ({ pathname: "/app/staff/workspace/dashboard", clear: vi.fn(), pendingClaims: vi.fn(), pendingBody: vi.fn(), pendingNursing: vi.fn(), observeNursing: vi.fn(), pendingAnnouncements: vi.fn(), observeAnnouncements: vi.fn(), pendingReferrals: vi.fn(), observeReferrals: vi.fn(), pendingSocialWork: vi.fn(), observeSocialWork: vi.fn(), pendingPsychosocial: vi.fn(), observePsychosocial: vi.fn(), fetch: vi.fn(), signOut: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => { const router = { replace: mocks.replace, refresh: mocks.refresh }; return { usePathname: () => mocks.pathname, useRouter: () => router }; });
vi.mock("@/lib/offline/draft-store", () => ({ clearOfflineDrafts: mocks.clear }));
vi.mock("@/lib/service-management/claim-validation-pending", () => ({ clearClaimValidationPendingOnLogout: mocks.pendingClaims }));
vi.mock("@/lib/body-assessments/pending", () => ({ clearBodyAssessmentPendingOnLogout: mocks.pendingBody }));
vi.mock("@/lib/nursing-assessments/pending", () => ({ clearNursingAssessmentPendingOnLogout: mocks.pendingNursing,
  observeNursingAssessmentAuthority: mocks.observeNursing,
  nursingAssessmentAuthoritySignature: (context: TenantContext) => JSON.stringify([context.organizationId, context.branchId, context.userId,
    context.demo, [...context.roles].sort(), [...context.scopes].sort(), context.assuranceLevel, context.recentAal2At]) }));
vi.mock("@/lib/staff-announcements/pending", () => ({ clearStaffAnnouncementPendingOnLogout: mocks.pendingAnnouncements,
  observeStaffAnnouncementAuthority: mocks.observeAnnouncements,
  staffAnnouncementAuthoritySignature: (context: TenantContext) => JSON.stringify([context.organizationId, context.branchId, context.userId,
    context.demo, [...context.roles].sort(), [...context.scopes].sort(), context.assuranceLevel, context.recentAal2At]) }));
vi.mock("@/lib/referral-management/pending", () => ({ clearReferralPendingOnLogout: mocks.pendingReferrals,
  observeReferralAuthority: mocks.observeReferrals,
  referralAuthoritySignature: (context: TenantContext) => JSON.stringify([context.organizationId, context.branchId, context.userId,
    context.demo, [...context.roles].sort(), [...context.scopes].sort(), context.assuranceLevel]) }));
vi.mock("@/lib/social-work-records/pending", () => ({ clearSocialWorkPendingOnLogout: mocks.pendingSocialWork,
  observeSocialWorkAuthority: mocks.observeSocialWork,
  socialWorkAuthoritySignature: (context: TenantContext) => JSON.stringify([context.organizationId, context.branchId, context.userId,
    context.demo, [...context.roles].sort(), [...context.scopes].sort(), context.assuranceLevel]) }));
vi.mock("@/lib/psychosocial-assessments/pending", () => ({ clearPsychosocialAssessmentPendingOnLogout: mocks.pendingPsychosocial,
  observePsychosocialAssessmentAuthority: mocks.observePsychosocial,
  psychosocialAssessmentAuthoritySignature: (context: TenantContext) => JSON.stringify([context.organizationId, context.branchId, context.userId,
    context.demo, [...context.roles].sort(), [...context.scopes].sort(), context.assuranceLevel]) }));
vi.mock("@/lib/api/client-fetch", () => ({ fetchWithTimeout: mocks.fetch }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabaseClient: () => ({ auth: { signOut: mocks.signOut } }) }));
vi.mock("./branch-switcher", () => ({ BranchSwitcher: () => <span>合成分支選單</span> }));
let AppShell: typeof import("./app-shell").AppShell;
let uploadJournal: typeof import("@/lib/imports/upload-pending");
import { useCoreDraftGuard } from "@/components/core-care/client-continuation";
let registerUnsavedChangesOwner: typeof import("@/lib/navigation/unsaved-changes").registerUnsavedChangesOwner;
const unregisterOwners: (() => void)[] = [];
const actor: TenantContext = { organizationId: "10000000-0000-4000-8000-000000000001", branchId: "20000000-0000-4000-8000-000000000001",
  userId: "30000000-0000-4000-8000-000000000001", organizationName: "synthetic", branchName: "synthetic", displayName: "合成員工姓名", roles: ["care_worker"],
  scopes: ["imports.manage", "clients.read", "clients.demographics.read", "clients.manage", "clients.view_all"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
beforeEach(async () => {
  vi.resetModules();
  mocks.pathname = "/app/staff/workspace/dashboard";
  vi.clearAllMocks(); mocks.clear.mockResolvedValue(undefined); mocks.signOut.mockResolvedValue({ error: null });
  mocks.fetch.mockResolvedValue(Response.json({ status: "ok", data: { cleared: true } }));
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  uploadJournal = await import("@/lib/imports/upload-pending");
  registerUnsavedChangesOwner = (await import("@/lib/navigation/unsaved-changes")).registerUnsavedChangesOwner;
  AppShell = (await import("./app-shell")).AppShell;
});
afterEach(() => { cleanup(); uploadJournal.clearCmsUploadOnLogout(); for (const unregister of unregisterOwners.splice(0)) unregister(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("staff shell logout privacy", () => {
  it("clears real CMS upload owner immediately and prevents old props or observer ABA resurrection", async () => {
    let finish!: () => void; mocks.clear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const clearUpload = vi.spyOn(uploadJournal, "clearCmsUploadOnLogout");
    const shell = render(<AppShell context={actor} navigation={[]}><p>待核对上傳的合成個案</p></AppShell>);
    const scope = uploadJournal.cmsUploadScope(actor, "routine-intake", null);
    expect(uploadJournal.canUseCmsUpload(scope)).toBe(true);
    const pending = uploadJournal.beginCmsUpload(scope, { name: "synthetic.html", size: 10, mime: "text/html", sha256: "a".repeat(64) },
      "40000000-0000-4000-8000-000000000001", "50000000-0000-4000-8000-000000000001")!;
    uploadJournal.markCmsUploadUnknown(pending, scope); const read = uploadJournal.beginCmsUploadRead(scope, pending.token)!;
    expect(uploadJournal.hasCmsUploadOperation()).toBe(true); fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    expect(clearUpload).toHaveBeenCalledOnce(); expect(uploadJournal.hasCmsUploadOperation()).toBe(false);
    expect(read.signal.aborted).toBe(true); expect(read.current()).toBe(false);
    expect(screen.queryByText("待核对上傳的合成個案")).not.toBeInTheDocument();
    const changed = { ...actor, branchId: "20000000-0000-4000-8000-000000000002" };
    act(() => { uploadJournal.observeCmsUploadAuthority(uploadJournal.cmsUploadAuthority(changed));
      uploadJournal.observeCmsUploadAuthority(uploadJournal.cmsUploadAuthority(actor)); });
    shell.rerender(<AppShell context={changed} navigation={[]}><p>不能恢復的分支資料</p></AppShell>);
    shell.rerender(<AppShell context={actor} navigation={[]}><p>不能恢復的原帳號資料</p></AppShell>);
    expect(uploadJournal.canUseCmsUpload(scope)).toBe(false); expect(uploadJournal.getCmsUploadOperation(scope)).toBeNull();
    expect(screen.queryByText("不能恢復的原帳號資料")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledOnce());
    await act(async () => finish()); await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login")); read.close();
  });
  it("waits for explicit editor discard before header refresh", async () => {
    let dirty = true; let proceed: (() => void) | null = null;
    unregisterOwners.push(registerUnsavedChangesOwner({ isDirty: () => dirty,
      requestDiscard: (action) => { proceed = action; }, onInvalidate: () => {} }));
    render(<AppShell context={actor} navigation={[]}><p>合成未保存編輯</p></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "重新整理" }));
    expect(mocks.refresh).not.toHaveBeenCalled(); expect(proceed).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新整理" }));
    expect(mocks.refresh).not.toHaveBeenCalled();
    dirty = false; proceed!();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  });
  it("invalidates unsent editors before journal, cache and authentication cleanup, without asking", async () => {
    const invalidate = vi.fn(); const requestDiscard = vi.fn();
    unregisterOwners.push(registerUnsavedChangesOwner({ isDirty: () => true, requestDiscard, onInvalidate: invalidate }));
    render(<AppShell context={actor} navigation={[]}><p>合成未保存編輯</p></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    expect(invalidate).toHaveBeenCalledOnce(); expect(requestDiscard).not.toHaveBeenCalled();
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(mocks.pendingBody.mock.invocationCallOrder[0]);
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(mocks.pendingNursing.mock.invocationCallOrder[0]);
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(mocks.pendingClaims.mock.invocationCallOrder[0]);
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(mocks.pendingAnnouncements.mock.invocationCallOrder[0]);
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(mocks.pendingReferrals.mock.invocationCallOrder[0]);
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(mocks.pendingSocialWork.mock.invocationCallOrder[0]);
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(mocks.pendingPsychosocial.mock.invocationCallOrder[0]);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("合成未保存編輯")).not.toBeInTheDocument();
  });
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
  it("lets the existing draft guard block a portal departure", () => {
    function DirtyDraft() { const guard = useCoreDraftGuard(); return <button onClick={guard.changed}>合成未儲存草稿</button>; }
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AppShell context={actor} navigation={[]}><DirtyDraft /></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "合成未儲存草稿" }));
    const departure = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getAllByRole("link", { name: "回模組頁" })[0].dispatchEvent(departure);
    expect(departure.defaultPrevented).toBe(true);
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("marks only intake current in the sidebar, not a fallback care page", () => {
    mocks.pathname = "/app/client-intake";
    const { container } = render(<AppShell context={{ ...actor, demo: true }} navigation={getNavigationGroups("staff")}><p>合成收案頁</p></AppShell>);
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
    expect(mocks.pendingClaims).not.toHaveBeenCalled();
    expect(mocks.pendingBody).not.toHaveBeenCalled();
    expect(mocks.pendingNursing).not.toHaveBeenCalled();
    expect(mocks.pendingAnnouncements).not.toHaveBeenCalled();
    expect(mocks.pendingReferrals).not.toHaveBeenCalled();
    expect(mocks.pendingSocialWork).not.toHaveBeenCalled();
    expect(mocks.pendingPsychosocial).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("immediately removes the whole sensitive shell and still signs out after cache failure", async () => {
    mocks.clear.mockRejectedValue(new Error("blocked"));
    render(<AppShell context={actor} navigation={[]}><p>合成個案健康內容</p></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    expect(screen.queryByText("合成個案健康內容")).not.toBeInTheDocument();
    expect(screen.queryByText("合成員工姓名")).not.toBeInTheDocument();
    expect(await screen.findByText(/裝置草稿尚未確認清除/)).toBeVisible();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" }); expect(mocks.fetch).toHaveBeenCalled();
    expect(mocks.pendingClaims).toHaveBeenCalledOnce();
    expect(mocks.pendingBody).toHaveBeenCalledOnce();
    expect(mocks.pendingNursing).toHaveBeenCalledOnce();
    expect(mocks.pendingNursing.mock.invocationCallOrder[0]).toBeLessThan(mocks.clear.mock.invocationCallOrder[0]);
    expect(mocks.pendingNursing.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]);
    expect(mocks.pendingAnnouncements).toHaveBeenCalledOnce();
    expect(mocks.pendingReferrals).toHaveBeenCalledOnce();
    for (const clearJournal of [mocks.pendingSocialWork, mocks.pendingPsychosocial]) {
      expect(clearJournal).toHaveBeenCalledOnce();
      expect(clearJournal.mock.invocationCallOrder[0]).toBeLessThan(mocks.clear.mock.invocationCallOrder[0]);
      expect(clearJournal.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]);
    }
    expect(mocks.pendingReferrals.mock.invocationCallOrder[0]).toBeLessThan(mocks.clear.mock.invocationCallOrder[0]);
    expect(mocks.pendingReferrals.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]);
    expect(mocks.pendingClaims.mock.invocationCallOrder[0]).toBeLessThan(mocks.clear.mock.invocationCallOrder[0]);
    expect(mocks.pendingClaims.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]);
    expect(mocks.pendingBody.mock.invocationCallOrder[0]).toBeLessThan(mocks.clear.mock.invocationCallOrder[0]);
    expect(mocks.pendingBody.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]);
    expect(mocks.pendingAnnouncements.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "重試清理並登出" })).toBeEnabled();
  });
  it("redirects only once all three cleanup confirmations succeed", async () => {
    render(<AppShell context={actor} navigation={[]}><p>合成個案</p></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.pendingClaims).toHaveBeenCalledOnce();
    expect(mocks.pendingBody).toHaveBeenCalledOnce();
    expect(mocks.pendingNursing).toHaveBeenCalledOnce();
    expect(mocks.pendingAnnouncements).toHaveBeenCalledOnce();
  });
  it("keeps the synthetic return action free of storage or authentication operations", () => {
    vi.stubEnv("NEXT_PUBLIC_SYNTHETIC_PREVIEW", "true");
    render(<AppShell context={{ ...actor, demo: true }} navigation={[]}><p>合成展示</p></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "返回試用入口" }));
    expect(mocks.replace).toHaveBeenCalledWith("/login"); expect(mocks.clear).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.pendingClaims).toHaveBeenCalledOnce();
    expect(mocks.pendingClaims.mock.invocationCallOrder[0]).toBeLessThan(mocks.replace.mock.invocationCallOrder[0]);
    expect(mocks.pendingBody).toHaveBeenCalledOnce();
    expect(mocks.pendingBody.mock.invocationCallOrder[0]).toBeLessThan(mocks.replace.mock.invocationCallOrder[0]);
    expect(mocks.pendingNursing).toHaveBeenCalledOnce();
    expect(mocks.pendingNursing.mock.invocationCallOrder[0]).toBeLessThan(mocks.replace.mock.invocationCallOrder[0]);
    expect(mocks.pendingAnnouncements).toHaveBeenCalledOnce();
    expect(mocks.pendingAnnouncements.mock.invocationCallOrder[0]).toBeLessThan(mocks.replace.mock.invocationCallOrder[0]);
    for (const clearJournal of [mocks.pendingSocialWork, mocks.pendingPsychosocial]) {
      expect(clearJournal).toHaveBeenCalledOnce();
      expect(clearJournal.mock.invocationCallOrder[0]).toBeLessThan(mocks.replace.mock.invocationCallOrder[0]);
    }
  });
  it("offers retry without restoring data when sign-out itself is uncertain", async () => {
    mocks.signOut.mockResolvedValue({ error: new Error("uncertain") });
    render(<AppShell context={actor} navigation={[]}><p>不可恢復之合成個案畫面</p></AppShell>);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    expect(await screen.findByText(/尚未確認登入已結束/)).toBeVisible();
    expect(screen.queryByText("不可恢復之合成個案畫面")).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("observes authority changes even outside the announcement route", () => {
    const shell = render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    const first = mocks.observeAnnouncements.mock.calls[0][0];
    shell.rerender(<AppShell context={{ ...actor, scopes: ["announcements.read"] }} navigation={[]}><p>合成工作頁</p></AppShell>);
    expect(mocks.observeAnnouncements).toHaveBeenCalledTimes(2);
    expect(mocks.observeAnnouncements.mock.calls[1][0]).not.toBe(first);
    shell.rerender(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    expect(mocks.observeAnnouncements).toHaveBeenCalledTimes(3);
    expect(mocks.observeAnnouncements.mock.calls[2][0]).toBe(first);
  });
  it("observes nursing authority changes and their return outside the nursing route", () => {
    const shell = render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    const first = mocks.observeNursing.mock.calls[0][0];
    shell.rerender(<AppShell context={{ ...actor, roles: ["nurse"], scopes: ["nursing_assessments.read"] }} navigation={[]}><p>合成工作頁</p></AppShell>);
    expect(mocks.observeNursing).toHaveBeenCalledTimes(2);
    expect(mocks.observeNursing.mock.calls[1][0]).not.toBe(first);
    shell.rerender(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    expect(mocks.observeNursing).toHaveBeenCalledTimes(3);
    expect(mocks.observeNursing.mock.calls[2][0]).toBe(first);
  });
  it("observes referral authority and its ABA return while another route is mounted", () => {
    const shell = render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    const first = mocks.observeReferrals.mock.calls[0][0];
    shell.rerender(<AppShell context={{ ...actor, roles: ["case_manager_social_worker"], scopes: ["clients.read", "referral_management.read"] }} navigation={[]}><p>合成工作頁</p></AppShell>);
    expect(mocks.observeReferrals).toHaveBeenCalledTimes(2);
    expect(mocks.observeReferrals.mock.calls[1][0]).not.toBe(first);
    shell.rerender(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
    expect(mocks.observeReferrals).toHaveBeenCalledTimes(3);
    expect(mocks.observeReferrals.mock.calls[2][0]).toBe(first);
  });
  it.each(["social work", "psychosocial"] as const)("observes %s authority ABA outside its page", (module) => {
    const observe = module === "social work" ? mocks.observeSocialWork : mocks.observePsychosocial;
    const shell = render(<AppShell context={actor} navigation={[]}><p>合成其他工作頁</p></AppShell>);
    const first = observe.mock.calls[0][0];
    shell.rerender(<AppShell context={{ ...actor, userId: "other-synthetic", roles: ["case_manager_social_worker"], scopes: ["clients.read", "social_work_records.read"] }} navigation={[]}><p>合成其他工作頁</p></AppShell>);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(observe.mock.calls[1][0]).not.toBe(first);
    shell.rerender(<AppShell context={actor} navigation={[]}><p>合成其他工作頁</p></AppShell>);
    expect(observe).toHaveBeenCalledTimes(3);
    expect(observe.mock.calls[2][0]).toBe(first);
  });
});
