"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition, type MouseEvent as ReactMouseEvent } from "react";
import {
  Bell,
  BrainCircuit,
  Building2,
  ChevronDown,
  ClipboardList,
  LogOut,
  Menu,
  UsersRound,
  X,
} from "lucide-react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import type { NavigationGroup } from "@/lib/catalog";
import { appBranding } from "@/lib/config/branding";
import { companyNavigation } from "@/lib/config/company-navigation";
import type { TenantContext } from "@/lib/domain/types";
import { STORE_OVERVIEW_PATH, STORE_OVERVIEW_TITLE } from "@/lib/store-overview/types";
import { clearOfflineDrafts, clearOfflineDraftsIfUnchanged, inspectOfflineDraftsForLogout, type OfflineLogoutSnapshot } from "@/lib/offline/draft-store";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { runLogoutTasks, type LogoutResult } from "@/lib/auth/logout-tasks";
import { roleDisplayName } from "@/lib/domain/roles";
import { hasPendingOperations, hasViewTransition, tryAcquireViewTransition, usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { getScopeChangePendingReason, hasScopeChangePending, useScopeChangePendingReason } from "@/lib/navigation/scope-change-pending";
import { BranchSwitcher } from "./branch-switcher";
import { CoreDraftGuardHost, hasCoreDraftBlocked, hasCoreDraftPending, requestCoreDraftLeave, useCoreDraftBlocked, useCoreDraftHeld, useCoreDraftPending } from "./core-draft-guard";
import { DailyNavigationRegistrationContext, type ValidatedDailySelection } from "./daily-navigation-context";
import { NavigationLink } from "./navigation-link";
import { TaipeiClock } from "./taipei-clock";
import { dailyWorkflowHref } from "@/lib/core-care/workflow-links";
import { DAILY_SERVICE_SUMMARY_PATH } from "@/lib/daily-service-summary/query";
import { iconForPage } from "./page-icons";
import { ASSESSMENT_MATRIX_PATH, ASSESSMENT_MATRIX_TITLE, canViewAssessmentMatrix } from "@/lib/assessment-matrix/config";
import { AD8_CANDIDATE_PATH, AD8_CANDIDATE_TITLE, canViewAd8Candidate } from "@/lib/questionnaire-assessments/ad8-candidate";

// Keep the shared entry points stable. The third slot is a familiar task for
// the person's approved role, selected only from server-filtered navigation.
// Clinical responsibilities take precedence over a concurrent director role;
// the complete authorized catalog remains available under More.
const mobileRolePriorities = [
  ["nurse", [7, 51, 3]],
  ["case_manager_social_worker", [29, 28, 43]],
  ["care_worker", [3, 6, 46]],
  ["transport_driver", [48, 47]],
  ["professional", [40, 41, 37]],
  ["finance_claims", [64, 49]],
  ["branch_director", [54, 63]],
  ["branch_supervisor", [54, 63]],
  ["organization_manager", [54, 63]],
  ["platform_ops", [83]],
] as const;
const mobileFallbackPriorities = [3, 6, 46, 54, 29, 7, 48, 64, 49, 40, 41, 83] as const;
const mobileShortLabels: Record<number, string> = {
  1: "今日", 2: "個案", 3: "量測", 6: "日誌", 7: "用藥", 28: "社評", 29: "社工",
  37: "照會", 40: "物治", 41: "職治", 43: "溝通", 46: "出勤", 47: "趟次", 48: "接送",
  49: "申報", 51: "護評", 54: "彙整", 63: "排班", 64: "帳務", 83: "稽核",
};

type LogoutReview = { status: "idle" | "checking" | "review" | "clearing"; snapshot: OfflineLogoutSnapshot | null; unknown: boolean; changed: boolean };
const IDLE_LOGOUT_REVIEW: LogoutReview = { status: "idle", snapshot: null, unknown: false, changed: false };

function settledWithin<T>(promise: Promise<T>, milliseconds: number): Promise<{ ok: true; value: T } | { ok: false }> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve({ ok: false }), milliseconds);
    promise.then((value) => resolve({ ok: true, value }), () => resolve({ ok: false }))
      .finally(() => window.clearTimeout(timer));
  });
}

function mobilePrimaryPages(navigation: readonly NavigationGroup[], roles: TenantContext["roles"]) {
  const pages = new Map(navigation.flatMap((group) => group.pages).map((page) => [page.number, page]));
  const priorities = [1, 2,
    ...mobileRolePriorities.filter(([role]) => roles.includes(role)).flatMap(([, numbers]) => numbers),
    ...mobileFallbackPriorities,
  ];
  return [...new Set(priorities)].flatMap((number) => {
    const page = pages.get(number);
    return page ? [page] : [];
  }).slice(0, 3);
}

