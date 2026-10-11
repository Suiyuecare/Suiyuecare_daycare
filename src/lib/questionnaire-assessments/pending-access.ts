import "server-only";

import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const idsSchema = z.array(z.uuid()).max(500);

/** The database checks source provenance and action permission, not just role. */
export async function loadAuthorizedPendingQuestionnaireClientIds(
  context: TenantContext,
  visibleIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (context.demo || !context.branchId || visibleIds.length === 0) return new Set();
  const input = idsSchema.safeParse(visibleIds);
  if (!input.success) throw new Error("Pending questionnaire access unavailable.");
  const requested = new Set(input.data);
  const db = await createServerSupabaseClient();
  if (!db) throw new Error("Pending questionnaire access unavailable.");
  const { data, error } = await db.rpc("authorized_pending_questionnaire_client_ids", {
    p_org: context.organizationId, p_branch: context.branchId, p_visible_ids: [...requested],
  });
  const parsed = idsSchema.safeParse(data);
  if (error || !parsed.success || new Set(parsed.data).size !== parsed.data.length ||
      parsed.data.some(id => !requested.has(id))) throw new Error("Pending questionnaire access unavailable.");
  return new Set(parsed.data);
}
