import { getTenantContext } from "@/lib/auth/context";
import { ok } from "@/lib/api/response";
import { handleIntegrationRoute } from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import { loadIntakeCompleteness } from "@/lib/intake-completeness/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await getTenantContext("staff");
    if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
    if (new URL(request.url).search) throw new IntegrationError("INVALID_QUERY", "此報表只核對目前登入分支，請從頁面重新整理。", 400);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return ok(await loadIntakeCompleteness(actor, today), 200, requestId);
  });
}
