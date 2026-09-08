import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env, hasSupabaseAdminConfiguration, isSyntheticPreviewMode } from "@/lib/env";

export function createSupabaseAdminClient() {
  if (isSyntheticPreviewMode() || !hasSupabaseAdminConfiguration()) {
    return null;
  }

  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
