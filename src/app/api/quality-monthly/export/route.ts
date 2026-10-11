import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, handleIntegrationRoute, requireRecentAal2 } from "@/lib/integrations/http";
import { qualityMonthlyCsv } from "@/lib/quality-monthly/contract";
import { canReadQualityMonthly, loadQualityMonthlySnapshot } from "@/lib/quality-monthly/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    await requireRecentAal2(actor);
    if (!canReadQualityMonthly(actor) || !actor.scopes.includes("quality_monthly.export")) throw new IntegrationError("QUALITY_MONTHLY_NOT_AUTHORIZED", "這個帳號不能下載月報。", 403);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !["month", "snapshot"].includes(key)) || !query.get("snapshot")) throw new IntegrationError("QUALITY_SNAPSHOT_REQUIRED", "請先建立固定月報快照。", 400);
    let snapshot;
    try { snapshot = await loadQualityMonthlySnapshot(actor, query.get("month") ?? "", query.get("snapshot"), true); }
    catch { throw new IntegrationError("QUALITY_SNAPSHOT_UNAVAILABLE", "無法取得原快照，尚未下載。", 503); }
    return new Response(qualityMonthlyCsv(snapshot), { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="quality-monthly-${snapshot.month}-${snapshot.snapshotId}.csv"`,
      "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId,
    } });
  });
}
