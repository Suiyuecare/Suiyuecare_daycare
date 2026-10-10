import { z } from "zod";

import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { assertJuboReviewJsonRequest } from "@/lib/jubo-review/http";
import { authorizeJuboReview, previewJuboProfile } from "@/lib/jubo-review/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ pairId: z.uuid(), sourceRowId: z.uuid() }).strict();

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    assertJuboReviewJsonRequest(request);
    const parsed = requestSchema.safeParse(await readJsonObject(request, 2048));
    if (!parsed.success) {
      throw new IntegrationError("JUBO_REVIEW_INVALID", "請從清單重新選擇來源列。", 400);
    }
    const actor = await authorizeJuboReview();
    return ok(await previewJuboProfile(actor, parsed.data.pairId, parsed.data.sourceRowId), 200, requestId);
  });
}
