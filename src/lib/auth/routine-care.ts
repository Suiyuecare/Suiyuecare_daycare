import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const ROUTINE_CARE_PERMISSIONS = [
  "attendance.write", "health.write", "care_records.write", "care_records.read",
] as const;
export type RoutineCarePermission = typeof ROUTINE_CARE_PERMISSIONS[number];

/** Presentation/API preflight only; each business RPC rechecks the live actor,
 * pinned Google grant, session, permission and client scope in its transaction.
 * A normal Google login stays AAL1. This never supplies signing evidence. */
export async function canUseRoutineCare(
  context: TenantContext,
  permission: RoutineCarePermission,
): Promise<boolean> {
  if (!ROUTINE_CARE_PERMISSIONS.includes(permission) || !context.branchId) return false;
  if (context.demo) return true;
  if (!context.scopes.includes(permission)) return false;
  if (context.assuranceLevel === "aal2") return true;
  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) return false;
    const { data, error } = await supabase.rpc("has_routine_care_access", {
      target_org_id: context.organizationId,
      target_branch_id: context.branchId,
      target_permission: permission,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}
