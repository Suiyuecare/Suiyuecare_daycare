import "server-only";
import type { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { staffDocumentFailure } from "./access";
import { sourceQuerySchema, sourcesSnapshotSchema } from "./recovery-schema";
import { documentDeadline } from "./request";

export type StaffCertificateDocumentSourceQuery = z.infer<typeof sourceQuerySchema>;

export function staffCertificateDocumentSourceQuery(request: Request) {
  const parameters = new URL(request.url).searchParams;
  if ([...parameters.keys()].some(key => !["page", "staffMembershipId"].includes(key) || parameters.getAll(key).length !== 1) ||
    (parameters.has("page") && !/^[1-9]\d{0,4}$/u.test(parameters.get("page") ?? ""))) {
    throw new IntegrationError("INVALID_STAFF_DOCUMENT_QUERY", "員工附件篩選條件無效，請重新選擇。", 400);
  }
  const query = sourceQuerySchema.safeParse(Object.fromEntries(parameters));
  if (!query.success) throw new IntegrationError("INVALID_STAFF_DOCUMENT_QUERY", "請選擇正確的員工及清單頁數。", 400);
  return query.data;
}

/** Shared SSR/API projection. This is a new document-only source, not an
 * authorization expansion for the executive-only certificate record writer. */
export async function loadStaffCertificateDocumentSources(actor: TenantContext, query: StaffCertificateDocumentSourceQuery,
  server?: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>, signal?: AbortSignal) {
  if (actor.demo || !actor.branchId || actor.assuranceLevel !== "aal2" || !actor.scopes.includes("staff_certificates.read")) {
    throw staffDocumentFailure("42501");
  }
  const input = sourceQuerySchema.safeParse(query);
  if (!input.success) throw new IntegrationError("INVALID_STAFF_DOCUMENT_QUERY", "員工附件篩選條件無效。", 400);
  const client = server ?? await documentDeadline(createServerSupabaseClient(), 20000, signal);
  if (!client) throw databaseFailure("STAFF_DOCUMENT_UNAVAILABLE", "員工附件資料服務尚未完成設定。", 503);
  if (signal?.aborted) throw databaseFailure("STAFF_DOCUMENT_RESULT_UNCERTAIN", "員工證照清單尚未完整確認。", 503);
  const operation = client.rpc("staff_certificate_document_sources", {
    p_org: actor.organizationId, p_branch: actor.branchId,
    p_staff_membership_id: input.data.staffMembershipId, p_page: input.data.page,
  });
  const { data, error } = await documentDeadline(Promise.resolve((signal ? operation.abortSignal(signal) : operation)
    .maybeSingle<{ payload: unknown }>()), 20000, signal);
  if (error) throw staffDocumentFailure(error.code);
  const proof = sourcesSnapshotSchema.safeParse(data?.payload), now = Date.now();
  if (!proof.success || proof.data.organizationId !== actor.organizationId || proof.data.branchId !== actor.branchId ||
    proof.data.actorUserId !== actor.userId || proof.data.staffMembershipId !== input.data.staffMembershipId || proof.data.page !== input.data.page ||
    Date.parse(proof.data.generatedAt) < now - 60000 || Date.parse(proof.data.generatedAt) > now + 1000 ||
    (proof.data.canManageDocuments && !actor.scopes.includes("staff_certificates.manage"))) {
    throw databaseFailure("STAFF_DOCUMENT_SOURCES_UNCERTAIN", "員工證照清單尚未完整核對，請重試。", 502);
  }
  return proof.data;
}
