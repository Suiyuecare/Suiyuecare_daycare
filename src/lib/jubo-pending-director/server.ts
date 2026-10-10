import "server-only";
import { z } from "zod";
import { getTenantContext } from "@/lib/auth/context";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { directorDirectorySchema, directorWorkspaceSchema, directorDraftReceiptSchema, directorExactReceiptSchema, type DirectorDraftInput } from "./contract";

export async function requirePendingDirector() {
  const actor = await getTenantContext("staff");
  if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先使用已核准的公司 Google 帳號登入。", 401);
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會讀寫正式 JUBO 個案。", 403);
  if (!actor.branchId || !actor.roles.includes("branch_director") ||
    !actor.scopes.includes("clients.jubo_pending_source.read") ||
    !actor.scopes.includes("clients.intake_draft.manage")) {
    throw new IntegrationError("JUBO_DIRECTOR_NOT_AUTHORIZED", "僅目前分支的機構主任可核對待收案資料。", 403);
  }
  return actor;
}

export function pendingDirectorDatabaseError(code?: string): never {
  if (code === "42501") throw new IntegrationError("JUBO_DIRECTOR_NOT_AUTHORIZED", "此個案不在目前分支待收案清單，或授權已變更。", 403);
  if (code === "40001" || code === "23505") throw new IntegrationError("JUBO_DIRECTOR_DRAFT_CONFLICT", "草稿已有更新，此次沒有寫入。請重新載入核對。", 412);
  if (code === "22023" || code === "23514") throw new IntegrationError("JUBO_DIRECTOR_DRAFT_INVALID", "請檢查草稿內容與個案狀態。", 400);
  throw new IntegrationError("JUBO_DIRECTOR_UNAVAILABLE", "資料尚未確認完成，請保留本次內容與請求識別碼後重試。", 503);
}

async function rpc(name: string, arguments_: Record<string, unknown>) {
  const db = await createServerSupabaseClient();
  if (!db) pendingDirectorDatabaseError();
  const { data, error } = await db.rpc(name, arguments_);
  if (error || data === null) pendingDirectorDatabaseError(error?.code);
  return data as unknown;
}

export async function readPendingDirectorDirectory(organizationId: string, branchId: string) {
  const result = directorDirectorySchema.safeParse(await rpc("jubo_pending_director_directory", { p_org: organizationId, p_branch: branchId }));
  if (!result.success) pendingDirectorDatabaseError();
  return result.data;
}

export async function readPendingDirectorWorkspace(organizationId: string, branchId: string, clientId: string) {
  if (!z.uuid().safeParse(clientId).success) throw new IntegrationError("INVALID_CLIENT", "請重新選擇個案。", 400);
  const result = directorWorkspaceSchema.safeParse(await rpc("jubo_pending_director_source_workspace", { p_org: organizationId, p_branch: branchId, p_client: clientId }));
  if (!result.success || result.data.clientId !== clientId) pendingDirectorDatabaseError();
  return result.data;
}

export async function savePendingDirectorDraft(organizationId: string, branchId: string, input: DirectorDraftInput) {
  const receipt = directorDraftReceiptSchema.safeParse(await rpc("save_jubo_pending_director_draft", {
    p_org: organizationId, p_branch: branchId, p_client: input.clientId,
    p_kind: input.kind, p_form_key: input.formKey,
    p_expected_revision: input.expectedRevision, p_payload: input.payload,
    p_idempotency_key: input.idempotency_key,
  }));
  if (!receipt.success || receipt.data.kind !== input.kind || receipt.data.formKey !== input.formKey ||
    receipt.data.revision !== input.expectedRevision + 1 || receipt.data.formalRecord !== false) {
    pendingDirectorDatabaseError();
  }
  return receipt.data;
}

export async function readPendingDirectorExactReceipt(organizationId: string, branchId: string,
  clientId: string, idempotencyKey: string) {
  const result = directorExactReceiptSchema.safeParse(await rpc("jubo_pending_director_exact_receipt", {
    p_org: organizationId, p_branch: branchId, p_client: clientId, p_idempotency_key: idempotencyKey,
  }));
  if (!result.success || result.data.found && result.data.clientId !== clientId) pendingDirectorDatabaseError();
  return result.data;
}
