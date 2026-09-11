"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import type { TenantContext } from "@/lib/domain/types";
import { STORE_OVERVIEW_PATH, STORE_OVERVIEW_TITLE } from "@/lib/store-overview/types";
import { clearOfflineDrafts } from "@/lib/offline/draft-store";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
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
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuOpener = useRef<HTMLButtonElement | null>(null);
  const menuClose = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const availablePages = navigation.flatMap((group) => group.pages);
  const activePage = availablePages.find((page) => pathname === `/app/${page.slug}`);
  const activeGroup = navigation.find((group) => group.pages.some((page) => page.number === activePage?.number));
  const notificationPage = availablePages.find((page) => page.number === 67);
  const shortcuts = [1, 2].flatMap((number) => availablePages.filter((page) => page.number === number));
  const mobilePages = [1, 2, 3].flatMap((number) => availablePages.filter((page) => page.number === number));
  const [groupRoute, setGroupRoute] = useState(pathname);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const active = navigation.find((group) =>
      group.pages.some((page) => pathname === `/app/${page.slug}`),
    );
    return new Set(active ? [active.id] : ["workspace", "daily-care"]);
  });

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
    if (process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true") {
      router.replace("/login");
      router.refresh();
      return;
    }
    await clearOfflineDrafts().catch(() => undefined);
    await fetchWithTimeout("/api/context/branch", { method: "DELETE" }, 10_000).catch(() => undefined);
    const supabase = createBrowserSupabaseClient();
    if (supabase) await supabase.auth.signOut({ scope: "local" });
    router.replace("/login");
    router.refresh();
  }

  const dateLabel = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());

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
            <span><strong>{appBranding.brand}</strong><small>日照管理</small></span>
          </Link>
          <button className="icon-button mobile-menu-button" aria-label="關閉功能選單" onClick={() => closeMenu()} ref={menuClose} type="button">
            <X />
          </button>
        </div>
        <BranchSwitcher currentBranchId={context.branchId} currentBranchName={context.branchName} organizationName={context.organizationName}
          readOnly={process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true"} />
        <nav className="sidebar__nav">
          {showStoreOverview && <NavigationLink aria-current={pathname === STORE_OVERVIEW_PATH ? "page" : undefined}
            className="nav-link" href={STORE_OVERVIEW_PATH} prefetch={false} loadingLabel={STORE_OVERVIEW_TITLE}
            onClick={() => closeMenu({ returnFocus: false })}>
            <span className="nav-link__icon"><Building2 aria-hidden="true" /></span><span>{STORE_OVERVIEW_TITLE}</span>
          </NavigationLink>}
          {navigation.map((group) => {
            const Icon = moduleIcons[group.id];
            const expanded = openGroups.has(group.id);
            return (
              <section className="nav-group" key={group.id}>
                <button className="nav-group__label" aria-expanded={expanded} onClick={() => toggleGroup(group.id)} type="button">
                  <span>{group.title}</span><ChevronDown aria-hidden="true" />
                </button>
                {expanded ? (
                  <div className="nav-group__items">
                    {group.pages.map((page) => {
                      const href = `/app/${page.slug}`;
                      return (
                        <NavigationLink aria-current={pathname === href ? "page" : undefined} className="nav-link" href={href} key={page.slug} loadingLabel={page.title} onClick={() => closeMenu({ returnFocus: false })}>
                          <span className="nav-link__icon"><Icon aria-hidden="true" /></span><span>{page.title}</span>
                        </NavigationLink>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </nav>
        <div className="sidebar__footer">
          <div className="user-summary">
            <span className="avatar" aria-hidden="true">{context.displayName.slice(0, 1)}</span>
            <span className="user-summary__text"><strong>{context.displayName}</strong><small>{context.demo ? "展示模式・分支主管" : "已安全登入"}</small></span>
            <button aria-label={process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true" ? "返回試用入口" : "登出"} className="icon-button" onClick={logout} type="button"><LogOut /></button>
          </div>
        </div>
      </aside>
      <div className="app-main" inert={compactNavigation && menuOpen ? true : undefined}>
        <header className="topbar">
          <div className="topbar__heading">
            <Image className="topbar__mobile-logo" src="/suiyue-logo-transparent.png" alt="" width={28} height={28} unoptimized />
            <span className="topbar__system">日照管理</span><span className="topbar__divider" aria-hidden="true">｜</span>
            <span className="topbar__title">{showStoreOverview && pathname === STORE_OVERVIEW_PATH ? STORE_OVERVIEW_TITLE : activePage?.title ?? appBranding.applicationName}</span>
          </div>
          {notificationPage ? <NavigationLink aria-label="開啟通知" className="icon-button notification-button" href={`/app/${notificationPage.slug}`} loadingLabel={notificationPage.title}><Bell /></NavigationLink> : null}
          <div className="topbar__actions">{shortcuts.map((page) => <NavigationLink className="button button--secondary" href={`/app/${page.slug}`} key={page.number} loadingLabel={page.title}>{page.number === 1 ? "今日工作" : page.title}</NavigationLink>)}</div>
          <time className="topbar__date">{dateLabel}</time>
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
