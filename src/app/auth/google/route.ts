import { cookies } from "next/headers";

import {
  googleAuthRedirect, googleFlowCookieOptions,
  googleLoginConfiguration, isSameOriginGoogleStart, newGoogleFlowMarker,
  validatedGoogleAuthorizationUrl,
} from "@/lib/auth/google-login";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const preferredRegion = "hnd1";

export async function POST(request: Request) {
  const configuration = googleLoginConfiguration(request);
  if (!configuration || !isSameOriginGoogleStart(request, configuration)) return googleAuthRedirect();

  const cookieStore = await cookies();
  cookieStore.set(configuration.flowCookieName, "", googleFlowCookieOptions(configuration.secure, 0));
  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) return googleAuthRedirect();
    // No email, role, audience, signup, or return destination is accepted from the browser.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: configuration.callbackUrl,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    const destination = !error ? validatedGoogleAuthorizationUrl(data?.url, configuration) : null;
    const marker = newGoogleFlowMarker(data?.flowId);
    if (!destination || !marker) return googleAuthRedirect();
    cookieStore.set(configuration.flowCookieName, marker, googleFlowCookieOptions(configuration.secure));
    return googleAuthRedirect(destination);
  } catch {
    // OAuth errors can contain provider tokens or identifying details; never echo or log them.
    return googleAuthRedirect();
  }
}
