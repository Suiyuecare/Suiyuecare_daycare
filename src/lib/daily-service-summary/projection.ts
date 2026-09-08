import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  DAILY_SUMMARY_SOURCE_KINDS,
  type DailyServiceSummarySnapshot,
  type DailySummarySourceKind,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const nullableCount = z.union([count, z.null()]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const text = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const serviceStatus = z.enum([
  "active", "suspended", "transferred", "closed", "deceased",
]);
const accessStatus = z.enum(["authorized", "not_authorized", "not_configured"]);
const evidenceStatus = z.enum(["recorded", "no_record", "unknown"]);

const expectedSources = {
  attendance: { page: 46, label: "出勤", permission: "attendance.read" },
  vital_signs: { page: 3, label: "生命徵象", permission: "health.read" },
  care_diary: { page: 6, label: "照顧日誌", permission: "care_records.read" },
  service_events: { page: 53, label: "服務使用", permission: "services.read" },
  activities: { page: 30, label: "活動參與", permission: "activity.read" },
  meals: { page: 57, label: "餐食", permission: "meals.read" },
  transport: { page: 48, label: "接送", permission: "transport_execution.read" },
  abnormal_events: { page: 27, label: "異常事件", permission: "quality_events.read" },
} satisfies Record<DailySummarySourceKind, {
  page: number; label: string; permission: string;
}>;

const config = z.object({
  source_kind: z.enum(DAILY_SUMMARY_SOURCE_KINDS),
  source_page: z.number().int().min(1).max(89),
  source_label: text(80),
  permission: z.string().regex(/^[a-z][a-z0-9_.]{1,79}$/u),
  configuration_status: z.enum(["configured", "not_configured"]),
}).strict();

const cell = z.object({
  source_kind: z.enum(DAILY_SUMMARY_SOURCE_KINDS),
  source_page: z.number().int().min(1).max(89),
  source_label: text(80),
  source_href: z.string().min(1).max(500),
  access_status: accessStatus,
  evidence_status: evidenceStatus,
  record_count: nullableCount,
  completed_count: nullableCount,
  pending_count: nullableCount,
  exception_count: nullableCount,
  source_record_ids: z.array(uuid).max(50),
  source_records_truncated: z.boolean(),
  source_hash: hash.nullable(),
  status_text: text(240),
}).strict();

const client = z.object({
  client_id: uuid,
  display_name: text(160),
  client_code: text(120),
  service_status: serviceStatus,
}).strict();

const row = client.extend({
  cells: z.array(cell).length(8),
  authorized_source_count: z.number().int().min(0).max(8),
  covered_source_count: z.number().int().min(0).max(8),
  not_authorized_source_count: z.number().int().min(0).max(8),
  completeness_percent: z.number().int().min(0).max(100).nullable(),
}).strict();

const payload = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  service_date: date,
  filter_client_id: uuid.nullable(),
  completeness_filter: z.enum(["all", "complete", "incomplete", "limited_access"]),
  rows: z.array(row).max(200),
  row_count: count,
  row_total: count,
  rows_truncated: z.boolean(),
  metrics: z.object({
    client_total: count,
    authorized_cell_total: count,
    covered_cell_total: count,
    not_authorized_cell_total: count,
    recorded_attendance_clients: nullableCount,
    recorded_vital_clients: nullableCount,
    activity_participant_clients: nullableCount,
    meal_assigned_clients: nullableCount,
    transport_passenger_clients: nullableCount,
    abnormal_event_total: nullableCount,
  }).strict(),
  client_options: z.array(client).max(200),
  client_total: count,
  client_options_truncated: z.boolean(),
  source_configuration: z.array(config).length(8),
  consistency_status: z.literal("single_database_statement_snapshot"),
  export_status: z.literal("immutable_snapshot_available"),
  offline_status: z.literal("not_configured"),
}).strict();

const sourceRow = z.object({
  snapshot_id: uuid,
  snapshot_hash: hash,
  expires_at: timestamp,
  payload,
}).strict();

export type DailyServiceSummarySourceRow = z.input<typeof sourceRow>;

function invalid(): never {
  throw new Error("INVALID_DAILY_SERVICE_SUMMARY_PROJECTION");
}

