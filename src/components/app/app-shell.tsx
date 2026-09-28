"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import {
  Bell,
  BookOpenCheck,
  BriefcaseMedical,
  Building2,
  ChevronDown,
  ClipboardCheck,
  HeartHandshake,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircleMore,
  Settings2,
  ShieldCheck,
  Stethoscope,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import type { NavigationGroup } from "@/lib/catalog";
import { appBranding } from "@/lib/config/branding";
import { companyNavigation } from "@/lib/config/company-navigation";
import type { TenantContext } from "@/lib/domain/types";
import { STORE_OVERVIEW_PATH, STORE_OVERVIEW_TITLE } from "@/lib/store-overview/types";
import { clearOfflineDrafts } from "@/lib/offline/draft-store";
import { clearClaimValidationPendingOnLogout } from "@/lib/service-management/claim-validation-pending";
import { clearBodyAssessmentPendingOnLogout } from "@/lib/body-assessments/pending";
import { clearNursingAssessmentPendingOnLogout, nursingAssessmentAuthoritySignature, observeNursingAssessmentAuthority } from "@/lib/nursing-assessments/pending";
import { clearStaffAnnouncementPendingOnLogout, observeStaffAnnouncementAuthority, staffAnnouncementAuthoritySignature } from "@/lib/staff-announcements/pending";
import { clearReferralPendingOnLogout, observeReferralAuthority, referralAuthoritySignature } from "@/lib/referral-management/pending";
import { clearSocialWorkPendingOnLogout, observeSocialWorkAuthority, socialWorkAuthoritySignature } from "@/lib/social-work-records/pending";
import { clearPsychosocialAssessmentPendingOnLogout, observePsychosocialAssessmentAuthority, psychosocialAssessmentAuthoritySignature } from "@/lib/psychosocial-assessments/pending";
import { clearQuestionnaireViewOnLogout, getQuestionnaireViewState, observeQuestionnaireViewAuthority, questionnaireViewAuthority, useQuestionnaireViewState } from "@/lib/questionnaire-assessments/readiness-view";
import { clearQuestionnairePendingOnLogout, observeQuestionnairePendingAuthority } from "@/lib/questionnaire-assessments/pending";
import { clearCmsUploadOnLogout, cmsUploadAuthority, observeCmsUploadAuthority } from "@/lib/imports/upload-pending";
import { clearMedicationPendingOnLogout, medicationAuthoritySignature, observeMedicationAuthority } from "@/lib/medications/pending";
import { clearIntakeWritesOnLogout, intakeWriteAuthority, observeIntakeWriteAuthority } from "@/lib/client-intake/write-pending";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { runLogoutTasks, type LogoutResult } from "@/lib/auth/logout-tasks";
import { roleDisplayName } from "@/lib/domain/roles";
import { hasPendingOperations, tryAcquireViewTransition, usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { clearUnsavedChangesOnLogout, requestUnsavedExit } from "@/lib/navigation/unsaved-changes";
import { BranchSwitcher } from "./branch-switcher";
import { NavigationLink } from "./navigation-link";

const moduleIcons = {
  workspace: LayoutDashboard,
  "daily-care": HeartHandshake,
  assessments: ClipboardCheck,
  quality: ShieldCheck,
  "social-work": UsersRound,
  "professional-care": Stethoscope,
  communication: MessageCircleMore,
  "service-management": BriefcaseMedical,
  operations: Building2,
  governance: Settings2,
  "family-portal": BookOpenCheck,
} as const;

export function AppShell({
  context,
  navigation,
  showStoreOverview = false,
  children,
}: {
  context: TenantContext;
  navigation: readonly NavigationGroup[];
  showStoreOverview?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [compactNavigation, setCompactNavigation] = useState(false);
  const [logoutState, setLogoutState] = useState<"idle" | "working" | "attention">("idle");
  const [logoutResult, setLogoutResult] = useState<LogoutResult | null>(null);
  const [refreshPending, startRefreshTransition] = useTransition();
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [taipeiClock, setTaipeiClock] = useState("");
  const logoutRunning = useRef(false);
  const refreshLease = useRef<(() => void) | null>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuOpener = useRef<HTMLButtonElement | null>(null);
  const menuClose = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const operationPending = usePendingOperations();
  const viewPending = useViewTransitionPending();
  const availablePages = navigation.flatMap((group) => group.pages);
  const activePage = availablePages.find((page) => pathname === `/app/${page.slug}`);
  const activeGroup = navigation.find((group) => group.pages.some((page) => page.number === activePage?.number));
  const notificationPage = availablePages.find((page) => page.number === 67);
  const showClientIntake = context.demo || ["clients.read", "clients.demographics.read"].every((scope) => context.scopes.includes(scope));
  const mobilePages = [1, 2, 3].flatMap((number) => availablePages.filter((page) => page.number === number));
  const assessmentShortcut = availablePages.find((page) => page.moduleId === "assessments");
  const summaryShortcut = availablePages.find((page) => page.number === 54);
  const [groupRoute, setGroupRoute] = useState(pathname);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const active = navigation.find((group) =>
      group.pages.some((page) => pathname === `/app/${page.slug}`),
    );
    return new Set(active ? [active.id] : ["workspace", "daily-care"]);
  });
  const primaryRoleLabel = context.roles[0] ? roleDisplayName(context.roles[0]) : "已登入";
  const runtimeLabel = context.demo ? "合成資料" : "正式系統";
  const pageTitle = pathname === "/app/assessments" ? "評估工作入口" : showStoreOverview && pathname === STORE_OVERVIEW_PATH
    ? STORE_OVERVIEW_TITLE
    : activePage?.title ?? appBranding.applicationName;
  const announcementAuthority = staffAnnouncementAuthoritySignature(context);
  const nursingAuthority = nursingAssessmentAuthoritySignature(context);
  const referralAuthority = referralAuthoritySignature(context);
  const socialWorkAuthority = socialWorkAuthoritySignature(context);
  const psychosocialAuthority = psychosocialAssessmentAuthoritySignature(context);
  const questionnaireAuthority = questionnaireViewAuthority(context);
  const uploadAuthority = cmsUploadAuthority(context);
  const medicationAuthority = medicationAuthoritySignature(context);
  const intakeAuthority = intakeWriteAuthority(context);
  const questionnaireView = useQuestionnaireViewState();

  // Track authority outside the announcement route too: an unmounted editor
  // must not accept an old reply after permissions change and later return.
  useLayoutEffect(() => {
    observeStaffAnnouncementAuthority(announcementAuthority);
  }, [announcementAuthority]);
  useLayoutEffect(() => {
    observeNursingAssessmentAuthority(nursingAuthority);
  }, [nursingAuthority]);
  useLayoutEffect(() => {
    observeReferralAuthority(referralAuthority);
  }, [referralAuthority]);
  useLayoutEffect(() => {
    observeSocialWorkAuthority(socialWorkAuthority);
  }, [socialWorkAuthority]);
  useLayoutEffect(() => {
    observePsychosocialAssessmentAuthority(psychosocialAuthority);
  }, [psychosocialAuthority]);
  useLayoutEffect(() => {
    if (logoutRunning.current || logoutState !== "idle") return;
    observeQuestionnaireViewAuthority(questionnaireAuthority);
    observeQuestionnairePendingAuthority(questionnaireAuthority, getQuestionnaireViewState().epoch);
  }, [questionnaireAuthority, questionnaireView.epoch, logoutState]);
  useLayoutEffect(() => {
    if (!logoutRunning.current && logoutState === "idle") observeCmsUploadAuthority(uploadAuthority);
  }, [uploadAuthority, logoutState]);
  useLayoutEffect(() => {
    if (!logoutRunning.current && logoutState === "idle") observeMedicationAuthority(medicationAuthority);
  }, [medicationAuthority, logoutState]);
  useLayoutEffect(() => {
    if (!logoutRunning.current && logoutState === "idle") observeIntakeWriteAuthority(intakeAuthority);
  }, [intakeAuthority, logoutState]);

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
    const updateClock = () => setTaipeiClock(new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date()));
    updateClock();
    const interval = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(interval);
  }, []);

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

  async function logout() {
    if (logoutRunning.current) return;
    logoutRunning.current = true;
    // Privacy cleanup is unconditional; an unsent editor must never prevent
    // logout or run an old navigation callback after a different actor signs in.
    clearUnsavedChangesOnLogout();
    clearClaimValidationPendingOnLogout();
    clearBodyAssessmentPendingOnLogout();
    clearNursingAssessmentPendingOnLogout();
    clearStaffAnnouncementPendingOnLogout();
    clearReferralPendingOnLogout();
    clearSocialWorkPendingOnLogout();
    clearPsychosocialAssessmentPendingOnLogout();
    clearQuestionnairePendingOnLogout();
    clearQuestionnaireViewOnLogout();
    clearCmsUploadOnLogout();
    clearMedicationPendingOnLogout();
    clearIntakeWritesOnLogout();
    if (process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true") {
      router.replace("/login");
      router.refresh();
      return;
    }
    // Remove the entire patient/employee shell immediately, before network or
    // IndexedDB work. A failed cleanup never restores the old sensitive view.
    setMenuOpen(false); setLogoutState("working"); setLogoutResult(null);
    const result = await runLogoutTasks({
      clearCache: async () => { await clearOfflineDrafts(); return true; },
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
    if (result.cacheCleared && result.branchCleared && result.signedOut) {
      router.replace("/login"); router.refresh();
    } else { setLogoutResult(result); setLogoutState("attention"); }
  }

  function refreshCurrentPage() {
    if (hasPendingOperations()) return;
    if (requestUnsavedExit(refreshCurrentPage)) return;
    const release = tryAcquireViewTransition();
    if (!release) return;
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
        {!logoutResult?.cacheCleared && <p>裝置草稿尚未確認清除。請先重試；若仍失敗，請關閉其他日照系統分頁，並在瀏覽器設定中清除此網站的資料。完成前請勿將裝置交給他人或重新登入。</p>}
        {!logoutResult?.signedOut && <p>尚未確認登入已結束，請保持此畫面並重試登出。</p>}
        {!logoutResult?.branchCleared && <p>尚未確認作業分支狀態已清除，請一併重試。</p>}
        <button className="button button--primary" type="button" onClick={logout}>重試清理並登出</button>
      </>}
    </section>
  </main>;

  return (
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
          <Link className="brand-lockup" href="/app/staff/workspace/dashboard">
            <span className="brand-mark" aria-hidden="true"><Image src="/suiyue-logo-transparent.png" alt="" width={58} height={58} unoptimized /></span>
            <span><strong>歲悅長照集團</strong><small>DAYCARE OS V4</small></span>
          </Link>
          <button className="icon-button mobile-menu-button" aria-label="關閉功能選單" onClick={() => closeMenu()} ref={menuClose} type="button">
            <X />
          </button>
        </div>
        <div className="sidebar__branch">
          <BranchSwitcher key={JSON.stringify([context.organizationId, context.branchId, context.userId, context.demo,
            [...context.roles].sort(), [...context.scopes].sort()])} compact currentBranchId={context.branchId} currentBranchName={context.branchName} organizationName={context.organizationName}
            readOnly={process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true"} />
        </div>
        <nav className="sidebar__nav">
          {navigation.filter((group) => group.id === "workspace").map((group) => {
            const Icon = moduleIcons[group.id];
            const expanded = openGroups.has(group.id);
            return <section className="nav-group" key={group.id}>
              <button className="nav-group__label" aria-expanded={expanded} onClick={() => toggleGroup(group.id)} type="button">
                <span>{group.title}</span><ChevronDown aria-hidden="true" />
              </button>
              {expanded ? <div className="nav-group__items">{group.pages.map((page) => {
                const href = `/app/${page.slug}`;
                return <NavigationLink aria-current={pathname === href ? "page" : undefined} className="nav-link" href={href} key={page.slug} loadingLabel={page.title} onClick={() => closeMenu({ returnFocus: false })}>
                  <span className="nav-link__icon"><Icon aria-hidden="true" /></span><span>{page.title}</span>
                </NavigationLink>;
              })}</div> : null}
            </section>;
          })}
          {showClientIntake ? <section className="nav-group">
            <div className="nav-group__label nav-group__label--static">個案管理</div>
            <div className="nav-group__items"><NavigationLink aria-current={pathname === "/app/client-intake" ? "page" : undefined} className="nav-link" href="/app/client-intake" prefetch={false} loadingLabel="個案匯入與收案" onClick={() => closeMenu({ returnFocus: false })}><span className="nav-link__icon"><UsersRound aria-hidden="true" /></span><span>個案匯入與收案</span></NavigationLink></div>
          </section> : null}
          {showStoreOverview ? <section className="nav-group">
            <div className="nav-group__label nav-group__label--static">主管檢視</div>
            <div className="nav-group__items"><NavigationLink aria-current={pathname === STORE_OVERVIEW_PATH ? "page" : undefined}
              className="nav-link" href={STORE_OVERVIEW_PATH} prefetch={false} loadingLabel={STORE_OVERVIEW_TITLE}
              onClick={() => closeMenu({ returnFocus: false })}>
              <span className="nav-link__icon"><Building2 aria-hidden="true" /></span><span>{STORE_OVERVIEW_TITLE}</span>
            </NavigationLink></div>
          </section> : null}
          {assessmentShortcut || summaryShortcut ? <section className="nav-group" aria-label="常用工作">
            <div className="nav-group__label nav-group__label--static">常用工作</div>
            <div className="nav-group__items">
              {assessmentShortcut ? <NavigationLink aria-current={pathname === "/app/assessments" ? "page" : undefined} className="nav-link" href="/app/assessments" loadingLabel="評估工作入口" onClick={() => closeMenu({ returnFocus: false })}>
                <span className="nav-link__icon"><ClipboardCheck aria-hidden="true" /></span><span>評估量表</span>
              </NavigationLink> : null}
              {summaryShortcut ? <NavigationLink className="nav-link" href={`/app/${summaryShortcut.slug}`} loadingLabel={summaryShortcut.title} onClick={() => closeMenu({ returnFocus: false })}>
                <span className="nav-link__icon"><BookOpenCheck aria-hidden="true" /></span><span>每日彙整</span>
              </NavigationLink> : null}
            </div>
          </section> : null}
          {navigation.some((group) => group.id !== "workspace") ? <details key={pathname} className="task-details sidebar__all-features" open={Boolean(activeGroup && activeGroup.id !== "workspace")}>
            <summary>全部功能</summary>
          {navigation.filter((group) => group.id !== "workspace").map((group) => {
            const Icon = moduleIcons[group.id];
            const expanded = openGroups.has(group.id);
            return <section className="nav-group" key={group.id}>
              <button className="nav-group__label" aria-expanded={expanded} onClick={() => toggleGroup(group.id)} type="button">
                <span>{group.title}</span><ChevronDown aria-hidden="true" />
              </button>
              {expanded ? <div className="nav-group__items">{group.pages.map((page) => {
                const href = `/app/${page.slug}`;
                return <NavigationLink aria-current={pathname === href ? "page" : undefined} className="nav-link" href={href} key={page.slug} loadingLabel={page.title} onClick={() => closeMenu({ returnFocus: false })}>
                  <span className="nav-link__icon"><Icon aria-hidden="true" /></span><span>{page.title}</span>
                </NavigationLink>;
              })}</div> : null}
            </section>;
          })}
          </details> : null}
        </nav>
        <div className="sidebar__footer">
          <a className="button button--secondary sidebar__module-return" href={companyNavigation.portalUrl} referrerPolicy="no-referrer" rel="noreferrer">回模組頁</a>
          <div className="user-summary">
            <span className="avatar" aria-hidden="true">{context.displayName.slice(0, 1)}</span>
            <span className="user-summary__text"><strong>{context.displayName}</strong><small>{context.demo ? "合成展示" : primaryRoleLabel}</small></span>
            <button aria-label={process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true" ? "返回試用入口" : "登出"} className="icon-button" onClick={logout} type="button"><LogOut /></button>
          </div>
        </div>
      </aside>
      <div className="app-main" inert={compactNavigation && menuOpen ? true : undefined}>
        <header className="topbar">
          <div className="topbar__heading">
            <Image className="topbar__mobile-logo" src="/suiyue-logo-transparent.png" alt="" width={28} height={28} unoptimized />
            <span className="topbar__system">日照系統</span><span className="topbar__divider" aria-hidden="true">／</span>
            <span className="topbar__title">{pageTitle}</span>
          </div>
          {notificationPage ? <NavigationLink aria-label="開啟通知" className="icon-button notification-button" href={`/app/${notificationPage.slug}`} loadingLabel={notificationPage.title}><Bell /></NavigationLink> : null}
          <div className="topbar__actions" role="group" aria-label="系統功能">
            <button className="button button--secondary" disabled={refreshPending || operationPending || viewPending} onClick={refreshCurrentPage} title={operationPending ? "有一筆操作尚待確認，目前不能重新整理。" : viewPending && !refreshPending ? "系統正在更新，請稍候。" : undefined} type="button">{refreshPending ? "更新中…" : "重新整理"}</button>
            <a className="button button--secondary" href={companyNavigation.portalUrl} referrerPolicy="no-referrer" rel="noreferrer">回模組頁</a>
            <button className="button button--primary" onClick={logout} type="button">登出</button>
          </div>
          <div className="topbar__context">
            <span className="topbar__date" role="status" aria-live="polite" title={`${context.displayName}・${primaryRoleLabel}・${runtimeLabel}`}>{context.displayName}・{primaryRoleLabel}・{runtimeLabel}</span>
            <span className="topbar__separator" aria-hidden="true">・</span>
            <time className="topbar__clock" dateTime={taipeiClock ? `${taipeiClock}+08:00` : undefined} aria-label={taipeiClock ? `台北時間 ${taipeiClock}` : "台北時間載入中"}>{taipeiClock || "--:--:--"}</time>
          </div>
          <button aria-label="開啟功能選單" aria-expanded={menuOpen} className="icon-button mobile-menu-button" onClick={(event) => openMenu(event.currentTarget)} ref={menuTrigger} type="button"><Menu /></button>
        </header>
        <main className="main-stage" id="main-content" tabIndex={-1}>{children}</main>
      </div>
      <nav className="mobile-primary-nav" aria-label="常用功能" inert={compactNavigation && menuOpen ? true : undefined}>
        {mobilePages.map((page) => {
          const Icon = moduleIcons[page.moduleId];
          const label = page.number === 1 ? "今日" : page.number === 2 ? "個案" : "量測";
          return <NavigationLink href={`/app/${page.slug}`} aria-label={page.title} title={page.title} aria-current={pathname === `/app/${page.slug}` ? "page" : undefined} loadingLabel={page.title} key={page.number}><Icon aria-hidden="true" /><span>{label}</span></NavigationLink>;
        })}
        <button type="button" aria-label="更多功能" aria-expanded={menuOpen} onClick={(event) => openMenu(event.currentTarget)}><Menu aria-hidden="true" /><span>更多</span></button>
      </nav>
    </div>
  );
}
