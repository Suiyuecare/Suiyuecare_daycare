import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { MfaChallenge } from "@/components/auth/mfa-challenge";
import { isDemoMode, isSyntheticPreviewMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "雙因素驗證" };

export default async function MfaPage() {
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
  return (
    <main className="centered-page" id="main-content">
      <section className="auth-card" aria-labelledby="mfa-heading">
        <span className="empty-card__icon" aria-hidden="true">
          <ShieldCheck />
        </span>
        <p className="eyebrow">第二層保護</p>
        <h1 id="mfa-heading">輸入驗證器上的 6 位數字</h1>
        <p className="muted">Google 身分確認後，執行長仍須完成雙因素驗證，才能進入系統。</p>
        <MfaChallenge />
      </section>
    </main>
  );
}
