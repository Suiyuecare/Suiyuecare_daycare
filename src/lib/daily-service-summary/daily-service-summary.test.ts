import { describe, expect, it } from "vitest";

import { dailyServiceSummaryCsv } from "./csv";
import { buildDemoDailyServiceSummary } from "./demo";
import {
  projectDailyServiceSummary,
  type DailyServiceSummarySourceRow,
} from "./projection";
import { dailyServiceSummaryHref, parseDailyServiceSummaryQuery } from "./query";

const filters = { serviceDate: "2026-09-07", clientId: null,
  completeness: "all" as const };

describe("Page 54 strict query", () => {
  it("accepts the exact day, client and completeness filter", () => {
    const result = parseDailyServiceSummaryQuery({ date: "2026-09-07",
      client: "54100000-0000-4000-8000-000000000001",
      completeness: "limited_access" });
    expect(result.invalid).toBe(false);
    expect(result.filters).toEqual({ serviceDate: "2026-09-07",
      clientId: "54100000-0000-4000-8000-000000000001",
      completeness: "limited_access" });
  });

  it.each([{ date: "2026-02-30" }, { client: "no" },
    { completeness: "zero" }, { date: ["2026-09-07", "2026-09-08"] },
    { branch: "other" }])("fails closed on ambiguous or unknown filters %#", (query) => {
    expect(parseDailyServiceSummaryQuery(query).invalid).toBe(true);
  });

  it("builds a canonical link", () => {
    expect(dailyServiceSummaryHref({ ...filters, completeness: "incomplete" }))
      .toBe("?date=2026-09-07&completeness=incomplete");
  });
});

