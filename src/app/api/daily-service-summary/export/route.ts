import { z } from "zod";

import { dailyServiceSummaryCsv } from "@/lib/daily-service-summary/csv";
import { buildDemoDailyServiceSummary } from "@/lib/daily-service-summary/demo";
import {
  projectDailyServiceSummary,
  type DailyServiceSummarySourceRow,
} from "@/lib/daily-service-summary/projection";
import { parseDailyServiceSummaryQuery } from "@/lib/daily-service-summary/query";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest, databaseFailure, handleIntegrationRoute, requireRecentAal2,
} from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.uuid().transform((value) => value.toLowerCase());

function failure(code?: string) {
  if (code === "42501") return databaseFailure(
    "DAILY_SUMMARY_EXPORT_NOT_AUTHORIZED",
    "快照已過期、不屬於目前工作階段，或目前來源權限不允許匯出。", 403,
  );
  if (code === "55000") return databaseFailure(
    "DAILY_SUMMARY_EXPORT_INTEGRITY_FAILED", "每日彙整快照未通過完整性核對。", 409,
  );
  return databaseFailure("DAILY_SUMMARY_EXPORT_UNAVAILABLE",
    "尚未確認每日彙整匯出結果；請重新載入頁面後再試。", 409);
}

function queryRecord(url: URL) {
  const result: Record<string, string | string[]> = {};
  for (const key of ["date", "client", "completeness"]) {
    const values = url.searchParams.getAll(key);
    if (values.length === 1) result[key] = values[0]!;
    else if (values.length > 1) result[key] = values;
  }
  return result;
}

export async function GET(request: Request) {
  return handleIntegrationRoute(async () => {
    const url = new URL(request.url);
    const allowed = new Set(["snapshot", "date", "client", "completeness"]);
    const snapshotValues = url.searchParams.getAll("snapshot");
    if ([...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
      snapshotValues.length !== 1) throw new IntegrationError(
      "INVALID_DAILY_SUMMARY_EXPORT", "每日彙整快照識別或篩選格式錯誤。", 400,
    );
    const snapshotId = uuid.safeParse(snapshotValues[0]);
    const { filters, invalid } = parseDailyServiceSummaryQuery(queryRecord(url));
    if (!snapshotId.success || invalid) throw new IntegrationError(
      "INVALID_DAILY_SUMMARY_EXPORT", "每日彙整快照識別或篩選格式錯誤。", 400,
    );

    const actor = await authorizeStaffRequest();
    if (!actor.demo && (!actor.scopes.includes("clients.read") ||
      !actor.scopes.includes("daily_service_summary.read") ||
      !actor.scopes.includes("daily_service_summary.export"))) {
      throw new IntegrationError("DAILY_SUMMARY_EXPORT_NOT_AUTHORIZED",
        "目前角色沒有每日服務彙整匯出權限。", 403);
    }
    await requireRecentAal2(actor);

    let snapshot;
    if (actor.demo) {
      snapshot = buildDemoDailyServiceSummary(filters);
      if (snapshot.snapshotId !== snapshotId.data) throw new IntegrationError(
        "DAILY_SUMMARY_EXPORT_NOT_AUTHORIZED", "合成快照識別不一致。", 403);
    } else {
      const supabase = await createServerSupabaseClient();
      if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED",
        "正式每日服務彙整尚未設定。", 503);
      const { data, error } = await supabase.rpc(
        "daily_service_summary_export_snapshot_v2", {
          p_expected_organization_id: actor.organizationId,
          p_expected_branch_id: actor.branchId,
          p_snapshot_id: snapshotId.data,
        },
      ).maybeSingle<DailyServiceSummarySourceRow>();
      if (error || !data) throw failure(error?.code);
      try {
        snapshot = projectDailyServiceSummary({ row: data,
          expectedOrganizationId: actor.organizationId,
          expectedBranchId: actor.branchId, demo: false });
      } catch {
        throw failure("55000");
      }
      if (snapshot.snapshotId !== snapshotId.data ||
        snapshot.filters.serviceDate !== filters.serviceDate ||
        snapshot.filters.clientId !== filters.clientId ||
        snapshot.filters.completeness !== filters.completeness) {
        throw failure("55000");
      }
    }

    return new Response(dailyServiceSummaryCsv(snapshot), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition":
          `attachment; filename="daily-service-summary-${snapshot.filters.serviceDate}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Summary-Client-Total": String(snapshot.matchingRowTotal),
        "X-Summary-Covered-Cell-Total": String(snapshot.metrics.coveredCellTotal),
        "X-Summary-Snapshot-Hash": snapshot.snapshotHash,
      },
    });
  });
}
