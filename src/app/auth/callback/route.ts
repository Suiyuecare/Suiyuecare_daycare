import { cookies } from "next/headers";

import {
  GOOGLE_FLOW_COOKIE, googleAuthRedirect, googleCallbackCode, googleFlowCookieOptions,
  googleLoginConfiguration, googleFlowId,
} from "@/lib/auth/google-login";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export async function GET(request: Request) {
  const configuration = googleLoginConfiguration(request);
  const cookieStore = await cookies();
  const cookieName = configuration?.flowCookieName ?? GOOGLE_FLOW_COOKIE;
  const flowId = googleFlowId(cookieStore.get(cookieName)?.value);
  cookieStore.set(cookieName, "", googleFlowCookieOptions(configuration?.secure ?? true, 0));
  if (!configuration || !flowId) return googleAuthRedirect();

  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>> = null;
  try {
    supabase = await createServerSupabaseClient();
    const code = googleCallbackCode(request);
    if (!supabase || !code) throw new Error("GOOGLE_CALLBACK_DENIED");
    // The SDK consumes the browser's PKCE verifier; a missing/wrong/replayed verifier fails closed.
    const exchanged = await supabase.auth.exchangeCodeForSession(code, { flowId });
    if (exchanged.error) throw new Error("GOOGLE_CALLBACK_DENIED");
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user || userData.user.is_anonymous
      || !userData.user.identities?.some((identity) => identity.provider === "google")) {
      throw new Error("GOOGLE_CALLBACK_DENIED");
    }
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    const claims = claimsData?.claims;
    if (claimsError || !claims || claims.sub !== userData.user.id
      || claims.iss !== `${configuration.supabaseOrigin}/auth/v1`
      || claims.role !== "authenticated" || claims.is_anonymous === true
      || !Array.isArray(claims.amr)
      || !claims.amr.some((method) => typeof method === "object" && method?.method === "oauth")) {
      throw new Error("GOOGLE_CALLBACK_DENIED");
    }
    // The server-owned, pinned identity allowlist is authoritative. Never grant membership here.
    const allowed = await supabase.rpc("is_executive_login_allowed");
    if (allowed.error || allowed.data !== true) throw new Error("GOOGLE_CALLBACK_DENIED");
    return googleAuthRedirect("/mfa");
  } catch {
    if (supabase) {
      try { await supabase.auth.signOut({ scope: "local" }); } catch { /* Still clear this project's browser session. */ }
    }
    // Scope cleanup to this project's Auth cookies, even if network sign-out fails.
    const escapedKey = configuration.storageKey.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const authCookie = new RegExp(`^${escapedKey}(?:(?:-flow-[A-Za-z0-9_-]{8,64}|-flows)?-code-verifier)?(?:\\.\\d+)?$`, "u");
    for (const { name } of cookieStore.getAll()) {
      if (authCookie.test(name)) cookieStore.set(name, "", { path: "/", maxAge: 0, secure: configuration.secure, sameSite: "lax" });
    }
    return googleAuthRedirect();
  }
}
