"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { parseReauthChallengeEnvelope, parseReauthCompletionEnvelope } from "@/lib/auth/reauth-client";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type Challenge = { factorId: string; challengeId: string };
type Enrollment = { factorId: string; qrCode: string; secret: string };
export function MfaChallenge() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState<string | null>(
    configured ? null : "驗證服務尚未設定。",
  );
  const [pending, setPending] = useState(configured);

  useEffect(() => {
    let active = true;
    if (!configured) return;

    void (async () => {
      const supabase = createBrowserSupabaseClient();
      if (!supabase) {
        if (active) {
          setError("驗證服務無法初始化，請重新登入。");
          setPending(false);
        }
        return;
      }
      const { data: factors, error: factorsError } =
        await supabase.auth.mfa.listFactors();
      const factor = factors?.totp.find((item) => item.status === "verified");
      if (factorsError) {
        if (active) {
          setError("無法讀取雙因素驗證設定，請重新登入。");
          setPending(false);
        }
        return;
      }

      if (!factor) {
        const incompleteFactor = factors?.totp.find((item) => item.status !== "verified");
        if (incompleteFactor) {
          await supabase.auth.mfa.unenroll({ factorId: incompleteFactor.id });
        }
        const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "日照管理系統",
        });
        if (active) {
          if (enrollError || !enrolled) {
            setError("無法開始驗證器設定，請聯絡系統管理員。");
          } else {
            setEnrollment({
              factorId: enrolled.id,
              qrCode: enrolled.totp.qr_code,
              secret: enrolled.totp.secret,
            });
          }
          setPending(false);
        }
        return;
      }

      const { data, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: factor.id,
      });
      if (active) {
        if (challengeError || !data) {
          setError("無法建立驗證挑戰，請重新登入。");
        } else {
          setChallenge({ factorId: factor.id, challengeId: data.id });
        }
        setPending(false);
      }
    })().catch(() => {
      if (active) {
        setError("驗證服務暫時無法回應，請重新登入後再試。");
        setPending(false);
      }
    });

    return () => {
      active = false;
    };
  }, [configured]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge && !enrollment) return;
    setPending(true);
    setError(null);
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setError("驗證服務無法初始化，請重新登入。");
      setPending(false);
      return;
    }

    const issuedResponse = await fetchWithTimeout("/api/auth/reauth/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).catch((caught: unknown) => {
      setError(isClientFetchTimeoutError(caught)
        ? "建立一次性安全驗證逾時，請重新嘗試。"
        : "無法連線建立一次性安全驗證，請重新嘗試。");
      return null;
    });
    if (!issuedResponse) {
      setPending(false);
      return;
    }
    const rawIssued: unknown = await issuedResponse.json().catch(() => null);
    if (!issuedResponse.ok) {
      setError("無法建立一次性安全驗證，請重新登入後再試。");
      setPending(false);
      return;
    }
    let issued;
    try {
      issued = parseReauthChallengeEnvelope(rawIssued, issuedResponse.status);
    } catch {
      setError("安全驗證回覆不完整，請重新登入後再試。");
      setPending(false);
      return;
    }
    const reauthChallengeId = issued.data.challengeId;
    const reauthNonce = issued.data.nonce;

    const { error: verifyError } = enrollment
      ? await supabase.auth.mfa.challengeAndVerify({
          factorId: enrollment.factorId,
          code,
        })
      : await supabase.auth.mfa.verify({
          factorId: challenge!.factorId,
          challengeId: challenge!.challengeId,
          code,
        });

    if (verifyError) {
      setError("驗證碼不正確或已過期，請重新輸入。");
      setPending(false);
      return;
    }

    // Production records the fresh AAL2 event through a protected server API.
    const reauthResponse = await fetchWithTimeout("/api/auth/reauth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: reauthChallengeId,
        nonce: reauthNonce,
      }),
    }).catch((caught: unknown) => {
      setError(isClientFetchTimeoutError(caught)
        ? "雙因素驗證已完成，但建立高風險操作憑證逾時；請重新登入確認。"
        : "雙因素驗證已完成，但無法建立高風險操作憑證；請重新登入。");
      return null;
    });
    if (!reauthResponse) {
      setPending(false);
      return;
    }
    if (!reauthResponse.ok) {
      setError("雙因素驗證已完成，但無法建立高風險操作憑證；請重新登入。");
      setPending(false);
      return;
    }
    const rawCompletion: unknown = await reauthResponse.json().catch(() => null);
    try {
      parseReauthCompletionEnvelope(rawCompletion, reauthResponse.status);
    } catch {
      setError("雙因素驗證已完成，但操作憑證回覆不完整；請重新登入。");
      setPending(false);
      return;
    }
    const audience = searchParams.get("audience");
    router.replace(audience === "family" ? "/family/home" : "/app/dashboard");
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={verify}>
      {enrollment ? (
        <section className="mfa-enrollment" aria-labelledby="mfa-setup-heading">
          <h2 id="mfa-setup-heading">重要操作：設定驗證器</h2>
          <p className="muted">用驗證器 App 掃描 QR Code，再輸入顯示的 6 位數字。</p>
          <Image alt="雙因素驗證 QR Code" height={184} src={enrollment.qrCode} unoptimized width={184} />
          <details>
            <summary>無法掃描？顯示設定金鑰</summary>
            <code>{enrollment.secret}</code>
          </details>
        </section>
      ) : null}
      <label className="field">
        <span>驗證碼</span>
        <input
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          minLength={6}
          name="code"
          pattern="[0-9]{6}"
          placeholder="000000"
          required
        />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button--primary button--wide" disabled={pending || (!challenge && !enrollment)} type="submit">
        {pending ? "正在準備驗證…" : "完成驗證"}
      </button>
    </form>
  );
}
