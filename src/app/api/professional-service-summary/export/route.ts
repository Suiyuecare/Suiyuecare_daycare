import { z } from "zod";

import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import { professionalServiceSummaryCsv } from "@/lib/professional-service-summary/csv";
import { buildDemoProfessionalServiceSummary } from "@/lib/professional-service-summary/demo";
import {
  projectProfessionalServiceSummary,
  type ProfessionalServiceSummarySourceRow,
} from "@/lib/professional-service-summary/projection";
import { parseProfessionalServiceSummaryQuery } from "@/lib/professional-service-summary/query";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.uuid().transform((value) => value.toLowerCase());

function exportFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "PROFESSIONAL_SUMMARY_EXPORT_NOT_AUTHORIZED",
    "快照已過期、不屬於目前使用者，或目前權限不允許匯出。",
    403,
  );
  if (code === "55000") return databaseFailure(
    "PROFESSIONAL_SUMMARY_EXPORT_INTEGRITY_FAILED",
    "彙整快照未通過完整性核對。",
    409,
  );
  return databaseFailure(
    "PROFESSIONAL_SUMMARY_EXPORT_UNAVAILABLE",
    "尚未確認彙整匯出結果；請重新載入頁面後再試。",
    409,
  );
}

function queryRecord(url: URL) {
  const record: Record<string, string | string[]> = {};
  for (const key of ["month", "client", "professional", "status"]) {
    const values = url.searchParams.getAll(key);
    if (values.length === 1) record[key] = values[0]!;
    else if (values.length > 1) record[key] = values;
  }
  return record;
}

export async function GET(request: Request) {
  return handleIntegrationRoute(async () => {
    const url = new URL(request.url);
    const allowed = new Set([
      "snapshot", "month", "client", "professional", "status",
    ]);
    const snapshotValues = url.searchParams.getAll("snapshot");
    if (
      Array.from(url.searchParams.keys()).some((key) => !allowed.has(key)) ||
      snapshotValues.length !== 1
    ) {
      throw new IntegrationError(
        "INVALID_PROFESSIONAL_SUMMARY_EXPORT",
        "彙整快照識別或篩選格式錯誤。",
        400,
      );
    }
    const snapshotId = uuid.safeParse(snapshotValues[0]);
    const { filters, invalid } =
      parseProfessionalServiceSummaryQuery(queryRecord(url));
    if (!snapshotId.success || invalid) {
      throw new IntegrationError(
        "INVALID_PROFESSIONAL_SUMMARY_EXPORT",
        "彙整快照識別或篩選格式錯誤。",
        400,
      );
    }

    const actor = await authorizeStaffRequest();
    if (!actor.demo && (
      !actor.scopes.includes("clients.read") ||
      !actor.scopes.includes("professional_service_summary.read") ||
      !actor.scopes.includes("professional_service_summary.export")
    )) {
      throw new IntegrationError(
        "PROFESSIONAL_SUMMARY_EXPORT_NOT_AUTHORIZED",
        "目前角色沒有專業服務彙整匯出權限。",
        403,
      );
    }
    await requireRecentAal2(actor);

    let snapshot;
    if (actor.demo) {
      snapshot = buildDemoProfessionalServiceSummary(filters);
      if (snapshot.snapshotId !== snapshotId.data) {
        throw new IntegrationError(
          "PROFESSIONAL_SUMMARY_EXPORT_NOT_AUTHORIZED",
          "合成快照識別不一致。",
          403,
        );
      }
    } else {
      const supabase = await createServerSupabaseClient();
      if (!supabase) throw databaseFailure(
        "SERVICE_NOT_CONFIGURED", "正式專業服務彙整尚未設定。", 503,
      );
      const { data, error } = await supabase.rpc(
        "professional_service_summary_export_snapshot",
        {
          p_expected_organization_id: actor.organizationId,
          p_expected_branch_id: actor.branchId,
          p_snapshot_id: snapshotId.data,
        },
      ).maybeSingle<ProfessionalServiceSummarySourceRow>();
      if (error || !data) throw exportFailure(error?.code);
      try {
        snapshot = projectProfessionalServiceSummary({
          row: data,
          expectedOrganizationId: actor.organizationId,
          expectedBranchId: actor.branchId,
          demo: false,
        });
      } catch {
        throw exportFailure("55000");
      }
      if (snapshot.snapshotId !== snapshotId.data) throw exportFailure("55000");
    }

    const csv = professionalServiceSummaryCsv(snapshot);
    return new Response(csv, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition":
          `attachment; filename="professional-service-summary-${snapshot.month}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Summary-Completed-Total": String(snapshot.metrics.completed),
        "X-Summary-Expected-Total": String(snapshot.metrics.expected),
        "X-Summary-Item-Total": String(snapshot.matchingTotal),
        "X-Summary-Overdue-Total": String(snapshot.metrics.overdue),
        "X-Summary-Pending-Total": String(snapshot.metrics.pending),
        "X-Summary-Snapshot-Hash": snapshot.snapshotHash,
      },
    });
  });
}
