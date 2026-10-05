"use client";

import { useSearchParams } from "next/navigation";

/** Deliberately never render arbitrary provider error text or account information. */
export function GoogleLoginFeedback() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  if (error === "portal_activation_required") return <p className="form-error" role="alert">
    日照首次使用：請按下方「使用 Google 帳號快速登入」完成一次啟用。若仍無法進入，請聯絡系統管理員。
  </p>;
  if (error === "portal_handoff_failed") return <p className="form-error" role="alert">
    公司入口驗證未完成。請從公司模組入口重新進入，或使用下方 Google 登入。
  </p>;
  if (error !== "google_sign_in_failed") return null;
  return <p className="form-error" role="alert">
    Google 登入未完成或此帳號未獲授權。請重新選擇公司帳號；若仍無法登入，請聯絡系統管理員。
  </p>;
}
