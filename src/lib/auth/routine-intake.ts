import "server-only";
import { z } from "zod";
import { getTenantContext } from "@/lib/auth/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { IntegrationError } from "@/lib/integrations/errors";
export const ROUTINE_INTAKE_ACTIONS = ["profile.read", "profile.create", "profile.update", "cms.stage", "cms.preview", "cms.commit", "weekly.read", "weekly.write", "abcd.read", "abcd.save", "abcd.submit", "abcd.review"] as const;
export type RoutineIntakeAction = typeof ROUTINE_INTAKE_ACTIONS[number];
/** Business RPCs recheck live Google, session, membership, field and client scope.
 * This action-specific preflight never fabricates AAL2 or signing evidence. */
export async function authorizeRoutineIntake(action: RoutineIntakeAction, clientId: string | null = null) {
  const actor = await getTenantContext("staff");
  if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先使用已核准的公司 Google 帳號登入。", 401);
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會存取正式收案資料。", 403);
  if (!actor.branchId) throw new IntegrationError("BRANCH_CONTEXT_REQUIRED", "請先選擇作業分支。", 409);
  if (!(ROUTINE_INTAKE_ACTIONS as readonly string[]).includes(action) || (clientId !== null && !z.uuid().safeParse(clientId).success)) throw new IntegrationError("INVALID_INTAKE_ACTION", "請從個案收案流程操作。", 400);
  const db = await createServerSupabaseClient();
  if (!db) throw new IntegrationError("INTAKE_UNAVAILABLE", "收案授權暫時無法確認，請稍後重試。", 503);
  const { data, error } = await db.rpc("has_routine_intake_access", { target_org_id: actor.organizationId, target_branch_id: actor.branchId, target_action: action, target_client_id: clientId });
  if (error || data !== true) throw new IntegrationError("INTAKE_NOT_AUTHORIZED", "此 Google 帳號尚未獲准處理目前分支、個案或資料類別；請聯絡管理員。", 403);
  return actor;
}
