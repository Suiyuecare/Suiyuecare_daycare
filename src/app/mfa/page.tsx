import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { MfaChallenge } from "@/components/auth/mfa-challenge";
import { isDemoMode, isSyntheticPreviewMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "重要操作驗證" };

export default async function MfaPage({ searchParams }: {
  searchParams: Promise<{ purpose?: string | string[] }>;
}) {
  if (!isDemoMode() && !isSyntheticPreviewMode()) {
    let allowed = false;
    try {
      const client = await createServerSupabaseClient();
      if (client) {
        const { data, error } = await client.auth.getUser();
        if (!error && data.user && !data.user.is_anonymous) {
          const eligibility = await client.rpc("can_begin_staff_mfa");
          allowed = !eligibility.error && eligibility.data === true;
        }
      }
    } catch {
      // No session/provider details are exposed by this public entry point.
    }
    if (!allowed) redirect("/login?error=google_sign_in_failed");
  }
  // A legacy bookmark or login return must never mount the component that can
  // enroll an authenticator. Step-up is an explicit, authenticated action only.
  const { purpose } = await searchParams;
  if (purpose !== "sensitive-action") redirect("/app/dashboard");

  return (
    <main className="centered-page" id="main-content">
      <section className="auth-card" aria-labelledby="mfa-heading">
        <span className="empty-card__icon" aria-hidden="true">
          <ShieldCheck />
        </span>
        <p className="eyebrow">重要操作的額外保護</p>
        <h1 id="mfa-heading">輸入驗證器上的 6 位數字</h1>
        <p className="muted">Google 登入即可進入工作台。簽署、匯出、權限調整與敏感資料查閱等重要操作，才需在此完成額外驗證；這不是登入必經步驟。</p>
        <MfaChallenge />
        <Link className="button button--secondary" href="/app/dashboard">返回工作台</Link>
      </section>
    </main>
  );
}
