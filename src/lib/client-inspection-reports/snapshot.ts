import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { recordClinicalSnapshotFailure } from "@/lib/clinical-snapshot/diagnostics";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoClientInspectionReportSnapshot } from "./demo";
import {
  projectClientInspectionReportSnapshot,
  type ClientInspectionReportSnapshotSourceRow,
} from "./projection";
import type { ClientInspectionReportFilters } from "./types";

export class ClientInspectionReportSnapshotError extends Error {
  constructor(readonly requestId?: string) {
    super("CLIENT_INSPECTION_REPORT_SNAPSHOT_UNAVAILABLE");
    this.name = "ClientInspectionReportSnapshotError";
  }
}

export async function loadClientInspectionReportSnapshot(
  context: TenantContext,
  filters: ClientInspectionReportFilters,
) {
  if (context.demo) return buildDemoClientInspectionReportSnapshot({
    organizationId: context.organizationId,
    branchId: context.branchId,
    filters,
  });
  const fail = (stage: "authorization" | "configuration" | "rpc" | "projection" | "unexpected", result?: { status?: unknown; error?: { code?: unknown } | null }) =>
    new ClientInspectionReportSnapshotError(recordClinicalSnapshotFailure(context, "client_inspection_report", stage, result));
  if (context.assuranceLevel !== "aal2" ||
    !["clients.read", "health.read", "client_reports.read"].every((permission) =>
      context.scopes.includes(permission))) {
    throw fail("authorization");
  }
  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw fail("configuration");
    const result = await supabase.rpc("client_inspection_report_snapshot", {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_client_id: filters.clientId,
      p_report_type: filters.reportType,
      p_examined_from: filters.examinedFrom,
      p_examined_to: filters.examinedTo,
      p_record_status: filters.recordStatus,
      p_result_status: filters.resultStatus,
      p_source_status: filters.sourceStatus,
      p_attachment_status: filters.attachmentStatus,
      p_duplicate_status: filters.duplicateStatus,
      p_search: filters.query || null,
    }).maybeSingle<ClientInspectionReportSnapshotSourceRow>();
    if (result.error || !result.data) throw fail("rpc", result);
    try {
      return projectClientInspectionReportSnapshot({
        row: result.data,
        expectedOrganizationId: context.organizationId,
        expectedBranchId: context.branchId,
        filters,
        demo: false,
      });
    } catch { throw fail("projection"); }
  } catch (error) {
    if (error instanceof ClientInspectionReportSnapshotError) throw error;
    throw fail("unexpected");
  }
}
