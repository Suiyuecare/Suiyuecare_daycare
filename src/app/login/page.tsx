import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";

import { GoogleLoginFeedback } from "@/components/auth/google-login-feedback";
import { appBranding } from "@/lib/config/branding";
import { companyNavigation } from "@/lib/config/company-navigation";
import { env, isDemoMode, isSyntheticPreviewMode } from "@/lib/env";
import { SyntheticPreviewBanner } from "@/components/preview/synthetic-preview-banner";
import styles from "./login-page.module.css";

export const metadata: Metadata = {
  title: "登入",
};

function CompanyBrand({ mobile = false }: { mobile?: boolean }) {
  return <div className={mobile ? styles.mobileBrand : styles.brand}>
    <span className={styles.brandLogo}>
      <Image src="/suiyue-logo-transparent.png" alt="歲悅長照形象標章" width={74} height={74} priority />
    </span>
    <span className={styles.brandName}>
      <strong>歲悅長照集團</strong>
      <small>SUIYUE CARE GROUP</small>
    </span>
  </div>;
}

const googleIcon = <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24">
  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
</svg>;

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
    <main className={styles.shell} id="main-content">
      <section className={styles.intro} aria-labelledby="login-heading">
        <div className={styles.introContent}>
          <CompanyBrand />
          <h1 className={styles.title} id="login-heading">日間照顧系統入口</h1>
          <ul className={styles.points}>
            <li>登入後直接進入日照工作台</li>
            <li>使用與 Finance 相同的公司 Google 帳號</li>
            <li>今日出勤、量測、照顧與交班集中處理</li>
            <li>日照職務與分支權限由機構個別核准</li>
          </ul>
          <div className={styles.versionNote}>
            <strong>工作台使用說明</strong>
            <ul>
              <li>從今天的工作開始，接續處理當日照顧紀錄。</li>
              <li>分支與個案範圍隔離，依核准職務提供功能。</li>
              <li>一般出勤、量測與照顧草稿不需另設驗證器。</li>
            </ul>
          </div>
          <a className={styles.portalIntro} href={companyNavigation.portalUrl} referrerPolicy="no-referrer">
            <span>公司模組入口</span><strong>返回</strong>
          </a>
        </div>
        <p className={styles.footer}>SUIYUE CARE · DAYCARE</p>
      </section>
      <section className={styles.loginArea} aria-label="帳號登入">
        <CompanyBrand mobile />
        <div className={styles.panel}>
          <h2 className={styles.welcome}>歡迎回來</h2>
          <p className={styles.subtitle}>請使用公司 Google Workspace 帳號登入日照</p>
          <div className={styles.accountGuide}>
            <strong>使用與 Finance 相同的公司帳號</strong>
            <p>請使用主管已核准的個人公司帳號。進入日照時會另外核對日照權限。</p>
          </div>
          <Suspense fallback={null}><GoogleLoginFeedback /></Suspense>
          <form action="/auth/google" method="post" aria-label="公司 Google 登入">
            <button className={styles.googleButton} type="submit"
              disabled={!env.GOOGLE_LOGIN_ENABLED || isDemoMode()} aria-describedby="google-login-readiness">
              {googleIcon} 使用 Google 帳號快速登入
            </button>
            <p className={styles.readiness} id="google-login-readiness" role="status">
              {env.GOOGLE_LOGIN_ENABLED && !isDemoMode()
                ? "請選擇公司 Google 帳號。系統會再次核對帳號授權，不接受自行註冊或切換角色。"
                : "Google 登入尚未完成設定，目前無法使用。請由系統管理員完成設定後再登入。"}
            </p>
          </form>
          <p className={styles.validationNotice} role="note" aria-label="版本使用限制">
            <strong>建置驗證版本</strong>
            尚未完成正式營運驗收，請勿輸入或上傳真實個案資料。
          </p>
          <a className={styles.portalLink} href={companyNavigation.portalUrl} referrerPolicy="no-referrer">回公司模組入口</a>
          <details className={styles.help}>
            <summary>登入協助與使用範圍</summary>
            <p>一般出勤、量測與照顧草稿不需另設驗證器。簽署、補登、匯出與權限調整等重要操作另有身分確認要求。家屬尚未開放登入。</p>
            <p>尚未核准的帳號不能自行註冊或共用他人身分。無法登入時，請聯絡機構系統管理員；系統不會透過訊息向您索取密碼。</p>
          </details>
        </div>
      </section>
    </main>
  );
}
