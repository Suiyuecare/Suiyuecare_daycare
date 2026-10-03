import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const ASSESSMENT_DRAFT_KINDS = ["body", "abcd", "behavior"] as const;
export type AssessmentDraftKind = typeof ASSESSMENT_DRAFT_KINDS[number];

/** A branch/client preflight only. The mutation RPC repeats the full live
 * Google, role, branch, client, action, and version checks in the database. */
export async function canUseAssessmentDraft(
  actor: TenantContext,
  kind: AssessmentDraftKind,
  clientId: string | null = null,
): Promise<boolean> {
  if (actor.demo || actor.assuranceLevel !== "aal1" || !actor.branchId ||
    !ASSESSMENT_DRAFT_KINDS.includes(kind) ||
    !["clients.read", `${kind === "body" ? "body_assessments" : kind === "abcd" ? "abcd_assessments" : "behavior_events"}.read`,
      `${kind === "body" ? "body_assessments" : kind === "abcd" ? "abcd_assessments" : "behavior_events"}.manage`]
      .every((permission) => actor.scopes.includes(permission))) return false;
  const db = await createServerSupabaseClient();
  if (!db) return false;
  try {
    const { data, error } = await db.rpc("has_google_assessment_draft_access", {
      target_org_id: actor.organizationId,
      target_branch_id: actor.branchId,
      target_kind: kind,
      target_client_id: clientId,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Body-only signer preflight. The mutation RPC repeats every authorization,
 * client-assignment, and same-session factor check before signing. */
export async function hasRecentBodyAssessmentAal2(
  actor: TenantContext,
): Promise<boolean> {
  if (actor.demo || actor.assuranceLevel !== "aal2" || !actor.branchId ||
    !["clients.read", "body_assessments.read", "body_assessments.sign"]
      .every((permission) => actor.scopes.includes(permission))) return false;
  const db = await createServerSupabaseClient();
  if (!db) return false;
  try {
    const { data, error } = await db.rpc("has_recent_body_assessment_aal2", {
      target_org_id: actor.organizationId,
      target_branch_id: actor.branchId,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}
