import { z } from "zod";
import { ok } from "@/lib/api/response";
import { cmsCommitSchema, intakeReceiptSchema } from "@/lib/client-intake/model";
import { intakeDatabaseError, intakeRpc } from "@/lib/client-intake/server";
import { authorizeRoutineIntake } from "@/lib/auth/routine-intake";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    if (!/^application\/json(?:;|$)/iu.test(request.headers.get("content-type") ?? "")) throw new IntegrationError("JSON_REQUIRED", "請從匯入核對表單確認。", 415);
    const parsed = cmsCommitSchema.safeParse(await readJsonObject(request, 64 * 1024));
    if (!parsed.success) throw new IntegrationError("INVALID_IMPORT_DECISION", "請逐欄核對來源與更新選擇後再建檔。", 400);
    const input = parsed.data;
    const actor = await authorizeRoutineIntake("cms.commit", input.clientId);
    if (!["imports.manage", "imports.approve"].every((scope) => actor.scopes.includes(scope))) throw new IntegrationError("IMPORT_NOT_AUTHORIZED", "此帳號沒有確認匯入的權限。", 403);
    const result = await intakeRpc("commit_cms_intake", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_operation: input.idempotency_key,
      p_batch: input.batchId, p_payload_sha256: input.payloadSha256, p_client: input.clientId,
      p_expected_version: input.clientId ? input.expectedVersion : null, p_expected_client_version: input.clientId ? input.expectedClientVersion : null,
      p_client_code: input.clientCode, p_decisions: input.decisions,
      p_source_review_reason: input.sourceReviewReason,
    });
    const receipt = intakeReceiptSchema.extend({ formallyImported: z.literal(true), batchId: z.uuid() }).safeParse(result);
    if (!receipt.success || receipt.data.operationId !== input.idempotency_key || receipt.data.batchId !== input.batchId || (input.clientId ? receipt.data.clientId !== input.clientId || receipt.data.profileVersion !== input.expectedVersion + 1 || receipt.data.clientRowVersion !== input.expectedClientVersion + 1 : receipt.data.profileVersion !== 1 || receipt.data.clientRowVersion !== 1 || !receipt.data.pending)) intakeDatabaseError();
    return ok({ ...receipt.data, persisted: true }, 200, requestId);
  });
}
