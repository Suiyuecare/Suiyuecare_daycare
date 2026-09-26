import "server-only";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type EvidenceClient = { rpc: (name: string, args: Record<string, string>) => PromiseLike<{ data: unknown; error: unknown }> };
const evidenceSchema = z.object({
  organizationId: z.uuid(), branchId: z.uuid(), actorUserId: z.uuid(),
  verifiedAt: z.string().max(64).refine(isStrictOffsetDateTime),
}).strict();

/** Pages28/29 share the existing social-work signing capability, not the
 * generic, nursing or referral evidence stamp. Always retain the actual time
 * of the consumed same-session challenge verified by the scoped database RPC. */
export async function getSocialWorkRecentAal2At(actor: TenantContext, suppliedClient?: EvidenceClient): Promise<string | null> {
  if (actor.demo || actor.assuranceLevel !== "aal2" ||
    !["clients.read", "social_work_records.read", "social_work_records.sign"]
      .every(scope => actor.scopes.includes(scope))) return null;
  try {
    const client = suppliedClient ?? await createServerSupabaseClient();
    if (!client) return null;
    const { data, error } = await client.rpc("social_work_recent_aal2_evidence", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
    });
    const parsed = evidenceSchema.safeParse(data);
    if (error || !parsed.success) return null;
    const value = parsed.data;
    const age = Date.now() - Date.parse(value.verifiedAt);
    if (value.organizationId !== actor.organizationId || value.branchId !== actor.branchId ||
      value.actorUserId !== actor.userId || !Number.isFinite(age) || age < 0 || age > 15 * 60_000) return null;
    return new Date(value.verifiedAt).toISOString();
  } catch { return null; }
}

export async function requireRecentSocialWorkAal2(actor: TenantContext) {
  if (!(await getSocialWorkRecentAal2At(actor))) throw new IntegrationError("AAL2_REQUIRED",
    "社工簽署或更正需要最近15分鐘內、同一工作階段的有效雙因素驗證。", 403);
}
