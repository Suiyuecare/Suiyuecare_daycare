import { createHash } from "node:crypto";

import {
  projectDailyServiceSummary,
  type DailyServiceSummarySourceRow,
} from "./projection";
import type {
  DailyServiceSummaryFilters,
  DailySummarySourceKind,
} from "./types";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const clients = [
  { client_id: "54100000-0000-4000-8000-000000000001",
    display_name: "合成個案・晨光", client_code: "DEMO-054-01", service_status: "active" as const },
  { client_id: "54100000-0000-4000-8000-000000000002",
    display_name: "合成個案・青禾", client_code: "DEMO-054-02", service_status: "active" as const },
  { client_id: "54100000-0000-4000-8000-000000000003",
    display_name: "合成個案・安晴", client_code: "DEMO-054-03", service_status: "suspended" as const },
];

const sourceRules = [
  ["attendance", 46, "出勤", "attendance.read"],
  ["vital_signs", 3, "生命徵象", "health.read"],
  ["care_diary", 6, "照顧日誌", "care_records.read"],
  ["service_events", 53, "服務使用", "services.read"],
  ["activities", 30, "活動參與", "activity.read"],
  ["meals", 57, "餐食", "meals.read"],
  ["transport", 48, "接送", "transport_execution.read"],
  ["abnormal_events", 27, "異常事件", "quality_events.read"],
] as const satisfies readonly [DailySummarySourceKind, number, string, string][];

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function uuidFrom(value: unknown) {
  const valueHash = digest(value);
  return `${valueHash.slice(0, 8)}-${valueHash.slice(8, 12)}-4${
    valueHash.slice(13, 16)}-8${valueHash.slice(17, 20)}-${valueHash.slice(20, 32)}`;
}

function sourceHref(kind: DailySummarySourceKind, clientId: string, date: string) {
  const client = encodeURIComponent(clientId);
  const day = encodeURIComponent(date);
  return {
    attendance: `/app/staff/service-management/attendance?date=${day}&client=${client}`,
    vital_signs: `/app/staff/daily-care/vital-signs?date=${day}&client=${client}`,
    care_diary: `/app/staff/daily-care/care-diary?date=${day}&client=${client}`,
    service_events: `/app/staff/service-management/service-usage?date=${day}&client=${client}`,
    activities: `/app/staff/social-work/activities?from=${day}&to=${day}&client=${client}`,
    meals: `/app/staff/service-management/meals?date=${day}`,
    transport: `/app/staff/service-management/transport-execution?date=${day}`,
    abnormal_events: `/app/staff/quality/incidents?from=${day}&to=${day}&affected=client`,
  }[kind];
}

const sampleCounts: ReadonlyArray<Record<DailySummarySourceKind,
  readonly [number, number, number, number]>> = [
  { attendance: [1, 1, 0, 0], vital_signs: [1, 1, 0, 0],
    care_diary: [1, 1, 0, 0], service_events: [2, 2, 0, 0],
    activities: [1, 1, 0, 0], meals: [1, 1, 0, 0],
    transport: [1, 1, 0, 0], abnormal_events: [0, 0, 0, 0] },
  { attendance: [1, 1, 0, 0], vital_signs: [1, 1, 0, 0],
    care_diary: [1, 0, 1, 1], service_events: [2, 1, 1, 0],
    activities: [1, 0, 1, 0], meals: [0, 0, 0, 0],
    transport: [0, 0, 0, 0], abnormal_events: [1, 0, 1, 1] },
  { attendance: [1, 1, 0, 0], vital_signs: [0, 0, 0, 0],
    care_diary: [1, 1, 0, 0], service_events: [0, 0, 0, 0],
    activities: [1, 1, 0, 0], meals: [1, 0, 1, 0],
    transport: [0, 0, 0, 0], abnormal_events: [0, 0, 0, 0] },
];

