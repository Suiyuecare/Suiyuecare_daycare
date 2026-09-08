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
  Search,
  Settings2,
  ShieldCheck,
  Stethoscope,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import type { NavigationGroup } from "@/lib/catalog";
import { appBranding } from "@/lib/config/branding";
import type { TenantContext } from "@/lib/domain/types";
import { clearOfflineDrafts } from "@/lib/offline/draft-store";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { BranchSwitcher } from "./branch-switcher";

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
  children,
}: {
  context: TenantContext;
  navigation: readonly NavigationGroup[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [compactNavigation, setCompactNavigation] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuClose = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const active = navigation.find((group) =>
      group.pages.some((page) => pathname === `/app/${page.slug}`),
    );
    return new Set(active ? [active.id] : ["workspace", "daily-care"]);
  });

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
      requestAnimationFrame(() => menuTrigger.current?.focus());
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
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
      <aside aria-label="主要功能" className="sidebar" data-open={menuOpen} inert={compactNavigation && !menuOpen ? true : undefined} ref={sidebar}>
        <div className="sidebar__header">
          <Link className="brand-lockup" href="/app/staff/workspace/dashboard">
            <span className="brand-mark" aria-hidden="true"><HeartHandshake /></span>
            <span><strong>{appBranding.brand}</strong><small>日照管理</small></span>
          </Link>
          <button className="icon-button mobile-menu-button" aria-label="關閉功能選單" onClick={() => closeMenu()} ref={menuClose} type="button">
            <X />
          </button>
        </div>
        <BranchSwitcher currentBranchId={context.branchId} currentBranchName={context.branchName} organizationName={context.organizationName}
          readOnly={process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true"} />
        <nav className="sidebar__nav">
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
                        <Link aria-current={pathname === href ? "page" : undefined} className="nav-link" href={href} key={page.slug} onClick={() => closeMenu({ returnFocus: false })}>
                          <Icon aria-hidden="true" /><span>{page.title}</span>
                        </Link>
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
      <header className="topbar">
        <button aria-label="開啟功能選單" className="icon-button mobile-menu-button" onClick={() => setMenuOpen(true)} ref={menuTrigger} type="button"><Menu /></button>
        <label className="global-search">
          <Search aria-hidden="true" />
          <span className="sr-only">搜尋個案或功能</span>
          <input placeholder="搜尋個案、功能或工作…" type="search" />
          <kbd>⌘ K</kbd>
        </label>
        <span className="topbar__spacer" />
        <time className="topbar__date">{dateLabel}</time>
        <button aria-label="開啟通知" className="icon-button notification-button" type="button"><Bell /><span className="notification-dot" /></button>
      </header>
      <main className="main-stage" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
