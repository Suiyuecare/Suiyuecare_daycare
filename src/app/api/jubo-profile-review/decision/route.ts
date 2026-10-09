import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { assertJuboReviewJsonRequest } from "@/lib/jubo-review/http";
import { juboReviewRequestSchema } from "@/lib/jubo-review/model";
import { authorizeJuboReview, reviewJuboProfile } from "@/lib/jubo-review/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    assertJuboReviewJsonRequest(request);
    const parsed = juboReviewRequestSchema.safeParse(await readJsonObject(request, 4096));
    if (!parsed.success) {
      throw new IntegrationError("JUBO_REVIEW_INVALID", "請選擇決定並填寫 10–1000 字的理由。", 400);
    }
    const actor = await authorizeJuboReview();
    return ok(await reviewJuboProfile(actor, parsed.data), 200, requestId);
  });
}