describe("Page 54 strict projection and demo", () => {
  it("keeps inaccessible sources unknown and outside the denominator", () => {
    const snapshot = buildDemoDailyServiceSummary(filters);
    const limited = snapshot.rows.find((row) => row.notAuthorizedSourceCount > 0)!;
    const hidden = limited.cells.find((cell) => cell.accessStatus === "not_authorized")!;
    expect(hidden).toMatchObject({ evidenceStatus: "unknown", recordCount: null,
      completedCount: null, pendingCount: null, sourceHash: null });
    expect(limited.authorizedSourceCount + limited.notAuthorizedSourceCount).toBe(8);
    expect(limited.completenessPercent).toBe(Math.floor(
      limited.coveredSourceCount * 100 / limited.authorizedSourceCount,
    ));
  });

  it("uses a deterministic, synthetic, read-only snapshot per filter", () => {
    const first = buildDemoDailyServiceSummary(filters);
    const second = buildDemoDailyServiceSummary(filters);
    expect(first).toMatchObject({ snapshotId: second.snapshotId,
      snapshotHash: second.snapshotHash, generatedAt: second.generatedAt,
      consistencyStatus: "single_database_statement_snapshot",
      offlineStatus: "not_configured", demo: true });
    expect(first.rows).toHaveLength(3);
    expect(first.rows.every((row) => row.cells.length === 8)).toBe(true);
  });

  it("applies completeness and client filters to the same domain rows", () => {
    const unfiltered = buildDemoDailyServiceSummary(filters);
    const client = unfiltered.rows[1]!;
    const filtered = buildDemoDailyServiceSummary({ ...filters,
      clientId: client.clientId, completeness: "limited_access" });
    expect(filtered.rows.map((row) => row.clientId)).toEqual([client.clientId]);
    expect(filtered.snapshotId).not.toBe(unfiltered.snapshotId);
  });

  it.each([
    ["tenant", (row: DailyServiceSummarySourceRow) => {
      row.payload.organization_id = "54100000-0000-4000-8000-000000000099";
    }],
    ["forged page", (row: DailyServiceSummarySourceRow) => {
      row.payload.rows[0]!.cells[0]!.source_page = 3;
    }],
    ["external drilldown", (row: DailyServiceSummarySourceRow) => {
      row.payload.rows[0]!.cells[0]!.source_href = "https://evil.invalid/";
    }],
    ["hidden zero", (row: DailyServiceSummarySourceRow) => {
      const cell = row.payload.rows[1]!.cells.find((value) =>
        value.access_status === "not_authorized")!;
      cell.record_count = 0;
    }],
    ["denominator", (row: DailyServiceSummarySourceRow) => {
      row.payload.rows[1]!.authorized_source_count = 8;
    }],
    ["expiry", (row: DailyServiceSummarySourceRow) => {
      row.expires_at = "2026-09-07T10:00:00.000Z";
    }],
  ])("rejects forged %s evidence", (_name, mutate) => {
    const demo = buildDemoDailyServiceSummary(filters);
    const raw = structuredClone((demo as unknown as { __raw: never }).__raw) as
      DailyServiceSummarySourceRow | undefined;
    // Rebuild an accepted raw row from the deterministic demo fields.
    const row = ((): DailyServiceSummarySourceRow => {
      const snapshot = buildDemoDailyServiceSummary(filters);
      const cells = snapshot.rows.map((value) => ({
        client_id: value.clientId, display_name: value.displayName,
        client_code: value.clientCode, service_status: value.serviceStatus,
        cells: value.cells.map((cell) => ({ source_kind: cell.sourceKind,
          source_page: cell.sourcePage, source_label: cell.sourceLabel,
          source_href: cell.sourceHref, access_status: cell.accessStatus,
          evidence_status: cell.evidenceStatus, record_count: cell.recordCount,
          completed_count: cell.completedCount, pending_count: cell.pendingCount,
          exception_count: cell.exceptionCount, source_record_ids: [...cell.sourceRecordIds],
          source_records_truncated: cell.sourceRecordsTruncated,
          source_hash: cell.sourceHash, status_text: cell.statusText })),
        authorized_source_count: value.authorizedSourceCount,
        covered_source_count: value.coveredSourceCount,
        not_authorized_source_count: value.notAuthorizedSourceCount,
        completeness_percent: value.completenessPercent,
      }));
      return { snapshot_id: snapshot.snapshotId, snapshot_hash: snapshot.snapshotHash,
        expires_at: snapshot.expiresAt, payload: {
          organization_id: snapshot.organizationId, branch_id: snapshot.branchId,
          generated_at: snapshot.generatedAt, service_date: snapshot.filters.serviceDate,
          filter_client_id: snapshot.filters.clientId,
          completeness_filter: snapshot.filters.completeness, rows: cells,
          row_count: cells.length, row_total: snapshot.matchingRowTotal,
          rows_truncated: snapshot.rowsTruncated, metrics: {
            client_total: snapshot.metrics.clientTotal,
            authorized_cell_total: snapshot.metrics.authorizedCellTotal,
            covered_cell_total: snapshot.metrics.coveredCellTotal,
            not_authorized_cell_total: snapshot.metrics.notAuthorizedCellTotal,
            recorded_attendance_clients: snapshot.metrics.recordedAttendanceClients,
            recorded_vital_clients: snapshot.metrics.recordedVitalClients,
            activity_participant_clients: snapshot.metrics.activityParticipantClients,
            meal_assigned_clients: snapshot.metrics.mealAssignedClients,
            transport_passenger_clients: snapshot.metrics.transportPassengerClients,
            abnormal_event_total: snapshot.metrics.abnormalEventTotal,
          }, client_options: snapshot.clientOptions.map((value) => ({
            client_id: value.clientId, display_name: value.displayName,
            client_code: value.clientCode, service_status: value.serviceStatus,
          })), client_total: snapshot.clientOptions.length,
          client_options_truncated: snapshot.clientOptionsTruncated,
          source_configuration: snapshot.sourceConfiguration.map((value) => ({
            source_kind: value.sourceKind, source_page: value.sourcePage,
            source_label: value.sourceLabel, permission: value.permission,
            configuration_status: value.configurationStatus,
          })), consistency_status: snapshot.consistencyStatus,
          export_status: snapshot.exportStatus, offline_status: snapshot.offlineStatus,
        } };
    })();
    expect(raw).toBeUndefined();
    mutate(row);
    expect(() => projectDailyServiceSummary({ row,
      expectedOrganizationId: demo.organizationId,
      expectedBranchId: demo.branchId, demo: false }))
      .toThrow("INVALID_DAILY_SERVICE_SUMMARY_PROJECTION");
  });
});

describe("Page 54 CSV", () => {
  it("exports identity, exact cells, unknown state and spreadsheet-safe text", () => {
    const snapshot = buildDemoDailyServiceSummary(filters);
    const csv = dailyServiceSummaryCsv({ ...snapshot,
      rows: [{ ...snapshot.rows[1]!, displayName: '=2+3,"甲"' }],
      matchingRowTotal: 1 });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(snapshot.snapshotId);
    expect(csv).toContain(snapshot.snapshotHash);
    expect(csv).toContain("單一資料庫陳述式快照");
    expect(csv).toContain("未授權（未知）");
    expect(csv).toContain("'=2+3");
  });
});