export function AppShell({
  context,
  navigation,
  showStoreOverview = false,
  showAssessmentMatrix = false,
  children,
}: {
  context: TenantContext;
  navigation: readonly NavigationGroup[];
  showStoreOverview?: boolean;
  showAssessmentMatrix?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const sensitiveDocument = pathname === DAILY_SERVICE_SUMMARY_PATH;
  const searchParams = useSearchParams();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [compactNavigation, setCompactNavigation] = useState(false);
  const [logoutState, setLogoutState] = useState<"idle" | "working" | "attention">("idle");
  const [logoutResult, setLogoutResult] = useState<LogoutResult | null>(null);
  const [logoutReview, setLogoutReview] = useState<LogoutReview>(IDLE_LOGOUT_REVIEW);
  const [dailyNavigation, setDailyNavigation] = useState<(ValidatedDailySelection & { registration: symbol }) | null>(null);
  const [refreshPending, startRefreshTransition] = useTransition();
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const logoutRunning = useRef(false);
  const logoutReviewRunning = useRef(false);
  const logoutReviewClearRunning = useRef(false);
  const logoutReviewAbort = useRef<AbortController | null>(null);
  const logoutClearResult = useRef<Promise<boolean> | null>(null);
  const shellMounted = useRef(true);
  const logoutReviewSequence = useRef(0);
  const logoutReviewDialog = useRef<HTMLDialogElement>(null);
  const logoutReviewCancel = useRef<HTMLButtonElement>(null);
  const logoutReviewConfirm = useRef<HTMLButtonElement>(null);
  const logoutReviewTrigger = useRef<HTMLElement | null>(null);
  const logoutReviewTitleId = useId();
  const refreshLease = useRef<(() => void) | null>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuOpener = useRef<HTMLButtonElement | null>(null);
  const menuClose = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const operationPending = usePendingOperations();
  const viewPending = useViewTransitionPending();
  const draftBlocked = useCoreDraftBlocked();
  const draftHeld = useCoreDraftHeld();
  const draftPending = useCoreDraftPending();
  const scopeChangeReason = useScopeChangePendingReason();
  const portalLeaveBlocked = scopeChangeReason === "busy" || scopeChangeReason === "unknown";
  const scopeChangeBlockedReason = scopeChangeReason === "unknown" ? "這頁的儲存結果尚未確認，請回表單核對後再離開。"
    : scopeChangeReason === "busy" ? "這頁正在儲存，請稍候再離開。"
      : scopeChangeReason === "dirty" ? "這頁有未儲存輸入，請先儲存或在頁內放棄。" : undefined;
  function guardPortalLeave(event: ReactMouseEvent<HTMLAnchorElement>) {
    const current = getScopeChangePendingReason();
    if (current !== "busy" && current !== "unknown") return;
    event.preventDefault();
    event.stopPropagation();
  }
  const logoutBlockedReason = operationPending ? "有一筆操作結果尚待確認，不能登出並清除裝置草稿；請先回原表單核對。"
    : viewPending ? "系統正在更新或切換分支，請稍候再登出。"
      : draftBlocked ? "資料儲存中或寫入結果未確認，請先完成核對再登出。" : scopeChangeBlockedReason;
  const availablePages = navigation.flatMap((group) => group.pages);
  const activePage = availablePages.find((page) => pathname === `/app/${page.slug}`);
  const activeGroup = navigation.find((group) =>
    group.pages.some((page) => page.number === activePage?.number) ||
    ((pathname === ASSESSMENT_MATRIX_PATH || pathname === AD8_CANDIDATE_PATH) && group.id === "assessments"));
  const notificationPage = availablePages.find((page) => page.number === 67);
  const showClientIntake = context.demo || ["clients.read", "clients.demographics.read"].every((scope) => context.scopes.includes(scope));
  const showAssessmentMatrixLink = showAssessmentMatrix && canViewAssessmentMatrix(context);
  const mobilePages = mobilePrimaryPages(navigation, context.roles);
  const mobileCurrentInMore = !mobilePages.some((page) => pathname === `/app/${page.slug}`);
  const [groupRoute, setGroupRoute] = useState(pathname);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const active = navigation.find((group) =>
      group.pages.some((page) => pathname === `/app/${page.slug}`) ||
      ((pathname === ASSESSMENT_MATRIX_PATH || pathname === AD8_CANDIDATE_PATH) && group.id === "assessments"),
    );
    return new Set(active ? [active.id] : ["workspace", "daily-care"]);
  });
  const primaryRoleLabel = context.roles[0] ? roleDisplayName(context.roles[0]) : "已登入";
  const runtimeLabel = context.demo ? "合成資料" : "正式系統";
  const pageTitle = showStoreOverview && pathname === STORE_OVERVIEW_PATH
    ? STORE_OVERVIEW_TITLE
    : pathname === ASSESSMENT_MATRIX_PATH ? ASSESSMENT_MATRIX_TITLE
    : pathname === AD8_CANDIDATE_PATH ? AD8_CANDIDATE_TITLE
    : activePage?.title ?? (pathname === "/app/staff/assessments/external-results"
      ? "外部評估結果登錄" : appBranding.applicationName);
  const registerDailyNavigation = useCallback((selection: ValidatedDailySelection) => {
    if (selection.scope.organizationId !== context.organizationId ||
        selection.scope.branchId !== context.branchId ||
        selection.scope.userId !== context.userId) return () => {};
    const registration = Symbol("daily-navigation");
    setDailyNavigation({ ...selection, registration });
    return () => setDailyNavigation((current) => current?.registration === registration ? null : current);
  }, [context.organizationId, context.branchId, context.userId]);
  const currentDailyNavigation = dailyNavigation &&
    dailyNavigation.scope.organizationId === context.organizationId &&
    dailyNavigation.scope.branchId === context.branchId &&
    dailyNavigation.scope.userId === context.userId &&
    searchParams.getAll("date").length === 1 && searchParams.get("date") === dailyNavigation.serviceDate &&
    searchParams.getAll("client").length === 1 && searchParams.get("client") === dailyNavigation.clientId &&
    (dailyNavigation.shift ? searchParams.getAll("shift").length === 1 && searchParams.get("shift") === dailyNavigation.shift
      : searchParams.getAll("shift").length === 0) &&
    pathname === dailyWorkflowHref(dailyNavigation.page, dailyNavigation.serviceDate, dailyNavigation.clientId, dailyNavigation.shift).split("?")[0]
      ? dailyNavigation : null;

  useEffect(() => {
    if (!refreshPending && refreshLease.current) {
      refreshLease.current();
      refreshLease.current = null;
    }
  }, [refreshPending, refreshEpoch]);
  useEffect(() => () => {
    refreshLease.current?.();
    refreshLease.current = null;
  }, []);
  useEffect(() => {
    shellMounted.current = true;
    return () => {
      shellMounted.current = false;
      logoutReviewRunning.current = false;
      logoutReviewSequence.current += 1;
      logoutReviewAbort.current?.abort();
      logoutReviewAbort.current = null;
    };
  }, []);
  useEffect(() => {
    const dialog = logoutReviewDialog.current;
    if (!dialog) return;
    if (logoutReview.status !== "idle" && !dialog.open) {
      try { dialog.showModal(); logoutReviewCancel.current?.focus(); }
      catch {
        // A failed native modal must not strand the user behind an invisible
        // confirmation. Keep the device data and return to the safe shell.
        logoutReviewSequence.current += 1;
        logoutReviewRunning.current = false;
        logoutReviewAbort.current?.abort();
        logoutReviewAbort.current = null;
        window.setTimeout(() => {
          if (!shellMounted.current) return;
          setLogoutReview(IDLE_LOGOUT_REVIEW);
          logoutReviewTrigger.current?.focus();
        }, 0);
      }
    } else if (logoutReview.status === "idle" && dialog.open) dialog.close();
  }, [logoutReview.status]);

  useEffect(() => {
    if (logoutReview.status === "checking" || logoutReview.status === "review") logoutReviewCancel.current?.focus();
  }, [logoutReview.status, logoutReview.snapshot]);

  // Derive a newly active module during navigation without an effect-driven flash.
  // This never changes the server-filtered navigation or grants access to a page.
  if (groupRoute !== pathname) {
    setGroupRoute(pathname);
    if (activeGroup) setOpenGroups((current) => new Set([...current, activeGroup.id]));
  }

  function toggleGroup(id: string) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const closeMenu = useCallback(({ returnFocus = true }: { returnFocus?: boolean } = {}) => {
    setMenuOpen(false);
    if (returnFocus) {
      requestAnimationFrame(() => (menuOpener.current ?? menuTrigger.current)?.focus());
    }
  }, []);

  function openMenu(trigger: HTMLButtonElement) {
    menuOpener.current = trigger;
    setMenuOpen(true);
  }

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setCompactNavigation(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!menuOpen || !compactNavigation) return;
    menuClose.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [closeMenu, compactNavigation, menuOpen]);

  useEffect(() => {
    if (!menuOpen || !compactNavigation) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [compactNavigation, menuOpen]);

  async function performLogout(clearCache: () => Promise<boolean>, afterConfirmedClear = false) {
    const visible = shellMounted.current;
    if (!visible && !afterConfirmedClear) return;
    if (logoutRunning.current) return;
    logoutRunning.current = true;
    logoutReviewRunning.current = false;
    logoutReviewClearRunning.current = false;
    logoutReviewSequence.current += 1;
    logoutReviewAbort.current?.abort();
    logoutReviewAbort.current = null;
    // Also clear tab-local search/selection when an already-confirmed logout
    // finishes after this shell has unmounted.
    document.dispatchEvent(new Event("daycare:session-ending"));
    if (visible) {
      setDailyNavigation(null);
      logoutReviewDialog.current?.close();
      setLogoutReview(IDLE_LOGOUT_REVIEW);
      // Remove the entire patient/employee shell immediately, before network or
      // IndexedDB work. A failed cleanup never restores the old sensitive view.
      setMenuOpen(false); setLogoutState("working"); setLogoutResult(null);
    }
    const result = await runLogoutTasks({
      clearCache,
      clearBranch: async () => {
        const response = await fetchWithTimeout("/api/context/branch", { method: "DELETE" }, 10_000);
        if (!response.ok) return false;
        const receipt = await response.json();
        return receipt?.status === "ok" && receipt?.data?.cleared === true;
      },
      signOut: async () => {
        const supabase = createBrowserSupabaseClient();
        if (!supabase) return false;
        const response = await supabase.auth.signOut({ scope: "local" });
        return !response.error;
      },
    });
    logoutRunning.current = false;
    if (!shellMounted.current) return;
    if (result.cacheCleared && result.branchCleared && result.signedOut) {
      router.replace("/login"); router.refresh();
    } else { setLogoutResult(result); setLogoutState("attention"); }
  }

  function cancelLogoutReview() {
    if (logoutReviewClearRunning.current) return;
    logoutReviewSequence.current += 1;
    logoutReviewRunning.current = false;
    logoutReviewAbort.current?.abort();
    logoutReviewAbort.current = null;
    logoutClearResult.current = null;
    setLogoutReview(IDLE_LOGOUT_REVIEW);
    logoutReviewDialog.current?.close();
    const trigger = logoutReviewTrigger.current;
    window.setTimeout(() => { if (trigger?.isConnected) trigger.focus(); }, 0);
  }

  async function inspectForLogout(changed = false) {
    const sequence = ++logoutReviewSequence.current;
    setLogoutReview({ status: "checking", snapshot: null, unknown: false, changed });
    const result = await settledWithin(inspectOfflineDraftsForLogout(logoutReviewAbort.current?.signal), 5_000);
    if (sequence !== logoutReviewSequence.current || !logoutReviewRunning.current || !shellMounted.current) return;
    if (!result.ok) {
      setLogoutReview({ status: "review", snapshot: null, unknown: true, changed });
      return;
    }
    if (result.value.count > 0 || changed) {
      setLogoutReview({ status: "review", snapshot: result.value, unknown: false, changed });
      return;
    }
    await clearForLogout(result.value);
  }

  async function clearForLogout(snapshot: OfflineLogoutSnapshot | null) {
    if (!logoutReviewRunning.current || logoutReviewClearRunning.current) return;
    if (hasCoreDraftBlocked() || hasScopeChangePending() || hasPendingOperations() || hasViewTransition()) { cancelLogoutReview(); return; }
    logoutReviewClearRunning.current = true;
    const sequence = ++logoutReviewSequence.current;
    setLogoutReview((current) => ({ ...current, status: "clearing" }));
    const clearAttempt: Promise<void | "cleared" | "changed" | "blocked"> = snapshot
      ? clearOfflineDraftsIfUnchanged(snapshot, logoutReviewAbort.current?.signal,
        () => !hasCoreDraftBlocked() && !hasScopeChangePending() && !hasPendingOperations() && !hasViewTransition())
      : clearOfflineDrafts(logoutReviewAbort.current?.signal);
    logoutClearResult.current = clearAttempt.then((value) => value === undefined || value === "cleared", () => false);
    const result = await settledWithin(clearAttempt, 10_000);
    if (sequence !== logoutReviewSequence.current || !logoutReviewRunning.current || !shellMounted.current) {
      logoutReviewClearRunning.current = false;
      // Once the person has entered the clear phase, an unmounted shell must
      // still revoke the session. A failed/aborted clear remains unconfirmed.
      if (!shellMounted.current && !(result.ok && (result.value === "changed" || result.value === "blocked"))) {
        void performLogout(async () => result.ok && (result.value === undefined || result.value === "cleared"), true);
      } else if (result.ok && (result.value === undefined || result.value === "cleared")) {
        // showModal failure can cancel the visible review after commit.
        void performLogout(async () => true, true);
      }
      return;
    }
    if (result.ok && result.value === "changed") {
      // The checked clear did not rotate the generation or delete anything.
      // The person must review the newest inventory before a new attempt.
      logoutReviewClearRunning.current = false;
      logoutClearResult.current = null;
      await inspectForLogout(true);
      return;
    }
    if (result.ok && result.value === "blocked") {
      logoutReviewClearRunning.current = false;
      cancelLogoutReview();
      return;
    }
    void performLogout(async () => result.ok && (result.value === undefined || result.value === "cleared"));
  }

  function beginLogoutReview(trigger: HTMLElement) {
    if (logoutRunning.current || logoutReviewRunning.current || hasScopeChangePending() || hasPendingOperations() || hasViewTransition()) return;
    if (process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true") {
      document.dispatchEvent(new Event("daycare:session-ending"));
      router.replace("/login"); router.refresh();
      return;
    }
    logoutReviewRunning.current = true;
    logoutReviewClearRunning.current = false;
    logoutClearResult.current = null;
    logoutReviewAbort.current = new AbortController();
    logoutReviewTrigger.current = trigger;
    void inspectForLogout();
  }

  function requestLogout(trigger: HTMLElement) {
    if (logoutRunning.current || logoutReviewRunning.current || hasScopeChangePending() || hasPendingOperations() || hasViewTransition()) return;
    requestCoreDraftLeave(() => {
      // A lease can be acquired while the dirty-draft dialog is open.
      if (hasScopeChangePending() || hasPendingOperations() || hasViewTransition()) return;
      beginLogoutReview(trigger);
    }, trigger);
  }

  function refreshCurrentPage() {
    if (hasCoreDraftPending() || hasScopeChangePending() || hasPendingOperations()) return;
    const release = tryAcquireViewTransition();
    if (!release) return;
    if (hasCoreDraftPending() || hasScopeChangePending()) { release(); return; }
    refreshLease.current = release;
    setRefreshEpoch((epoch) => epoch + 1);
    try {
      startRefreshTransition(() => router.refresh());
    } catch {
      release();
      refreshLease.current = null;
    }
  }

  if (logoutState !== "idle") return <main className="main-stage" id="main-content" tabIndex={-1}>
    <section className="empty-card" role={logoutState === "working" ? "status" : "alert"}>
      <h1>{logoutState === "working" ? "正在安全登出" : "登出尚有事項需要確認"}</h1>
      <p>本分頁已停止顯示個案與員工資料。</p>
      {logoutState === "working" ? <p>正在清理裝置資料並結束登入；請稍候。</p> : <>
        {!logoutResult?.cacheCleared && <p>裝置資料尚未確認清除。請先關閉其他日照系統分頁，再檢查原清理結果；系統不會重複刪除。若原清理程序已失敗，請在瀏覽器設定中清除此網站的資料。完成前請勿將裝置交給他人或重新登入。</p>}
        {!logoutResult?.signedOut && <p>尚未確認登入已結束，請保持此畫面並重試登出。</p>}
        {!logoutResult?.branchCleared && <p>尚未確認作業分支狀態已清除，請一併重試。</p>}
        <button className="button button--primary" type="button" onClick={() => { void performLogout(() => logoutClearResult.current ?? Promise.resolve(false)); }}>檢查清理狀態並重試登出</button>
      </>}
    </section>
  </main>;

  return (
    <DailyNavigationRegistrationContext.Provider value={registerDailyNavigation}>
    <div className="app-shell">
      <button
        aria-label="關閉選單"
        className="sidebar-backdrop"
        data-open={menuOpen}
        onClick={() => closeMenu()}
        type="button"
      />
      <aside aria-label="主要功能" aria-modal={compactNavigation && menuOpen ? true : undefined} role={compactNavigation && menuOpen ? "dialog" : undefined} className="sidebar" data-open={menuOpen} inert={compactNavigation && !menuOpen ? true : undefined} ref={sidebar}>
        <div className="sidebar__header">
          <NavigationLink className="brand-lockup" fullDocument={sensitiveDocument}
            href="/app/staff/workspace/dashboard" loadingLabel="工作儀表板">
            <span className="brand-mark" aria-hidden="true"><Image src="/suiyue-logo-transparent.png" alt="" width={58} height={58} unoptimized /></span>
            <span><strong>歲悅長照集團</strong><small>DAYCARE OS V4</small></span>
          </NavigationLink>
          <button className="icon-button mobile-menu-button" aria-label="關閉功能選單" onClick={() => closeMenu()} ref={menuClose} type="button">
            <X />
          </button>
        </div>
        <div className="sidebar__branch">
          <BranchSwitcher compact currentBranchId={context.branchId} currentBranchName={context.branchName} organizationName={context.organizationName}
            readOnly={process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true"} />
        </div>
        <nav className="sidebar__nav">
          {navigation.filter((group) => group.id === "workspace").map((group) => {
            const expanded = openGroups.has(group.id);
            return <section className="nav-group" key={group.id}>
              <button className="nav-group__label" aria-expanded={expanded} onClick={() => toggleGroup(group.id)} type="button">
                <span>{group.title}</span><ChevronDown aria-hidden="true" />
              </button>
              {expanded ? <div className="nav-group__items">{group.pages.map((page) => {
                const href = `/app/${page.slug}`;
                const Icon = iconForPage(page);
                return <NavigationLink aria-current={pathname === href ? "page" : undefined} className="nav-link" fullDocument={sensitiveDocument} href={href} key={page.slug} loadingLabel={page.title} onClick={() => closeMenu({ returnFocus: false })}>
                  <span className="nav-link__icon"><Icon aria-hidden="true" /></span><span>{page.title}</span>
                </NavigationLink>;
              })}</div> : null}
            </section>;
          })}
          {showClientIntake ? <section className="nav-group">
            <div className="nav-group__label nav-group__label--static">個案管理</div>
            <div className="nav-group__items"><NavigationLink aria-current={pathname === "/app/client-intake" ? "page" : undefined} className="nav-link" fullDocument={sensitiveDocument} href="/app/client-intake" prefetch={false} loadingLabel="個案匯入與收案" onClick={() => closeMenu({ returnFocus: false })}><span className="nav-link__icon"><UsersRound aria-hidden="true" /></span><span>個案匯入與收案</span></NavigationLink></div>
          </section> : null}
          {showStoreOverview ? <section className="nav-group">
            <div className="nav-group__label nav-group__label--static">主管檢視</div>
            <div className="nav-group__items"><NavigationLink aria-current={pathname === STORE_OVERVIEW_PATH ? "page" : undefined}
              className="nav-link" fullDocument={sensitiveDocument} href={STORE_OVERVIEW_PATH} prefetch={false} loadingLabel={STORE_OVERVIEW_TITLE}
              onClick={() => closeMenu({ returnFocus: false })}>
              <span className="nav-link__icon"><Building2 aria-hidden="true" /></span><span>{STORE_OVERVIEW_TITLE}</span>
            </NavigationLink></div>
          </section> : null}
          {navigation.filter((group) => group.id !== "workspace").map((group) => {
            const expanded = openGroups.has(group.id);
            return <section className="nav-group" key={group.id}>
              <button className="nav-group__label" aria-expanded={expanded} onClick={() => toggleGroup(group.id)} type="button">
                <span>{group.title}</span><ChevronDown aria-hidden="true" />
              </button>
              {expanded ? <div className="nav-group__items">
                {group.id === "assessments" && canViewAd8Candidate(context) ? <NavigationLink
                  aria-current={pathname === AD8_CANDIDATE_PATH ? "page" : undefined}
                  className="nav-link" fullDocument={sensitiveDocument}
                  href={AD8_CANDIDATE_PATH} loadingLabel={AD8_CANDIDATE_TITLE}
                  onClick={() => closeMenu({ returnFocus: false })} prefetch={false}>
                  <span className="nav-link__icon"><BrainCircuit aria-hidden="true" /></span><span>{AD8_CANDIDATE_TITLE}</span>
                </NavigationLink> : null}
                {group.id === "assessments" && showAssessmentMatrixLink ? <NavigationLink
                  aria-current={pathname === ASSESSMENT_MATRIX_PATH ? "page" : undefined}
                  className="nav-link" fullDocument={sensitiveDocument}
                  href={ASSESSMENT_MATRIX_PATH} loadingLabel={ASSESSMENT_MATRIX_TITLE}
                  onClick={() => closeMenu({ returnFocus: false })} prefetch={false}>
                  <span className="nav-link__icon"><ClipboardList aria-hidden="true" /></span><span>{ASSESSMENT_MATRIX_TITLE}</span>
                </NavigationLink> : null}
                {group.pages.map((page) => {
                const href = `/app/${page.slug}`;
                const Icon = iconForPage(page);
                return <NavigationLink aria-current={pathname === href ? "page" : undefined} className="nav-link" fullDocument={sensitiveDocument} href={href} key={page.slug} loadingLabel={page.title} onClick={() => closeMenu({ returnFocus: false })}>
                  <span className="nav-link__icon"><Icon aria-hidden="true" /></span><span>{page.title}</span>
                </NavigationLink>;
              })}</div> : null}
            </section>;
          })}
        </nav>
        <div className="sidebar__footer">
          {portalLeaveBlocked ? <span aria-disabled="true" className="button button--secondary sidebar__module-return" title={scopeChangeBlockedReason}>回模組頁</span>
            : <a className="button button--secondary sidebar__module-return" href={companyNavigation.portalUrl} onClick={guardPortalLeave} referrerPolicy="no-referrer" rel="noreferrer">回模組頁</a>}
          <div className="user-summary">
            <span className="avatar" aria-hidden="true">{context.displayName.slice(0, 1)}</span>
            <span className="user-summary__text"><strong>{context.displayName}</strong><small>{context.demo ? "合成展示" : primaryRoleLabel}</small></span>
            <button aria-label={process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true" ? "返回試用入口" : "登出"} className="icon-button" disabled={Boolean(logoutBlockedReason) || logoutReview.status !== "idle"} title={logoutBlockedReason} onClick={(event) => requestLogout(event.currentTarget)} type="button"><LogOut /></button>
          </div>
          {operationPending ? <small role="status">有一筆操作結果尚待確認，不能登出並清除裝置草稿；請先回原表單核對。</small> : viewPending ? <small role="status">系統正在更新或切換分支，請稍候再登出。</small> : null}
          {draftBlocked ? <small role="status">{draftHeld ? "寫入結果未確認；請回原表單核對，再登出。" : "資料儲存中，請稍候再登出。"}</small> : null}
          {draftPending && !draftBlocked ? <small role="status">有未儲存輸入，請先儲存或捨棄，才能重新整理或切換分支。</small> : null}
        </div>
      </aside>
      <div className="app-main" inert={compactNavigation && menuOpen ? true : undefined}>
        <header className="topbar">
          <div className="topbar__heading">
            <Image className="topbar__mobile-logo" src="/suiyue-logo-transparent.png" alt="" width={28} height={28} unoptimized />
            <span className="topbar__system">日照系統</span><span className="topbar__divider" aria-hidden="true">／</span>
            <span className="topbar__title">{pageTitle}</span>
          </div>
          {notificationPage ? <NavigationLink aria-label="開啟通知" className="icon-button notification-button" fullDocument={sensitiveDocument} href={`/app/${notificationPage.slug}`} loadingLabel={notificationPage.title}><Bell /></NavigationLink> : null}
          <div className="topbar__actions" role="group" aria-label="系統功能">
            <button className="button button--secondary" disabled={refreshPending || operationPending || viewPending || draftPending || Boolean(scopeChangeReason)} onClick={refreshCurrentPage} title={scopeChangeBlockedReason ?? (draftPending ? "有未儲存或結果未確認的輸入，請先儲存或核對再重新整理。" : operationPending ? "有一筆操作尚待確認，目前不能重新整理。" : viewPending && !refreshPending ? "系統正在更新，請稍候。" : undefined)} type="button">{refreshPending ? "更新中…" : "重新整理"}</button>
            {portalLeaveBlocked ? <span aria-disabled="true" className="button button--secondary" title={scopeChangeBlockedReason}>回模組頁</span>
              : <a className="button button--secondary" href={companyNavigation.portalUrl} onClick={guardPortalLeave} referrerPolicy="no-referrer" rel="noreferrer">回模組頁</a>}
            <button className="button button--primary" disabled={Boolean(logoutBlockedReason) || logoutReview.status !== "idle"} title={logoutBlockedReason} onClick={(event) => requestLogout(event.currentTarget)} type="button">登出</button>
          </div>
          <div className="topbar__context">
            <span className="topbar__date" role="status" aria-live="polite" title={`${context.displayName}・${primaryRoleLabel}・${runtimeLabel}`}>{context.displayName}・{primaryRoleLabel}・{runtimeLabel}</span>
            <span className="topbar__separator" aria-hidden="true">・</span>
            <TaipeiClock />
          </div>
          <button aria-label="開啟功能選單" aria-expanded={menuOpen} className="icon-button mobile-menu-button" onClick={(event) => openMenu(event.currentTarget)} ref={menuTrigger} type="button"><Menu /></button>
        </header>
        <main className="main-stage" id="main-content" tabIndex={-1}>
          {draftHeld ? <p className="callout" role="status">寫入結果未確認；請保留本頁並回原表單核對，暫時不能離開或登出。</p> : null}
          {scopeChangeBlockedReason && !draftHeld ? <p className="callout" role="status">{scopeChangeBlockedReason} 暫時不能切換分支、重新整理或登出。</p> : null}
          {children}
        </main>
      </div>
      <nav className="mobile-primary-nav" aria-label="常用功能" inert={compactNavigation && menuOpen ? true : undefined}>
        {mobilePages.map((page) => {
          const Icon = iconForPage(page);
          const label = mobileShortLabels[page.number] ?? page.title;
          const contextual = page.number === 3 && currentDailyNavigation;
          return <NavigationLink fullDocument={sensitiveDocument} href={contextual ? dailyWorkflowHref(3, contextual.serviceDate, contextual.clientId, contextual.shift) : `/app/${page.slug}`}
            aria-label={contextual ? "目前個案的生命徵象紀錄" : page.title} title={page.title}
            aria-current={pathname === `/app/${page.slug}` ? "page" : undefined} loadingLabel={page.title}
            prefetch={contextual || page.number > 3 ? false : undefined} key={page.number}><Icon aria-hidden="true" /><span>{label}</span></NavigationLink>;
        })}
        <button type="button" aria-label={mobileCurrentInMore ? "更多功能，目前頁面在選單中" : "更多功能"}
          aria-expanded={menuOpen} data-current={mobileCurrentInMore ? "true" : undefined}
          onClick={(event) => openMenu(event.currentTarget)}><Menu aria-hidden="true" /><span>更多</span></button>
      </nav>
      <dialog aria-describedby={`${logoutReviewTitleId}-description`} aria-labelledby={logoutReviewTitleId}
        className="core-dialog logout-review-dialog" onCancel={(event) => { event.preventDefault(); cancelLogoutReview(); }}
        onClose={() => { if (logoutReviewRunning.current && logoutReview.status !== "clearing") cancelLogoutReview(); }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const first = logoutReviewCancel.current;
          const last = logoutReview.status === "review" ? logoutReviewConfirm.current : first;
          if (!first || !last) return;
          const outside = !logoutReviewDialog.current?.contains(document.activeElement);
          if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
        }} ref={logoutReviewDialog} role="alertdialog">
        <div className="core-dialog__surface">
          <header className="drawer__header"><h2 id={logoutReviewTitleId}>{logoutReview.status === "checking" ? "檢查此裝置的本機紀錄" : logoutReview.status === "clearing" ? "正在安全登出" : logoutReview.unknown ? "無法確認此裝置的本機紀錄筆數" : logoutReview.snapshot?.count ? `此裝置仍有 ${logoutReview.snapshot.count} 筆本機紀錄` : "此裝置的本機紀錄剛有變動"}</h2></header>
          <div className="drawer__body core-dialog__body" id={`${logoutReviewTitleId}-description`}>
            {logoutReview.status === "checking" ? <p role="status">正在確認此裝置的本機紀錄，請稍候。</p>
              : logoutReview.status === "clearing" ? <p role="status">正在清理裝置資料，請勿關閉此頁。</p>
                : logoutReview.unknown ? <p>此裝置的本機紀錄目前無法讀取，筆數不明。若登出，系統會嘗試清除本機資料；清理失敗時會停留在安全提醒畫面。</p>
                  : <p>{logoutReview.snapshot?.count ? "此裝置的本機紀錄可能包含未送出或待核對內容。登出會永久清除裝置副本；未送出的內容不會在重新登入後自動補送。" : "另一個分頁剛更新了此裝置的本機紀錄；請再次確認後登出。"}</p>}
            {logoutReview.changed && logoutReview.status === "review" ? <p role="status">裝置紀錄已變動，請依目前筆數重新決定。</p> : null}
          </div>
          <footer className="drawer__footer">
            <button autoFocus className="button button--secondary" disabled={logoutReview.status === "clearing"} onClick={cancelLogoutReview} ref={logoutReviewCancel} type="button">返回核對／同步</button>
            {logoutReview.status === "review" ? <button className="button button--danger" disabled={Boolean(logoutBlockedReason)} onClick={() => { void clearForLogout(logoutReview.snapshot); }} ref={logoutReviewConfirm} type="button">{logoutReview.snapshot?.count === 0 ? "確認並登出" : "放棄裝置紀錄並登出"}</button> : null}
          </footer>
        </div>
      </dialog>
      <CoreDraftGuardHost />
    </div>
    </DailyNavigationRegistrationContext.Provider>
  );
}
