import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

import { MfaChallenge } from "@/components/auth/mfa-challenge";

export const metadata: Metadata = { title: "雙因素驗證" };

export default function MfaPage() {
  return (
    <main className="centered-page" id="main-content">
      <section className="auth-card" aria-labelledby="mfa-heading">
        <span className="empty-card__icon" aria-hidden="true">
          <ShieldCheck />
        </span>
        <p className="eyebrow">第二層保護</p>
        <h1 id="mfa-heading">輸入驗證器上的 6 位數字</h1>
        <p className="muted">為了保護個案資料，所有員工都必須完成雙因素驗證。</p>
        <MfaChallenge />
      </section>
    </main>
  );
}
