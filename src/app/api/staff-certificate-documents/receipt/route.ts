import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute } from "@/lib/integrations/http";
import { staffDocumentActorContext, staffDocumentFailure, staffDocumentNoQuery, staffDocumentRequestScope,
  requireStaffDocumentRequestScope, requireBodylessStaffDocumentRead } from "@/lib/staff-certificate-documents/access";
import { operationReceiptInputSchema, parseStaffCertificateDocumentOperationReceipt } from "@/lib/staff-certificate-documents/recovery-schema";
import { staffDocumentRouteDeadline } from "@/lib/staff-certificate-documents/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function operationInput(request: Request) {
  try {
    const raw = request.headers.get("x-staff-document-binding");
    if (!raw || raw.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(raw)) throw new Error("invalid binding");
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.length > 4096 || bytes.toString("base64url") !== raw) throw new Error("invalid encoding");
    const binding: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const input = operationReceiptInputSchema.safeParse({
      action: request.headers.get("x-staff-document-action"), idempotencyKey: request.headers.get("idempotency-key"),
      nonce: request.headers.get("x-staff-document-receipt-nonce"), binding,
    });
    if (!input.success) throw new Error("invalid operation");
    return input.data;
  } catch {
    throw new IntegrationError("INVALID_STAFF_DOCUMENT_RECEIPT", "請保留原操作識別碼與原始附件，從原操作查詢結果。", 400);
  }
}

export async function GET(request: Request) {
  return handleIntegrationRoute(async requestId => {
    staffDocumentNoQuery(request);
    requireBodylessStaffDocumentRead(request);
    if (request.headers.has("x-idempotency-key")) throw new IntegrationError("INVALID_STAFF_DOCUMENT_RECEIPT", "請使用原操作的唯一識別碼查證。", 400);
    const scope = staffDocumentRequestScope(request), input = operationInput(request);
    return staffDocumentRouteDeadline(request, async (active, signal) => {
      // Reading one's exact original operation does not grant a new write. The
      // RPC still checks current read access to its original staff/source scope.
      const { actor, server } = await staffDocumentActorContext(false, signal); active();
      requireStaffDocumentRequestScope(scope, actor);
      const { data, error } = await server.rpc("staff_certificate_document_operation_receipt", {
        p_org: actor.organizationId, p_branch: actor.branchId, p_action: input.action,
        p_key: input.idempotencyKey, p_binding: input.binding, p_nonce: input.nonce,
      }).abortSignal(signal).maybeSingle<{ payload: unknown }>(); active();
      if (error) throw staffDocumentFailure(error.code);
      let receipt;
      try {
        receipt = await parseStaffCertificateDocumentOperationReceipt(data?.payload, {
          organizationId: actor.organizationId, branchId: actor.branchId, actorUserId: actor.userId, ...input,
        });
      } catch {
        throw databaseFailure("STAFF_DOCUMENT_RECEIPT_UNCERTAIN", "原操作尚未完整確認，請保留原識別碼，不要新增另一筆。", 502);
      }
      active();
      return ok({ receipt }, 200, requestId);
    });
  });
}
