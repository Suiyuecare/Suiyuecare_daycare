import "server-only";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Forms-only proof; never accepted as a general AAL2/clinical/financial grant. */
export async function hasCustomFormGovernanceAccess(actor: TenantContext, write: boolean) {
  if (actor.demo || !actor.branchId || !actor.scopes.includes("forms.manage") || (write && actor.assuranceLevel !== "aal2")) return false;
  try {
    const db = await createServerSupabaseClient(); if (!db) return false;
    const { data, error } = await db.rpc("has_custom_form_governance_access", { p_org: actor.organizationId, p_branch: actor.branchId, p_write: write }).abortSignal(AbortSignal.timeout(10_000));
    return !error && data === true;
  } catch { return false; }
}
export async function requireCustomFormAal2(actor: TenantContext) {
  if (actor.demo) return;
  if (!(await hasCustomFormGovernanceAccess(actor, true))) throw new IntegrationError("AAL2_REQUIRED", "表單治理需要有效授權及最近 15 分鐘內的本人雙因素重新驗證。", 403);
}
