import { z } from "zod";
import { ok } from "@/lib/api/response";
import { handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import { runCustomDraftRpc } from "@/lib/form-governance/draft-http";
import { parsePrintJob, printRequestSchema } from "@/lib/custom-form-responses/print-contract";
import { authorizeCustomPrint, customPrintFailure } from "@/lib/custom-form-responses/print-http";
import { issuePrintToken } from "@/lib/custom-form-responses/print-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const { actor, db } = await authorizeCustomPrint(true);
    const input = printRequestSchema.safeParse(await readJsonObject(request, 2048));
    const key = z.uuid().safeParse(request.headers.get("idempotency-key"));
    if (!input.success || !key.success) throw new IntegrationError("INVALID_CUSTOM_PRINT", "請選擇已保存的表單及有效操作識別碼。", 400);
    const { data, error } = await runCustomDraftRpc(db.rpc("prepare_custom_response_print", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_client: input.data.clientId, p_response: input.data.responseId, p_key: key.data,
    }));
    if (error) throw customPrintFailure(error.code);
    const job = parsePrintJob(data, { ...input.data, organizationId: actor.organizationId, branchId: actor.branchId, actorId: actor.userId });
    let token: string;
    try { token = issuePrintToken(job); } catch { throw new IntegrationError("CUSTOM_PRINT_EXPIRED", "列印連結已過期，請重新準備。", 410); }
    return ok({ job, downloadUrl: `/api/forms/responses/prints/${job.jobId}/pdf?token=${encodeURIComponent(token)}`, persisted: true, demo: false }, job.replayed ? 200 : 201, requestId);
  });
}
