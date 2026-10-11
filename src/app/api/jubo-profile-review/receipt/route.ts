import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { assertJuboReviewJsonRequest } from "@/lib/jubo-review/http";
import { juboReviewRequestSchema } from "@/lib/jubo-review/model";
import { authorizeJuboReviewScope, readJuboReviewReceipt } from "@/lib/jubo-review/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only recovery. AAL2 expiry may not make an already-committed write unknowable. */
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    assertJuboReviewJsonRequest(request);
    const parsed = juboReviewRequestSchema.safeParse(await readJsonObject(request, 4096));
    if (!parsed.success) {
      throw new IntegrationError("JUBO_REVIEW_INVALID", "原覆核內容不完整，無法安全核對回執。", 400);
    }
    const actor = await authorizeJuboReviewScope();
    return ok(await readJuboReviewReceipt(actor, parsed.data), 200, requestId);
  });
}
