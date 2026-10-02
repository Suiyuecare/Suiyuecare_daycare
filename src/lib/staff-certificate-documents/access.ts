import "server-only";
import { z } from "zod";
import { getTenantContext } from "@/lib/auth/context";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { documentDeadline } from "./request";

const uuid = z.uuid().transform(value => value.toLowerCase());
const evidenceSchema = z.object({ organizationId: uuid, branchId: uuid, actorUserId: uuid,
  verifiedAt: z.iso.datetime({ offset: true }) }).strict();

export function staffDocumentFailure(code?: string) {
  return databaseFailure(code === "42501" ? "STAFF_DOCUMENT_FORBIDDEN" : "STAFF_DOCUMENT_RESULT_UNCERTAIN",
    code === "42501" ? "目前沒有這位員工附件的操作授權，或身分確認已過期。"
      : "附件或證照版本尚未確認，請保留原檔與相同操作識別碼。", code === "42501" ? 403 : 409);
}

/** Shared admission is not a substitute for each user-scoped RPC's live checks. */
export async function staffDocumentActorContext(manage: boolean, signal?: AbortSignal) {
  const actor = await documentDeadline(getTenantContext("staff"), 20000, signal);
  if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先以已核准帳號登入。", 401);
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會讀取或修改員工證明附件。", 403);
  if (!actor.branchId || actor.assuranceLevel !== "aal2" || !actor.scopes.includes("staff_certificates.read") ||
    (manage && !actor.scopes.includes("staff_certificates.manage"))) throw staffDocumentFailure("42501");
  const server = await documentDeadline(createServerSupabaseClient(), 20000, signal);
  if (!server) throw databaseFailure("STAFF_DOCUMENT_UNAVAILABLE", "員工附件資料服務尚未完成設定。", 503);
  return { actor, server };
}

export async function requireRecentStaffDocumentEvidence(actor: TenantContext,
  server: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>, signal?: AbortSignal) {
  const { data, error } = await documentDeadline(Promise.resolve(server.rpc("staff_certificate_document_recent_aal2_evidence", {
    p_org: actor.organizationId, p_branch: actor.branchId,
  })), 20000, signal);
  const evidence = evidenceSchema.safeParse(data);
  const now = Date.now();
  if (error || !evidence.success || evidence.data.organizationId !== actor.organizationId || evidence.data.branchId !== actor.branchId ||
    evidence.data.actorUserId !== actor.userId || Date.parse(evidence.data.verifiedAt) < now - 900000 || Date.parse(evidence.data.verifiedAt) > now + 1000) {
    throw staffDocumentFailure("42501");
  }
}

export function staffDocumentNoQuery(request: Request) {
  if (new URL(request.url).search) throw new IntegrationError("INVALID_STAFF_DOCUMENT_QUERY", "請從員工證照附件入口操作。", 400);
}

/** Pin browser requests to the branch the operator actually saw. Never silently
 * use a new active branch after an in-flight tab's authority has changed. */
export function staffDocumentRequestScope(request: Request) {
  const scope = z.object({ organizationId: uuid, branchId: uuid }).strict().safeParse({
    organizationId: request.headers.get("x-organization-id"),
    branchId: request.headers.get("x-branch-id"),
  });
  if (!scope.success) throw new IntegrationError("INVALID_STAFF_DOCUMENT_SCOPE", "請重新開啟目前機構的員工附件入口。", 400);
  return scope.data;
}

export function requireStaffDocumentRequestScope(scope: { organizationId: string; branchId: string }, actor: TenantContext) {
  if (scope.organizationId !== actor.organizationId || scope.branchId !== actor.branchId) throw staffDocumentFailure("42501");
}

export function requireBodylessStaffDocumentRead(request: Request) {
  const length = request.headers.get("content-length");
  if (request.method !== "GET" || request.body !== null || request.headers.has("transfer-encoding") || (length !== null && length !== "0")) {
    throw new IntegrationError("INVALID_STAFF_DOCUMENT_QUERY", "請從員工附件清單查詢原操作。", 400);
  }
}
