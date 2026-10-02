// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import type { TenantContext } from "@/lib/domain/types";
import { filterNavigationByAccess, getNavigationGroups } from "@/lib/catalog";
const mocks = vi.hoisted(() => ({ pathname: "/app/staff/workspace/dashboard", clear: vi.fn(), pendingClaims: vi.fn(), pendingBody: vi.fn(), pendingNursing: vi.fn(), observeNursing: vi.fn(), pendingAnnouncements: vi.fn(), observeAnnouncements: vi.fn(), pendingReferrals: vi.fn(), observeReferrals: vi.fn(), pendingSocialWork: vi.fn(), observeSocialWork: vi.fn(), pendingPsychosocial: vi.fn(), observePsychosocial: vi.fn(), fetch: vi.fn(), signOut: vi.fn(), replace: vi.fn(), refresh: vi.fn(), branchRender: vi.fn() }));
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
vi.mock("./branch-switcher", () => ({ BranchSwitcher: () => { mocks.branchRender(); return <span>合成分支選單</span>; } }));
let AppShell: typeof import("./app-shell").AppShell;
let uploadJournal: typeof import("@/lib/imports/upload-pending");
let intakeJournal: typeof import("@/lib/client-intake/write-pending");
let medicationJournal: typeof import("@/lib/medications/pending");
let useCoreDraftGuard: typeof import("@/components/core-care/client-continuation").useCoreDraftGuard;
let CoreDraftConfirmation: typeof import("@/components/core-care/client-continuation").CoreDraftConfirmation;
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
  intakeJournal = await import("@/lib/client-intake/write-pending");
  medicationJournal = await import("@/lib/medications/pending");
  registerUnsavedChangesOwner = (await import("@/lib/navigation/unsaved-changes")).registerUnsavedChangesOwner;
  AppShell = (await import("./app-shell")).AppShell;
  ({ useCoreDraftGuard, CoreDraftConfirmation } = await import("@/components/core-care/client-continuation"));
});
afterEach(() => { cleanup(); uploadJournal.clearCmsUploadOnLogout(); intakeJournal.clearIntakeWritesOnLogout(); medicationJournal.clearMedicationPendingOnLogout(); for (const unregister of unregisterOwners.splice(0)) unregister(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("staff shell logout privacy", () => {
  it("clears the in-memory today-work search before asynchronous sign-out completes", async () => {
    let finish!: () => void; mocks.clear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const workMemory = await import("@/lib/workspace/today-work-memory");
    const authority = workMemory.todayWorkAuthoritySignature(actor);
    workMemory.observeTodayWorkAuthority(authority);
    workMemory.saveTodayWorkView("synthetic-work-scope", { ...workMemory.initialTodayWorkView, search: "合成個案姓名" });
    render(<AppShell context={actor} navigation={[]}><p>合成工作清單</p></AppShell>);
    expect(workMemory.readTodayWorkView("synthetic-work-scope")?.search).toBe("合成個案姓名");
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    expect(workMemory.readTodayWorkView("synthetic-work-scope")).toBeNull();
    expect(screen.queryByText("合成工作清單")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledOnce());
    await act(async () => finish());
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  });
  it("clears original intake intent before asynchronous logout and cannot revive it via authority ABA", async () => {
    let finish!: () => void; mocks.clear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const { emptyIntakeProfile } = await import("@/lib/client-intake/model");
    const clearIntake = vi.spyOn(intakeJournal, "clearIntakeWritesOnLogout");
    render(<AppShell context={actor} navigation={[]}><p>合成建檔資料</p></AppShell>);
    const operation = intakeJournal.beginIntakeWrite(actor, "profile", null, { action: "create",
      idempotency_key: "40000000-0000-4000-8000-000000000001", profile: { ...emptyIntakeProfile, displayName: "Synthetic", clientCode: "SYNTHETIC" } })!;
    expect(operation).not.toBeNull(); act(() => { intakeJournal.markIntakeWriteUnknown(operation); });
    expect(intakeJournal.hasIntakeWriteOperation()).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    expect(clearIntake).toHaveBeenCalledOnce(); expect(intakeJournal.hasIntakeWriteOperation()).toBe(false);
    expect(intakeJournal.isCurrentIntakeWrite(operation)).toBe(false);
    act(() => { intakeJournal.observeIntakeWriteAuthority(intakeJournal.intakeWriteAuthority({ ...actor, scopes: [] }));
      intakeJournal.observeIntakeWriteAuthority(intakeJournal.intakeWriteAuthority(actor)); });
    expect(intakeJournal.isIntakeWriteAuthorityCurrent(actor)).toBe(false);
    expect(screen.queryByText("合成建檔資料")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledOnce());
    await act(async () => finish()); await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  });
  it("clears original medication intent before asynchronous logout and cannot revive it via old props", async () => {
    let finish!: () => void; mocks.clear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const nurse = { ...actor, roles: ["nurse" as const], scopes: [...actor.scopes, "medications.administer"] };
    const clearMedication = vi.spyOn(medicationJournal, "clearMedicationPendingOnLogout");
    render(<AppShell context={nurse} navigation={[]}><p>合成用藥資料</p></AppShell>);
    const scope = { organizationId: actor.organizationId, branchId: actor.branchId, userId: actor.userId };
    const draft = { status: "administered" as const, occurredAt: "2026-09-28T09:00:00+08:00", reason: "Synthetic" };
    const operation = medicationJournal.beginMedicationOperation(scope, JSON.stringify(draft), { kind: "record",
      medicationAdministrationId: "40000000-0000-4000-8000-000000000001", status: draft.status, occurredAt: draft.occurredAt,
      mustRequireSecondVerification: false }, draft, "synthetic-source")!;
    expect(operation).not.toBeNull(); act(() => { medicationJournal.markMedicationUnknown(operation); });
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    expect(clearMedication).toHaveBeenCalledOnce(); expect(medicationJournal.getMedicationPending().operation).toBeNull();
    expect(medicationJournal.isMedicationOperationCurrent(operation)).toBe(false);
    act(() => { medicationJournal.observeMedicationAuthority(medicationJournal.medicationAuthoritySignature({ ...nurse, scopes: [] }));
      medicationJournal.observeMedicationAuthority(medicationJournal.medicationAuthoritySignature(nurse)); });
    expect(medicationJournal.medicationAuthorityMatches(scope)).toBe(false);
    expect(screen.queryByText("合成用藥資料")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledOnce());
    await act(async () => finish()); await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  });
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
  it("lets the canonical daily draft owner block a portal departure but never block safe logout", () => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
    const discard = vi.fn();
    function DirtyDraft() { const guard = useCoreDraftGuard({ onDiscard: discard }); return <><button onClick={guard.changed}>合成未儲存草稿</button><CoreDraftConfirmation draft={guard} /></>; }
    const confirm = vi.spyOn(window, "confirm");
    render(<AppShell context={actor} navigation={[]}><DirtyDraft /></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "合成未儲存草稿" }));
    const departure = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    act(() => screen.getAllByRole("link", { name: "回模組頁" })[0].dispatchEvent(departure));
    expect(departure.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog", { name: "尚有未保存內容" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    expect(discard).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    expect(discard).toHaveBeenCalledOnce(); expect(screen.queryByText("合成未儲存草稿")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull(); expect(confirm).not.toHaveBeenCalled();
  });
  it("marks only intake current in the sidebar, not a fallback care page", () => {
    mocks.pathname = "/app/client-intake";
    const { container } = render(<AppShell context={{ ...actor, demo: true }} navigation={getNavigationGroups("staff")}><p>合成收案頁</p></AppShell>);
    const current = container.querySelectorAll('.sidebar__nav [aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/app/client-intake");
  });
  it("opens the authorized assessment chooser from the common shortcut", () => {
    mocks.pathname = "/app/assessments";
    const { container } = render(<AppShell context={{ ...actor, demo: true }} navigation={getNavigationGroups("staff")}><p>合成評估入口</p></AppShell>);
    const shortcut = container.querySelector<HTMLAnchorElement>('.sidebar__nav a[href="/app/assessments"]');
    expect(shortcut).not.toBeNull();
    expect(shortcut).toHaveTextContent("評估量表");
    expect(shortcut).toHaveAttribute("aria-current", "page");
  });
  it("keeps the Finance-style header identity and refresh action separate from logout", async () => {
    render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);

    expect(screen.getByRole("status")).toHaveTextContent("合成員工姓名・照顧服務員・正式系統");
    expect(screen.getByText(/台北時間/u).closest("time")).toBeInTheDocument();
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
  it("updates only the clock while the shell and branch navigation remain idle", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T04:00:00.000Z"));
    try {
      render(<AppShell context={actor} navigation={[]}><p>合成工作頁</p></AppShell>);
      const clock = screen.getByText(/台北時間/u).closest("time")!;
      const firstTime = clock.textContent;
      expect(firstTime).toContain("12:00:00");
      const navigationRenders = mocks.branchRender.mock.calls.length;
      expect(navigationRenders).toBeGreaterThan(0);
      act(() => vi.advanceTimersByTime(3000));
      expect(clock.textContent).toContain("12:00:03");
      expect(clock.textContent).not.toBe(firstTime);
      expect(mocks.branchRender).toHaveBeenCalledTimes(navigationRenders);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
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
  it("keeps all authorized module entrances inside an optional all-features disclosure", () => {
    const navigation = getNavigationGroups();
    render(<AppShell context={actor} navigation={navigation}><p>合成工作頁</p></AppShell>);
    const disclosure = screen.getByText("全部功能").closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByRole("link", { name: "評估量表" })).toHaveAttribute("href", "/app/assessments");
    fireEvent.click(screen.getByText("全部功能"));
    for (const group of navigation.filter((item) => item.id !== "workspace")) {
      const control = screen.getByRole("button", { name: group.title });
      if (control.getAttribute("aria-expanded") !== "true") fireEvent.click(control);
    }
    const sidebar = screen.getByLabelText("主要功能");
    const entrances = new Set([...sidebar.querySelectorAll("a")].map((link) => link.getAttribute("href")));
    for (const page of navigation.flatMap((group) => group.pages)) expect(entrances.has(`/app/${page.slug}`)).toBe(true);
  });
  it("uses authorized role-specific mobile links with visible text in their accessible names", () => {
    const careWorker = { ...actor, scopes: ["clients.read", "attendance.read", "health.read"] };
    const navigation = filterNavigationByAccess(getNavigationGroups("staff"), careWorker);
    const shell = render(<AppShell context={careWorker} navigation={navigation}><p>合成工作頁</p></AppShell>);
    const mobile = screen.getByRole("navigation", { name: "常用功能" });
    expect(mobile.querySelectorAll("a")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "今日：首頁／工作儀表板" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "出勤：出勤管理" })).toHaveAttribute("href", "/app/staff/service-management/attendance");
    expect(screen.getByRole("link", { name: "量測：生命徵象紀錄" })).toHaveAttribute("href", "/app/staff/daily-care/vital-signs");
    mocks.pathname = "/app/staff/service-management/attendance";
    shell.rerender(<AppShell context={careWorker} navigation={navigation}><p>合成工作頁</p></AppShell>);
    expect(screen.getByRole("link", { name: "出勤：出勤管理" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "今日：首頁／工作儀表板" })).not.toHaveAttribute("aria-current");
  });
  it("removes revoked work shortcuts when the authority context changes", () => {
    const careWorker = { ...actor, scopes: ["clients.read", "attendance.read", "health.read"] };
    const shell = render(<AppShell context={careWorker} navigation={filterNavigationByAccess(getNavigationGroups("staff"), careWorker)}><p>合成工作頁</p></AppShell>);
    expect(screen.getByRole("link", { name: "出勤：出勤管理" })).toBeInTheDocument();
    const reduced = { ...careWorker, scopes: ["clients.read"] };
    shell.rerender(<AppShell context={reduced} navigation={filterNavigationByAccess(getNavigationGroups("staff"), reduced)}><p>合成工作頁</p></AppShell>);
    const mobile = screen.getByRole("navigation", { name: "常用功能" });
    expect(mobile.querySelectorAll("a")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "出勤：出勤管理" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "個案：個案中心" })).toBeInTheDocument();
  });
  it("opens the mobile drawer from More and restores focus on Escape", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    render(<AppShell context={actor} navigation={filterNavigationByAccess(getNavigationGroups("staff"), actor)}><p>合成工作頁</p></AppShell>);
    const opener = screen.getByRole("button", { name: "更多功能" });
    fireEvent.click(opener);
    expect(opener).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "關閉功能選單" }));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(opener).toHaveAttribute("aria-expanded", "false");
  });
  it("opens the active module on deep links and does not invent unauthorized shortcuts", () => {
    const navigation = getNavigationGroups().filter((group) => group.id === "daily-care");
    mocks.pathname = `/app/${navigation[0].pages[0].slug}`;
    render(<AppShell context={actor} navigation={navigation}><p>合成工作頁</p></AppShell>);
    expect(screen.getByText("全部功能").closest("details")).toHaveAttribute("open");
    for (const link of screen.getAllByRole("link", { name: navigation[0].pages[0].title })) expect(link).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "評估量表" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "每日彙整" })).not.toBeInTheDocument();
  });
  it("reopens the active module after navigating from a manually closed all-features menu", () => {
    const navigation = getNavigationGroups().filter((group) => ["daily-care", "assessments"].includes(group.id));
    mocks.pathname = `/app/${navigation[0].pages[0].slug}`;
    const shell = render(<AppShell context={actor} navigation={navigation}><p>合成工作頁</p></AppShell>);
    const oldDisclosure = screen.getByText("全部功能").closest("details")!;
    oldDisclosure.open = false;
    mocks.pathname = `/app/${navigation[1].pages[0].slug}`;
    shell.rerender(<AppShell context={actor} navigation={navigation}><p>合成工作頁</p></AppShell>);
    expect(screen.getByText("全部功能").closest("details")).toHaveAttribute("open");
    expect(screen.getByRole("link", { name: navigation[1].pages[0].title })).toHaveAttribute("aria-current", "page");
  });
  it.each(["social work", "psychosocial"] as const)("observes %s authority ABA outside its page", (module) => {
    const observe = module === "social work" ? mocks.observeSocialWork : mocks.observePsychosocial;
    const shell = render(<AppShell context={actor} navigation={[]}><p>合成其他工作頁</p></AppShell>);
    const first = observe.mock.calls[0][0];
    shell.rerender(<AppShell context={{ ...actor, userId: "30000000-0000-4000-8000-000000000002", roles: ["case_manager_social_worker"], scopes: ["clients.read", "social_work_records.read"] }} navigation={[]}><p>合成其他工作頁</p></AppShell>);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(observe.mock.calls[1][0]).not.toBe(first);
    shell.rerender(<AppShell context={actor} navigation={[]}><p>合成其他工作頁</p></AppShell>);
    expect(observe).toHaveBeenCalledTimes(3);
    expect(observe.mock.calls[2][0]).toBe(first);
  });
});
