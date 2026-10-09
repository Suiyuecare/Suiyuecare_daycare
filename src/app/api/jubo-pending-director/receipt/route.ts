import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { directorExactReceiptQuerySchema } from "@/lib/jubo-pending-director/contract";
import { readPendingDirectorExactReceipt, requirePendingDirector } from "@/lib/jubo-pending-director/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read only. A missing receipt does not prove that an in-flight request failed. */
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await requirePendingDirector();
    if (!/^application\/json(?:;|$)/iu.test(request.headers.get("content-type") ?? "")) {
      throw new IntegrationError("JSON_REQUIRED", "請從原次草稿操作核對。", 415);
    }
    const parsed = directorExactReceiptQuerySchema.safeParse(await readJsonObject(request, 1024));
    if (!parsed.success) throw new IntegrationError("JUBO_DIRECTOR_RECEIPT_INVALID", "請保留原次操作並重新核對。", 400);
    const data = await readPendingDirectorExactReceipt(actor.organizationId, actor.branchId,
      parsed.data.clientId, parsed.data.idempotency_key);
    return ok(data, 200, requestId);
  });
}
