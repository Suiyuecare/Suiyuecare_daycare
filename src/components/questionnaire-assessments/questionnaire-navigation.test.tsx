// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn(), replace: vi.fn(), reload: vi.fn(), signOut: vi.fn(), releases: [] as (() => void)[] }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/staff/assessments/spmsq", useRouter: () => ({ refresh: stubs.refresh, replace: stubs.replace }) }));
vi.mock("@/lib/api/client-fetch", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api/client-fetch")>(), fetchWithTimeout: stubs.fetch, isClientFetchTimeoutError: () => false }));
vi.mock("@/lib/offline/draft-store", () => ({ clearOfflineDrafts: async () => {} }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabaseClient: () => ({ auth: { signOut: stubs.signOut } }) }));
vi.mock("@/components/app/branch-navigation", () => ({ reloadCurrentStaffRoute: stubs.reload }));
vi.mock("@/lib/navigation/pending-operation-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/navigation/pending-operation-lock")>();
  return { ...actual, tryAcquirePendingOperation: () => {
    const release = actual.tryAcquirePendingOperation(); if (release) stubs.releases.push(release); return release;
  } };
});

import { AppShell } from "@/components/app/app-shell";
import { hasPendingOperations, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import type { TenantContext } from "@/lib/domain/types";
import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import type { QuestionnaireSnapshot } from "@/lib/questionnaire-assessments/types";
import { QuestionnaireAssessmentsWorkspace } from "./questionnaire-assessment-editor";
import { clearQuestionnairePendingOnLogout } from "@/lib/questionnaire-assessments/pending";
import { clearQuestionnaireViewOnLogout } from "@/lib/questionnaire-assessments/readiness-view";

const org = "10000000-0000-4000-8000-000000000001";
const branch = "20000000-0000-4000-8000-000000000001";
const clientId = "30000000-0000-4000-8000-000000000001";
const context: TenantContext = { organizationId: org, organizationName: "測試機構", branchId: branch, branchName: "甲分支", userId: org, displayName: "測試護理人員",
  roles: ["nurse"], scopes: ["clients.read", "questionnaire_cognition.read", "questionnaire_cognition.manage"], assuranceLevel: "aal1", recentAal2At: null, demo: false };
const snapshot: QuestionnaireSnapshot = { formKey: "spmsq", generatedAt: "2026-09-25T01:00:00Z", matchingTotal: 1,
  clients: [{ clientId, displayName: "合成個案", serviceStatus: "active", latest: null, assessments: [], assessmentTotal: 0 }] };
const show = () => render(<AppShell context={context} navigation={[]}><QuestionnaireAssessmentsWorkspace context={context} assessorName="測試護理人員" canManage form={QUESTIONNAIRE_FORMS.spmsq}
  loadError={false} pageTitle="SPMSQ" selectedClientId={clientId} snapshot={{ ...snapshot, generatedAt: new Date().toISOString() }} /></AppShell>);
const firstQuestionGroup = () => screen.getByRole("radiogroup", { name: `1. ${QUESTIONNAIRE_FORMS.spmsq.questions[0]!.prompt}` });
const markDirty = () => fireEvent.click(within(firstQuestionGroup()).getByLabelText("答錯"));
const refresh = () => screen.getByRole("button", { name: "重新整理" });
const branches = () => screen.getAllByRole("button", { name: "測試機構，目前分支：甲分支" });
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
let sequence = 0;

describe("questionnaire draft leases with the actual application shell", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_SYNTHETIC_PREVIEW", "false");
    stubs.fetch.mockReset();
    stubs.fetch.mockResolvedValue(new Response(JSON.stringify({ requestId: org, status: "ok", errors: [], data: { branches: [{ id: branch, name: "甲分支" }], currentBranchId: branch } }), { status: 200 }));
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse("2026-09-27T00:00:00Z") + ++sequence * 120_000);
    vi.stubGlobal("fetch", stubs.fetch);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
    stubs.signOut.mockResolvedValue({ error: null });
  });
  afterEach(() => {
    cleanup(); for (const release of stubs.releases.splice(0)) release();
    clearQuestionnairePendingOnLogout(); clearQuestionnaireViewOnLogout(); vi.useRealTimers();
    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
    if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });

  it("requires shared discard before header refresh or branch selection, without treating dirty input as a sent write", () => {
    show(); expect(refresh()).not.toBeDisabled(); expect(branches().every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    markDirty(); expect(hasPendingOperations()).toBe(false); expect(refresh()).not.toBeDisabled();
    expect(branches().every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(refresh()); for (const button of branches()) fireEvent.click(button);
    expect(stubs.refresh).not.toHaveBeenCalled(); expect(stubs.reload).not.toHaveBeenCalled();
    // Opening the authorized branch list is a read, not a branch switch.
    expect(stubs.fetch.mock.calls.every(([path, init]) => path === "/api/context/branch" && init?.method !== "POST")).toBe(true);
    expect(screen.getByRole("dialog", { name: "放棄尚未保存的修改？" })).toBeVisible(); expect(window.confirm).not.toHaveBeenCalled();
  });

  it("returns to the same client's assessment chooser only after the unsaved guard allows leaving", () => {
    show();
    const link = screen.getByRole("link", { name: "返回這位個案的評估清單" });
    expect(link).toHaveAttribute("href", `/app/assessments?client=${clientId}`);
    markDirty();
    fireEvent.click(link);
    expect(screen.getByRole("dialog", { name: "放棄尚未保存的修改？" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    expect(firstQuestionGroup()).toBeVisible();
    expect(stubs.replace).not.toHaveBeenCalled();
  });

  it("releases only a known unsubmitted draft after explicit discard, allowing refresh and branch reads again", async () => {
    show(); markDirty(); fireEvent.click(screen.getByRole("button", { name: "新增一次評估" }));
    fireEvent.click(screen.getByRole("button", { name: "放棄修改並切換" })); expect(hasPendingOperations()).toBe(false);
    expect(refresh()).not.toBeDisabled(); fireEvent.click(refresh()); expect(stubs.refresh).toHaveBeenCalledTimes(1);
    stubs.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ requestId: org, status: "ok", errors: [],
      data: { branches: [{ id: branch, name: "甲分支" }], currentBranchId: branch } }), { status: 200 }));
    await waitFor(() => expect(branches()[0]).not.toBeDisabled()); fireEvent.click(branches()[0]!);
    await waitFor(() => expect(stubs.fetch).toHaveBeenCalledWith("/api/context/branch", { cache: "no-store" }));
  });

  it("keeps actual refresh and branch switching blocked after an unknown 503 even when no input was changed", async () => {
    show(); stubs.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: null, errors: [] }), { status: 503 }));
    fireEvent.click(screen.getByRole("button", { name: "保存本次評估" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeTruthy());
    expect(hasPendingOperations()).toBe(true); expect(refresh()).toBeDisabled();
    expect(branches().every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(refresh()); for (const button of branches()) fireEvent.click(button);
    fireEvent.click(screen.getByRole("link", { name: "返回這位個案的評估清單" }));
    expect(stubs.refresh).not.toHaveBeenCalled(); expect(stubs.fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "放棄尚未保存的修改？" })).not.toBeInTheDocument();
  });

  it("releases a known unsubmitted draft on permitted unmount without leaving the tab locked", () => {
    const view = show(); markDirty(); expect(hasPendingOperations()).toBe(false);
    view.unmount(); expect(hasPendingOperations()).toBe(false);
  });

  it("cannot start editing or writing during the real header/branch view-transition lease", () => {
    show(); let release: (() => void) | null = null;
    act(() => { release = tryAcquireViewTransition(); });
    expect(release).not.toBeNull();
    try {
      expect(screen.getByLabelText("評估日期")).toBeDisabled();
      expect(screen.getAllByRole("radio").every((input) => input.matches(":disabled"))).toBe(true);
      expect(screen.getByRole("button", { name: "保存本次評估" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "保存本次評估" })); expect(stubs.fetch).not.toHaveBeenCalled();
    } finally { act(() => { (release as (() => void) | null)?.(); }); }
    expect(screen.getByLabelText("評估日期")).not.toBeDisabled();
  });

  it.each(["header", "sidebar"])("allows unconditional %s safe logout and clears unknown intent without a native confirmation", async (placement) => {
    show(); stubs.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: null, errors: [] }), { status: 503 }));
    fireEvent.click(screen.getByRole("button", { name: "保存本次評估" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeTruthy());
    const logout = screen.getAllByRole("button", { name: "登出" }).find((button) => placement === "header" ? button.textContent?.trim() === "登出" : button.getAttribute("aria-label") === "登出")!;
    stubs.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", data: { cleared: true } }), { status: 200 }));
    fireEvent.click(logout);
    await waitFor(() => expect(stubs.replace).toHaveBeenCalledWith("/login"));
    expect(stubs.signOut).toHaveBeenCalledWith({ scope: "local" }); expect(hasPendingOperations()).toBe(false);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(window.confirm).not.toHaveBeenCalled();
  });
});
