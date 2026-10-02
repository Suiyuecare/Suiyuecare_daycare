import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSyntheticPreviewMode } from "@/lib/env";
import { isSyntheticPreviewRequestBlocked } from "@/lib/synthetic-preview/config";
import { withServerReadDeadline } from "@/lib/api/server-read-deadline";
import { createServerReadFetch } from "@/lib/supabase/server-read-fetch";

export async function proxy(request: NextRequest) {
  if (isSyntheticPreviewMode()) {
    if (isSyntheticPreviewRequestBlocked(request.method, request.nextUrl.pathname)) {
      return NextResponse.json({ requestId: crypto.randomUUID(), status: "error", data: null, errors: [{
        code: "SYNTHETIC_PREVIEW_READ_ONLY",
        message: "線上試用只提供合成資料檢視，不接受 API、上傳或資料寫入。",
      }] }, { status: 403, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
    }
    return NextResponse.next({ request });
  }
  let response = NextResponse.next({ request });
  if (/^\/(?:_next\/(?:static|image)|favicon\.ico|manifest\.webmanifest|sw\.js)|\.(?:svg|png|jpg|jpeg|gif|webp)$/u.test(request.nextUrl.pathname)) {
    return response;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return response;
  }

  try {
    await withServerReadDeadline(async (deadline) => {
      const owner = AbortSignal.any([deadline, request.signal]);
      owner.throwIfAborted();
      const changes: Array<{ name: string; value: string; options: CookieOptions }> = [];
      const stagedCookies = new Map(request.cookies.getAll().map(({ name, value }) => [name, value]));
      const refreshHeaders = new Map<string, string>();
      const supabase = createServerClient(url, publishableKey, {
        global: { fetch: createServerReadFetch(owner) },
        cookies: {
          // Subsequent SDK cleanup must see chunks created by an earlier
          // staged refresh, while the real request remains unchanged.
          getAll: () => Array.from(stagedCookies, ([name, value]) => ({ name, value })),
          setAll(cookiesToSet, headers) {
            // A late refresh may include removals as well as new tokens. Stage
            // both until this optional refresh finishes inside its read owner.
            if (owner.aborted) return;
            changes.push(...cookiesToSet);
            cookiesToSet.forEach(({ name, value }) => stagedCookies.set(name, value));
            Object.entries(headers).forEach(([name, value]) => refreshHeaders.set(name, value));
          },
        },
      });

      // Refresh and cryptographically verify, never authorize in Proxy.
      await supabase.auth.getClaims();
      owner.throwIfAborted();
      if (changes.length) {
        changes.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        changes.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
      refreshHeaders.forEach((value, name) => response.headers.set(name, value));
    });
  } catch {
    // Optional refresh failure must not fabricate identity or clear cookies.
    // Continue to the unchanged Server Component, API and RLS admission gates;
    // this also leaves independent logout and signed webhooks reachable.
  }

  return response;
}

export const config = {
  // Include assets: unsafe methods and API paths with file extensions must not bypass the preview gate.
  matcher: ["/:path*"],
};
