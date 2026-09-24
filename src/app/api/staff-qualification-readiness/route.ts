import { ok } from "@/lib/api/response";
import { authorizeStaffRequest, handleIntegrationRoute } from "@/lib/integrations/http";
import { parseQualificationFilters } from "@/lib/staff-qualification-readiness/filters";
import { loadQualificationReport } from "@/lib/staff-qualification-readiness/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    const params = new URL(request.url).searchParams;
    const query: Record<string, unknown> = {};
    for (const key of params.keys()) query[key] = params.getAll(key).length === 1 ? params.get(key) : params.getAll(key);
    const filters = parseQualificationFilters(query);
    return ok(await loadQualificationReport(actor, filters), 200, requestId);
  });
}
