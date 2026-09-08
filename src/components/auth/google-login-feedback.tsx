"use client";

import { useSearchParams } from "next/navigation";

/** Deliberately never render arbitrary provider error text or account information. */
export function GoogleLoginFeedback() {
  const searchParams = useSearchParams();
  if (searchParams.get("error") !== "google_sign_in_failed") return null;
  return <p className="form-error" role="alert">
    Google 登入未完成或此帳號未獲授權。請重新選擇公司帳號；若仍無法登入，請聯絡系統管理員。
  </p>;
}
