import { ok } from "@/lib/api/response";
import { requireSameOriginWrite } from "@/lib/auth/same-origin-write";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute } from "@/lib/integrations/http";
import { staffDocumentActorContext, staffDocumentFailure, staffDocumentNoQuery, staffDocumentRequestScope,
  requireStaffDocumentRequestScope, requireRecentStaffDocumentEvidence } from "@/lib/staff-certificate-documents/access";
import { closureInputSchema, parseStaffCertificateDocumentClosureReceipt } from "@/lib/staff-certificate-documents/recovery-schema";
import { readBoundedDocumentJson, staffDocumentRouteDeadline } from "@/lib/staff-certificate-documents/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleIntegrationRoute(async requestId => {
    staffDocumentNoQuery(request);
    requireSameOriginWrite(request, { method: "POST", format: "json" });
    const scope = staffDocumentRequestScope(request);
    return staffDocumentRouteDeadline(request, async (active, signal) => {
      const { actor, server } = await staffDocumentActorContext(true, signal); active();
      requireStaffDocumentRequestScope(scope, actor);
      await requireRecentStaffDocumentEvidence(actor, server, signal); active();
      const input = closureInputSchema.safeParse(await readBoundedDocumentJson(request, signal)); active();
      if (!input.success) throw new IntegrationError("INVALID_STAFF_DOCUMENT_RECONCILIATION", "請先查回原操作，再確認結束已過期的上傳。", 400);
      const { data, error } = await server.rpc("reconcile_expired_staff_certificate_document", {
        p_org: actor.organizationId, p_branch: actor.branchId, p_key: input.data.originalIdempotencyKey,
        p_binding: input.data.binding, p_reconciliation_key: input.data.reconciliationKey, p_nonce: input.data.nonce,
      }).abortSignal(signal).maybeSingle<{ payload: unknown }>(); active();
      if (error) throw staffDocumentFailure(error.code);
      let receipt;
      try {
        receipt = await parseStaffCertificateDocumentClosureReceipt(data?.payload, {
          organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId, ...input.data,
        });
      } catch {
        throw databaseFailure("STAFF_DOCUMENT_RECONCILIATION_UNCERTAIN", "原操作結束狀態尚未完整確認，請保留相同識別碼查證。", 502);
      }
      active();
      return ok({ receipt }, receipt.status === "expired_closed" && !receipt.replayed ? 201 : 200, requestId);
    });
  });
}
