import "server-only";
import { z } from "zod";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/domain/types";
import { intakeSnapshotSchema } from "./model";
import { getTenantContext } from "@/lib/auth/context";
import { authorizeRoutineIntake } from "@/lib/auth/routine-intake";
import { buildDemoClientMasterSnapshot } from "@/lib/clients/master-demo";

export function intakeDatabaseError(code?: string): never {
  if (code === "42501") throw new IntegrationError("INTAKE_NOT_AUTHORIZED", "此帳號沒有目前分支、個案或敏感欄位的操作權限，或需要重新確認身分。", 403);
  if (["40001", "23505"].includes(code ?? "")) throw new IntegrationError("INTAKE_CONFLICT", "資料版本、個案識別或這次操作已有異動。請重新核對後再儲存；尚未覆蓋現有資料。", 409);
  if (["22023", "23514", "23503", "22007", "22008"].includes(code ?? "")) throw new IntegrationError("INTAKE_INVALID", "請檢查必填、日期、來源欄位與個案狀態，再重新核對。", 400);
  throw new IntegrationError("INTAKE_UNAVAILABLE", "尚未確認儲存完成。請保留輸入內容並使用同一次操作重試，或將請求編號交給管理員。", 503);
}

export async function authorizeIntake(write = false, create = false, clientId: string | null = null) {
  const actor = write ? await authorizeRoutineIntake(create ? "profile.create" : "profile.update", clientId) : await getTenantContext("staff");
  if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入再查看收案資料。", 401);
  if (!actor.branchId) throw new IntegrationError("BRANCH_CONTEXT_REQUIRED", "請先選擇作業分支。", 409);
  const required = ["clients.read", "clients.demographics.read", ...(write ? ["clients.manage"] : []), ...(create ? ["clients.view_all"] : [])];
  if (!actor.demo && !required.every((scope) => actor.scopes.includes(scope))) throw new IntegrationError("INTAKE_NOT_AUTHORIZED", "此功能需要個案與敏感基本資料權限，請由收案負責人操作。", 403);
  if (write) {
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "此頁僅供合成資料試看，不會保存或匯入真實個案。", 403);
  }
  return actor;
}

export async function intakeRpc(name: string, args: Record<string, unknown>) {
  const db = await createServerSupabaseClient();
  if (!db) intakeDatabaseError();
  const result = await db.rpc(name, args);
  if (result.error || result.data == null) intakeDatabaseError(result.error?.code);
  return result.data as unknown;
}

export async function loadIntakeDirectory(actor: TenantContext) {
  if (actor.demo) return buildDemoClientMasterSnapshot().clients.map(({ id, displayName, clientCode }) => ({ id, displayName, clientCode }));
  const parsed = z.array(z.object({ id: z.uuid(), displayName: z.string(), clientCode: z.string() }).strict()).max(500).safeParse(await intakeRpc("intake_client_directory", { p_org: actor.organizationId, p_branch: actor.branchId }));
  if (!parsed.success || new Set(parsed.data.map(client => client.id)).size !== parsed.data.length) intakeDatabaseError();
  return parsed.data;
}

export async function readIntakeSnapshot(actor: TenantContext, clientId: string) {
  if (!z.uuid().safeParse(clientId).success) throw new IntegrationError("INVALID_CLIENT", "請重新選擇個案。", 400);
  const result = intakeSnapshotSchema.safeParse(await intakeRpc("client_intake_snapshot", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: clientId }));
  if (!result.success || result.data.clientId !== clientId) intakeDatabaseError();
  return result.data;
}
