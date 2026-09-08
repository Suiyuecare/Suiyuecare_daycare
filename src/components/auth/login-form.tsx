"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function LoginForm({ demoMode }: { demoMode: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const audience = searchParams.get("audience") === "family" ? "family" : "staff";
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [familyPhone, setFamilyPhone] = useState("");
  const [familyOtpSent, setFamilyOtpSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const supabase = createBrowserSupabaseClient();

    if (!supabase) {
      setError("正式登入服務尚未設定。請由管理員完成 Supabase 環境設定。");
      setPending(false);
      return;
    }

    if (audience === "family") {
      const phone = String(formData.get("phone") ?? familyPhone).replace(/[\s()-]/gu, "");
      if (!/^\+8869\d{8}$/u.test(phone)) {
        setError("請輸入 +886 開頭的台灣手機號碼，例如 +886912345678。");
        setPending(false);
        return;
      }

      if (!familyOtpSent) {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          phone,
          options: { shouldCreateUser: false },
        });
        if (otpError) {
          setError("無法傳送一次性驗證碼，請確認帳號已完成家屬授權。");
          setPending(false);
          return;
        }
        setFamilyPhone(phone);
        setFamilyOtpSent(true);
        setPending(false);
        return;
      }

      const token = String(formData.get("otp") ?? "").trim();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: "sms",
      });
      if (verifyError) {
        setError("驗證碼不正確或已逾期，請重新取得後再試。");
        setPending(false);
        return;
      }
      router.replace("/family/home");
      router.refresh();
      return;
    }

    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError("帳號、密碼或帳戶狀態不正確，請重新確認。");
      setPending(false);
      return;
    }

    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") {
      router.replace(`/mfa?audience=${audience}`);
      return;
    }

    router.replace("/app/dashboard");
    router.refresh();
  }

  function enterDemo() {
    router.replace(audience === "family" ? "/family/home" : "/app/dashboard");
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="segmented-control" aria-label="入口類型">
        <a aria-current={audience === "staff" ? "page" : undefined} href="/login?audience=staff">
          員工入口
        </a>
        <a aria-current={audience === "family" ? "page" : undefined} href="/login?audience=family">
          家屬入口
        </a>
      </div>
      {audience === "family" ? (
        <>
          <label className="field">
            <span>已授權的手機號碼</span>
            <input
              autoComplete="tel"
              defaultValue={familyPhone}
              disabled={familyOtpSent}
              inputMode="tel"
              name="phone"
              placeholder="+886912345678"
              required
              type="tel"
            />
          </label>
          {familyOtpSent ? (
            <label className="field">
              <span>一次性驗證碼</span>
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                name="otp"
                pattern="[0-9]{6}"
                placeholder="6 位數驗證碼"
                required
                type="text"
              />
            </label>
          ) : null}
        </>
      ) : (
        <><label className="field">
          <span>工作電子郵件</span>
          <input
            autoComplete="username"
            inputMode="email"
            name="email"
            placeholder="name@organization.tw"
            required
            type="email"
          />
        </label><label className="field">
          <span>密碼</span>
          <span className="password-field">
            <input
              autoComplete="current-password"
              minLength={8}
              name="password"
              required
              type={showPassword ? "text" : "password"}
            />
            <button
              aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
              onClick={() => setShowPassword((value) => !value)}
              type="button"
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </button>
          </span>
        </label></>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button button--primary button--wide" disabled={pending} type="submit">
        {pending ? "正在驗證…" : audience === "family" && !familyOtpSent ? "傳送驗證碼" : "繼續"}
        {!pending ? <ArrowRight aria-hidden="true" /> : null}
      </button>
      {demoMode ? (
        <button className="button button--secondary button--wide" onClick={enterDemo} type="button">
          使用去識別化展示資料
        </button>
      ) : null}
    </form>
  );
}
