import { ok } from "@/lib/api/response";
import { handleIntegrationRoute } from "@/lib/integrations/http";
import { authorizeJuboReview, readJuboReviewQueue } from "@/lib/jubo-review/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeJuboReview();
    return ok(await readJuboReviewQueue(actor), 200, requestId);
  });
}