function validHref(value: z.output<typeof cell>, clientId: string, serviceDate: string) {
  const expected: Record<DailySummarySourceKind, { path: string; params: Record<string, string> }> = {
    attendance: { path: "/app/staff/service-management/attendance",
      params: { date: serviceDate, client: clientId } },
    vital_signs: { path: "/app/staff/daily-care/vital-signs",
      params: { date: serviceDate, client: clientId } },
    care_diary: { path: "/app/staff/daily-care/care-diary",
      params: { date: serviceDate, client: clientId } },
    service_events: { path: "/app/staff/service-management/service-usage",
      params: { date: serviceDate, client: clientId } },
    activities: { path: "/app/staff/social-work/activities",
      params: { from: serviceDate, to: serviceDate, client: clientId } },
    meals: { path: "/app/staff/service-management/meals",
      params: { date: serviceDate } },
    transport: { path: "/app/staff/service-management/transport-execution",
      params: { date: serviceDate } },
    abnormal_events: { path: "/app/staff/quality/incidents",
      params: { from: serviceDate, to: serviceDate, affected: "client" } },
  };
  try {
    const url = new URL(value.source_href, "https://local.invalid");
    const rule = expected[value.source_kind];
    const keys = [...url.searchParams.keys()];
    return url.origin === "https://local.invalid" && url.hash === "" &&
      url.pathname === rule.path && keys.length === Object.keys(rule.params).length &&
      keys.every((key) => Object.hasOwn(rule.params, key) &&
        url.searchParams.getAll(key).length === 1) &&
      Object.entries(rule.params).every(([key, expectedValue]) =>
        url.searchParams.get(key) === expectedValue);
  } catch {
    return false;
  }
}

function visibleMetrics(rows: readonly z.output<typeof row>[]) {
  const cells = rows.flatMap((value) => value.cells);
  const metric = (kind: DailySummarySourceKind, mode: "clients" | "events") => {
    const source = cells.filter((value) => value.source_kind === kind);
    const authorized = source.filter((value) => value.access_status === "authorized");
    if (!authorized.length) return null;
    return mode === "events"
      ? authorized.reduce((sum, value) => sum + (value.record_count ?? 0), 0)
      : authorized.filter((value) => (value.record_count ?? 0) > 0).length;
  };
  return {
    clientTotal: rows.length,
    authorizedCellTotal: cells.filter((value) => value.access_status === "authorized").length,
    coveredCellTotal: cells.filter((value) =>
      value.access_status === "authorized" && (value.record_count ?? 0) > 0).length,
    notAuthorizedCellTotal: cells.filter((value) =>
      value.access_status !== "authorized").length,
    recordedAttendanceClients: metric("attendance", "clients"),
    recordedVitalClients: metric("vital_signs", "clients"),
    activityParticipantClients: metric("activities", "clients"),
    mealAssignedClients: metric("meals", "clients"),
    transportPassengerClients: metric("transport", "clients"),
    abnormalEventTotal: metric("abnormal_events", "events"),
  };
}

