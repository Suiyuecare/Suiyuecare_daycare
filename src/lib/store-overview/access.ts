import "server-only";

import { cache } from "react";
import type { TenantContext } from "@/lib/domain/types";
import { isSyntheticReadMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Memoized only within one request. The database checks the pinned CEO and live session. */
export const canReadStoreOverview = cache(async (context: TenantContext): Promise<boolean> => {
  if (isSyntheticReadMode()) return true; // Presentation-only, with no external adapters.
  if (!context.roles.includes("organization_manager")) return false;
  try {
    const db = await createServerSupabaseClient();
    if (!db) return false;
    const { data, error } = await db.rpc("can_read_store_overview", {
      p_organization_id: context.organizationId,
      p_branch_id: context.branchId,
    }).abortSignal(AbortSignal.timeout(5_000));
    return !error && data === true;
  } catch { return false; }
});
