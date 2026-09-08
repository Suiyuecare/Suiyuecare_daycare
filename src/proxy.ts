import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSyntheticPreviewMode } from "@/lib/env";
import { isSyntheticPreviewRequestBlocked } from "@/lib/synthetic-preview/config";

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

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Refresh and cryptographically verify the session; authorization still
  // happens in Server Components, Route Handlers, and RLS.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  // Include assets: unsafe methods and API paths with file extensions must not bypass the preview gate.
  matcher: ["/:path*"],
};
