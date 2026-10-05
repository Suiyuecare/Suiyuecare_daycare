import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Preflight only. Every draft RPC repeats live session, role and client checks. */
export async function canUseToccDraft(
  actor: TenantContext,
  clientId: string | null = null,
  write = false,
): Promise<boolean> {
  if (actor.demo || !actor.branchId || actor.assuranceLevel === "aal1" &&
    !actor.scopes.includes("health.write")) return false;
  if (!["clients.read", "health.read", ...(write ? ["health.write"] : [])]
    .every((scope) => actor.scopes.includes(scope))) return false;
  const db = await createServerSupabaseClient();
  if (!db) return false;
  try {
    const { data, error } = await db.rpc("has_client_tocc_draft_access", {
      target_org_id: actor.organizationId,
      target_branch_id: actor.branchId,
      target_client_id: clientId,
      target_write: write,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Presentation preflight; signing RPC rechecks the exact draft and factor. */
export async function canSignToccDraft(actor: TenantContext): Promise<boolean> {
  if (actor.demo || actor.assuranceLevel !== "aal2" || !actor.branchId ||
    !["clients.read", "health.write"].every((scope) => actor.scopes.includes(scope))) return false;
  const db = await createServerSupabaseClient();
  if (!db) return false;
  try {
    const { data, error } = await db.rpc("can_sign_client_tocc_draft", {
      target_org_id: actor.organizationId,
      target_branch_id: actor.branchId,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}