export function projectDailyServiceSummary(input: {
  row: DailyServiceSummarySourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): DailyServiceSummarySnapshot {
  const parsed = sourceRow.safeParse(input.row);
  if (!parsed.success) invalid();
  const result = parsed.data;
  const body = result.payload;
  if (body.organization_id !== input.expectedOrganizationId.toLowerCase() ||
    body.branch_id !== input.expectedBranchId.toLowerCase() ||
    body.row_count !== body.rows.length || body.row_total < body.row_count ||
    body.rows_truncated !== (body.row_total > body.row_count) ||
    body.client_total < body.client_options.length ||
    body.client_options_truncated !== (body.client_total > body.client_options.length) ||
    new Date(result.expires_at).getTime() <= new Date(body.generated_at).getTime() ||
    new Date(result.expires_at).getTime() >
      new Date(body.generated_at).getTime() + 20 * 60_000 ||
    new Set(body.rows.map((value) => value.client_id)).size !== body.rows.length ||
    new Set(body.client_options.map((value) => value.client_id)).size !==
      body.client_options.length ||
    new Set(body.source_configuration.map((value) => value.source_kind)).size !== 8) {
    invalid();
  }

  for (const source of body.source_configuration) {
    const expected = expectedSources[source.source_kind];
    if (source.source_page !== expected.page || source.source_label !== expected.label ||
      source.permission !== expected.permission) invalid();
  }
  for (const value of body.rows) {
    if (new Set(value.cells.map((entry) => entry.source_kind)).size !== 8) invalid();
    let authorized = 0;
    let covered = 0;
    let hidden = 0;
    for (const entry of value.cells) {
      const expected = expectedSources[entry.source_kind];
      const configuration = body.source_configuration.find((source) =>
        source.source_kind === entry.source_kind)!;
      const counts = [entry.record_count, entry.completed_count,
        entry.pending_count, entry.exception_count];
      const known = entry.access_status === "authorized";
      if (entry.source_page !== expected.page || entry.source_label !== expected.label ||
        (configuration.configuration_status === "not_configured" &&
          entry.access_status !== "not_configured") ||
        (configuration.configuration_status === "configured" &&
          entry.access_status === "not_configured") ||
        !validHref(entry, value.client_id, body.service_date) ||
        known !== counts.every((item) => item !== null) ||
        known !== (entry.evidence_status !== "unknown") ||
        known !== (entry.source_hash !== null || entry.record_count === 0) ||
        (known && entry.source_records_truncated !==
          (entry.record_count! > entry.source_record_ids.length)) ||
        (!known && entry.source_records_truncated) ||
        (known && entry.record_count !== entry.completed_count! + entry.pending_count!) ||
        (known && entry.evidence_status === "recorded" !== (entry.record_count! > 0)) ||
        (!known && entry.source_record_ids.length > 0)) invalid();
      if (known) {
        authorized += 1;
        if (entry.record_count! > 0) covered += 1;
      } else hidden += 1;
    }
    const percent = authorized === 0 ? null : Math.floor(covered * 100 / authorized);
    if (authorized !== value.authorized_source_count ||
      covered !== value.covered_source_count || hidden !== value.not_authorized_source_count ||
      percent !== value.completeness_percent ||
      authorized + hidden !== 8) invalid();
  }

  const visible = visibleMetrics(body.rows);
  const metrics = {
    clientTotal: body.metrics.client_total,
    authorizedCellTotal: body.metrics.authorized_cell_total,
    coveredCellTotal: body.metrics.covered_cell_total,
    notAuthorizedCellTotal: body.metrics.not_authorized_cell_total,
    recordedAttendanceClients: body.metrics.recorded_attendance_clients,
    recordedVitalClients: body.metrics.recorded_vital_clients,
    activityParticipantClients: body.metrics.activity_participant_clients,
    mealAssignedClients: body.metrics.meal_assigned_clients,
    transportPassengerClients: body.metrics.transport_passenger_clients,
    abnormalEventTotal: body.metrics.abnormal_event_total,
  };
  if (body.rows_truncated
    ? Object.entries(visible).some(([key, value]) => {
      const full = metrics[key as keyof typeof metrics];
      return value !== null && full !== null && value > full;
    })
    : Object.entries(visible).some(([key, value]) =>
      value !== metrics[key as keyof typeof metrics])) invalid();

  return {
    snapshotId: result.snapshot_id, snapshotHash: result.snapshot_hash,
    expiresAt: result.expires_at, organizationId: body.organization_id,
    branchId: body.branch_id, generatedAt: body.generated_at,
    staleAfter: new Date(Date.parse(body.generated_at) + 60_000).toISOString(),
    filters: { serviceDate: body.service_date,
      clientId: body.filter_client_id, completeness: body.completeness_filter },
    rows: body.rows.map((value) => ({
      clientId: value.client_id, displayName: value.display_name,
      clientCode: value.client_code, serviceStatus: value.service_status,
      cells: value.cells.map((entry) => ({
        sourceKind: entry.source_kind, sourcePage: entry.source_page,
        sourceLabel: entry.source_label, sourceHref: entry.source_href,
        accessStatus: entry.access_status, evidenceStatus: entry.evidence_status,
        recordCount: entry.record_count, completedCount: entry.completed_count,
        pendingCount: entry.pending_count, exceptionCount: entry.exception_count,
        sourceRecordIds: entry.source_record_ids,
        sourceRecordsTruncated: entry.source_records_truncated,
        sourceHash: entry.source_hash, statusText: entry.status_text,
      })), authorizedSourceCount: value.authorized_source_count,
      coveredSourceCount: value.covered_source_count,
      notAuthorizedSourceCount: value.not_authorized_source_count,
      completenessPercent: value.completeness_percent,
    })), matchingRowTotal: body.row_total, rowsTruncated: body.rows_truncated,
    metrics, clientOptions: body.client_options.map((value) => ({
      clientId: value.client_id, displayName: value.display_name,
      clientCode: value.client_code, serviceStatus: value.service_status,
    })), clientOptionsTruncated: body.client_options_truncated,
    sourceConfiguration: body.source_configuration.map((value) => ({
      sourceKind: value.source_kind, sourcePage: value.source_page,
      sourceLabel: value.source_label, permission: value.permission,
      configurationStatus: value.configuration_status,
    })), consistencyStatus: body.consistency_status,
    exportStatus: body.export_status, offlineStatus: body.offline_status,
    demo: input.demo,
  };
}
