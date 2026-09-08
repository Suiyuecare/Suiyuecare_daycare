import "server-only";

import { NextResponse } from "next/server";

import { env, isDemoMode, isSyntheticPreviewMode } from "@/lib/env";

export const GOOGLE_FLOW_COOKIE = "__Host-daycare-google-flow";
export const GOOGLE_FLOW_TTL_SECONDS = 600;
export const GOOGLE_LOGIN_FAILURE = "/login?error=google_sign_in_failed";

export type GoogleLoginConfiguration = {
  appOrigin: string;
  supabaseOrigin: string;
  callbackUrl: string;
  secure: boolean;
  storageKey: string;
  flowCookieName: string;
};

function configuredOrigin(value: string | undefined, allowLocal: boolean) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(allowLocal && local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Never infer the trusted host from Host / X-Forwarded-Host or a return URL. */
export function googleLoginConfiguration(request: Request): GoogleLoginConfiguration | null {
  if (!env.GOOGLE_LOGIN_ENABLED || isDemoMode() || isSyntheticPreviewMode()) return null;
  const local = env.NODE_ENV !== "production";
  const appOrigin = configuredOrigin(env.NEXT_PUBLIC_APP_ORIGIN, local);
  const supabaseOrigin = configuredOrigin(env.NEXT_PUBLIC_SUPABASE_URL, local);
  if (!appOrigin || !supabaseOrigin || new URL(request.url).origin !== appOrigin) return null;
  return {
    appOrigin,
    supabaseOrigin,
    callbackUrl: `${appOrigin}/auth/callback`,
    secure: appOrigin.startsWith("https:"),
    storageKey: `sb-${new URL(supabaseOrigin).hostname.split(".")[0]}-auth-token`,
    flowCookieName: appOrigin.startsWith("https:") ? GOOGLE_FLOW_COOKIE : "daycare-google-flow-local",
  };
}

export function isSameOriginGoogleStart(request: Request, configuration: GoogleLoginConfiguration) {
  const url = new URL(request.url);
  const fetchSite = request.headers.get("sec-fetch-site");
  return request.method === "POST"
    && url.pathname === "/auth/google"
    && !url.search
    && request.headers.get("origin") === configuration.appOrigin
    && (!fetchSite || fetchSite === "same-origin");
}

export function googleFlowCookieOptions(secure: boolean, maxAge = GOOGLE_FLOW_TTL_SECONDS) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge };
}

/** This is an initiation marker, not a replacement for Supabase's PKCE/state checks. */
export function newGoogleFlowMarker(flowId: string | null | undefined, now = Date.now()) {
  if (!flowId || !/^[A-Za-z0-9_-]{8,64}$/u.test(flowId)) return null;
  return `${Math.floor(now / 1000)}.${flowId}`;
}

export function googleFlowId(value: string | undefined, now = Date.now()) {
  if (!value || !/^\d{10}\.[A-Za-z0-9_-]{8,64}$/u.test(value)) return null;
  const age = Math.floor(now / 1000) - Number(value.split(".")[0]);
  return age >= 0 && age < GOOGLE_FLOW_TTL_SECONDS ? value.split(".")[1] : null;
}

/** Only the SDK-generated Google PKCE endpoint on this Supabase project is allowed. */
export function validatedGoogleAuthorizationUrl(value: string | null, configuration: GoogleLoginConfiguration) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const params = url.searchParams;
    const unique = (key: string, expected: string) => params.getAll(key).length === 1 && params.get(key) === expected;
    if (url.origin !== configuration.supabaseOrigin || url.pathname !== "/auth/v1/authorize"
      || url.username || url.password || url.hash
      || !unique("provider", "google") || !unique("redirect_to", configuration.callbackUrl)
      || !unique("prompt", "select_account") || !unique("code_challenge_method", "s256")
      || params.getAll("code_challenge").length !== 1
      || !/^[A-Za-z0-9_-]{43}$/u.test(params.get("code_challenge") ?? "")
      || params.has("access_type") || params.has("state")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Supabase's own callback validates provider state and redirects here with code only. */
export function googleCallbackCode(request: Request) {
  const url = new URL(request.url);
  if (url.pathname !== "/auth/callback" || url.searchParams.size !== 1) return null;
  const code = url.searchParams.get("code");
  return code && /^[A-Za-z0-9._~-]{1,2048}$/u.test(code) ? code : null;
}

export function googleAuthRedirect(location = GOOGLE_LOGIN_FAILURE) {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: location,
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
