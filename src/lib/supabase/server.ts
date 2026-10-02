import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { env, hasSupabaseConfiguration, isSyntheticPreviewMode } from "@/lib/env";
import { createServerReadFetch } from "./server-read-fetch";

export async function createServerSupabaseClient(read: { signal?: AbortSignal } = {}) {
  if (isSyntheticPreviewMode() || !hasSupabaseConfiguration()) {
    return null;
  }

  read.signal?.throwIfAborted();
  const cookieStore = await cookies();
  read.signal?.throwIfAborted();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      ...(read.signal ? { global: { fetch: createServerReadFetch(read.signal) } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Auth refresh may finish after the read owner has ended. Neither
          // refreshed values nor removals may alter a later response/session.
          if (read.signal?.aborted) return;
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              if (read.signal?.aborted) return;
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot write cookies. Proxy handles refreshes.
          }
        },
      },
    },
  );
}
