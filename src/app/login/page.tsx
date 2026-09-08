import type { Metadata } from "next";
import Link from "next/link";
import { HeartHandshake, LockKeyhole, ShieldCheck } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { appBranding } from "@/lib/config/branding";
import { isDemoMode, isSyntheticPreviewMode } from "@/lib/env";
import { SyntheticPreviewBanner } from "@/components/preview/synthetic-preview-banner";

export const metadata: Metadata = {
  title: "登入",
};

export default function LoginPage() {
  if (isSyntheticPreviewMode()) {
    return <main id="main-content" style={{ maxWidth: 680, margin: "8vh auto", padding: 24 }}>
      <p className="eyebrow">{appBranding.applicationName}</p>
      <h1>合成資料線上試用</h1>
      <SyntheticPreviewBanner />
      <p>選擇入口檢視既有示範頁面；此試用不提供正式登入、儲存、簽署或申報。</p>
      <nav aria-label="合成資料試用入口" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 24 }}>
        <Link className="button button--primary" href="/app/dashboard">員工檢視入口</Link>
        <Link className="button button--secondary" href="/family/home">家屬檢視入口</Link>
      </nav>
    </main>;
  }
  return (
    <main className="login-shell" id="main-content">
      <section className="login-intro" aria-labelledby="login-heading">
        <div className="brand-lockup brand-lockup--light">
          <span className="brand-mark" aria-hidden="true">
            <HeartHandshake />
          </span>
          <span>
            <strong>{appBranding.brand}</strong>
            <small>日照管理</small>
          </span>
        </div>
        <div className="login-intro__copy">
          <p className="eyebrow eyebrow--light">把重要的照顧工作放在一起</p>
          <h1 id="login-heading">每一筆紀錄，都接得上下一個照顧行動。</h1>
          <p>
            日常照顧、評估、接送、專業服務與家屬溝通，使用同一份個案脈絡與可追溯版本。
          </p>
        </div>
        <ul className="trust-list" aria-label="系統保護措施">
          <li>
            <ShieldCheck aria-hidden="true" />
            分支與個案範圍隔離
          </li>
          <li>
            <LockKeyhole aria-hidden="true" />
            員工雙因素驗證
          </li>
        </ul>
      </section>
      <section className="login-panel" aria-label="帳號登入">
        <div className="login-panel__inner">
          <p className="eyebrow">安全登入</p>
          <h2>歡迎回來</h2>
          <p role="note" aria-label="版本使用限制">
            建置驗證版本：尚未完成正式營運驗收，請勿輸入或上傳真實個案資料。
          </p>
          <p className="muted">請使用機構核發的帳號。家屬請切換至家屬入口。</p>
          <LoginForm demoMode={isDemoMode()} />
          <p className="login-help">
            無法登入或遺失驗證器時，請聯絡機構系統管理員。系統不會透過訊息向您索取密碼。
          </p>
        </div>
      </section>
    </main>
  );
}
