"use client";

import { Bell, CalendarDays, HeartHandshake, Home, LogOut, MessageCircleMore, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { appBranding } from "@/lib/config/branding";
import type { TenantContext } from "@/lib/domain/types";
import { clearOfflineDrafts } from "@/lib/offline/draft-store";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

const items = [
  { href: "/family/home", label: "首頁", icon: Home },
  { href: "/family/communication", label: "溝通", icon: MessageCircleMore },
  { href: "/family/care-summary", label: "照顧", icon: HeartHandshake },
  { href: "/family/schedule", label: "行程", icon: CalendarDays },
  { href: "/family/notifications-settings", label: "設定", icon: Settings2 },
];

export function FamilyShell({ context, children }: { context: TenantContext; children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

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
    router.replace("/login?audience=family");
    router.refresh();
  }

  return (
    <div className="family-shell">
      <header className="family-header">
        <Link className="brand-lockup" href="/family/home"><span className="brand-mark"><HeartHandshake /></span><span><strong>{appBranding.brand}</strong><small>家屬安心服務</small></span></Link>
        <div className="page-heading__actions"><button aria-label="查看通知" className="icon-button" type="button"><Bell /></button><button aria-label={`登出 ${context.displayName}`} className="icon-button" onClick={logout} type="button"><LogOut /></button></div>
      </header>
      <main className="family-main" id="main-content">{children}</main>
      <nav aria-label="家屬服務" className="family-bottom-nav">
        {items.map(({ href, label, icon: Icon }) => {
          const selectedClient = searchParams.get("client");
          const selectedHref = selectedClient ? `${href}?client=${encodeURIComponent(selectedClient)}` : href;
          return <Link aria-current={pathname === href ? "page" : undefined} href={selectedHref} key={href}><Icon /><span>{label}</span></Link>;
        })}
      </nav>
    </div>
  );
}