export function buildDemoDailyServiceSummary(filters: DailyServiceSummaryFilters) {
  const rows = clients.map((client, clientIndex) => {
    const cells = sourceRules.map(([kind, page, label]) => {
      const unavailable = (clientIndex === 1 && ["meals", "transport"].includes(kind)) ||
        (clientIndex === 2 && ["service_events", "transport", "abnormal_events"].includes(kind));
      const counts = sampleCounts[clientIndex]![kind];
      const recordIds = unavailable ? [] : Array.from({ length: counts[0] }, (_, index) =>
        uuidFrom([client.client_id, kind, index]));
      const sourceHash = unavailable || counts[0] === 0 ? null : digest({
        client: client.client_id, kind, counts, recordIds,
      });
      return {
        source_kind: kind, source_page: page, source_label: label,
        source_href: sourceHref(kind, client.client_id, filters.serviceDate),
        access_status: unavailable ? "not_authorized" as const : "authorized" as const,
        evidence_status: unavailable ? "unknown" as const
          : counts[0] > 0 ? "recorded" as const : "no_record" as const,
        record_count: unavailable ? null : counts[0],
        completed_count: unavailable ? null : counts[1],
        pending_count: unavailable ? null : counts[2],
        exception_count: unavailable ? null : counts[3],
        source_record_ids: recordIds, source_records_truncated: false,
        source_hash: sourceHash,
        status_text: unavailable ? "未授權，數量未知"
          : counts[0] === 0 ? "已查詢，當日無來源紀錄"
            : counts[2] > 0 ? `${counts[0]} 筆，其中 ${counts[2]} 筆待完成`
              : `${counts[0]} 筆來源紀錄`,
      };
    });
    const authorized = cells.filter((cell) => cell.access_status === "authorized").length;
    const covered = cells.filter((cell) =>
      cell.access_status === "authorized" && (cell.record_count ?? 0) > 0).length;
    return { ...client, cells, authorized_source_count: authorized,
      covered_source_count: covered,
      not_authorized_source_count: 8 - authorized,
      completeness_percent: authorized ? Math.floor(covered * 100 / authorized) : null };
  }).filter((row) => filters.clientId === null || row.client_id === filters.clientId)
    .filter((row) => filters.completeness === "all" ||
      (filters.completeness === "complete" && row.authorized_source_count > 0 &&
        row.covered_source_count === row.authorized_source_count) ||
      (filters.completeness === "incomplete" && row.authorized_source_count > 0 &&
        row.covered_source_count < row.authorized_source_count) ||
      (filters.completeness === "limited_access" && row.not_authorized_source_count > 0));
  const allCells = rows.flatMap((row) => row.cells);
  const metric = (kind: DailySummarySourceKind, events = false) => {
    const cells = allCells.filter((cell) => cell.source_kind === kind &&
      cell.access_status === "authorized");
    if (!cells.length) return null;
    return events ? cells.reduce((sum, cell) => sum + (cell.record_count ?? 0), 0)
      : cells.filter((cell) => (cell.record_count ?? 0) > 0).length;
  };
  const generatedAt = new Date(`${filters.serviceDate}T17:00:00+08:00`).toISOString();
  const payload: DailyServiceSummarySourceRow["payload"] = {
    organization_id: organizationId, branch_id: branchId,
    generated_at: generatedAt, service_date: filters.serviceDate,
    filter_client_id: filters.clientId, completeness_filter: filters.completeness,
    rows, row_count: rows.length, row_total: rows.length, rows_truncated: false,
    metrics: { client_total: rows.length,
      authorized_cell_total: allCells.filter((cell) =>
        cell.access_status === "authorized").length,
      covered_cell_total: allCells.filter((cell) =>
        cell.access_status === "authorized" && (cell.record_count ?? 0) > 0).length,
      not_authorized_cell_total: allCells.filter((cell) =>
        cell.access_status !== "authorized").length,
      recorded_attendance_clients: metric("attendance"),
      recorded_vital_clients: metric("vital_signs"),
      activity_participant_clients: metric("activities"),
      meal_assigned_clients: metric("meals"),
      transport_passenger_clients: metric("transport"),
      abnormal_event_total: metric("abnormal_events", true) },
    client_options: clients, client_total: clients.length,
    client_options_truncated: false,
    source_configuration: sourceRules.map(([kind, page, label, permission]) => ({
      source_kind: kind, source_page: page, source_label: label, permission,
      configuration_status: "configured" as const,
    })), consistency_status: "single_database_statement_snapshot",
    export_status: "immutable_snapshot_available", offline_status: "not_configured",
  };
  const snapshotHash = digest(payload);
  return projectDailyServiceSummary({
    expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: true,
    row: { snapshot_id: uuidFrom([filters, "page54"]), snapshot_hash: snapshotHash,
      expires_at: new Date(Date.parse(generatedAt) + 15 * 60_000).toISOString(), payload },
  });
}
