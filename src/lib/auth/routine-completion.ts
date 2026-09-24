import "server-only";

import { z } from "zod";
import { getTenantContext } from "@/lib/auth/context";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const ROUTINE_COMPLETION_ACTIONS = ["admission.create", "roster.manage"] as const;
export type RoutineCompletionAction = typeof ROUTINE_COMPLETION_ACTIONS[number];

/** A true Google AAL1 preflight. Each business transaction repeats the live
 * policy after its locks and before receipt replay. No signing/AAL2 evidence. */
export async function canUseRoutineCompletion(context: TenantContext, action: RoutineCompletionAction, clientId: string | null = null): Promise<boolean> {
  if (!(ROUTINE_COMPLETION_ACTIONS as readonly string[]).includes(action) || context.demo || !context.branchId ||
      (clientId !== null && !z.uuid().safeParse(clientId).success)) return false;
  const required = action === "admission.create" ? ["clients.read", "clients.manage"]
    : ["clients.read", "clients.view_all", "staff_scheduling.manage"];
  if (!required.every((permission) => context.scopes.includes(permission))) return false;
  try {
    const db = await createServerSupabaseClient();
    if (!db) return false;
    const { data, error } = await db.rpc("has_routine_completion_access", {
      target_org_id: context.organizationId, target_branch_id: context.branchId,
      target_action: action, target_client_id: clientId,
    });
    return !error && data === true;
  } catch { return false; }
}

export async function authorizeCompletionActor(): Promise<TenantContext> {
  const actor = await getTenantContext("staff");
  if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先使用已核准的公司 Google 帳號登入。", 401);
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會變更正式收案或每日分工。", 403);
  if (!actor.branchId) throw new IntegrationError("BRANCH_CONTEXT_REQUIRED", "請先選擇作業分支。", 409);
  return actor;
}
