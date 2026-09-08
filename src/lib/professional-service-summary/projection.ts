import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  PROFESSIONAL_SUMMARY_SOURCE_KINDS,
  type ProfessionalServiceSummarySnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const positive = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number)
    .pipe(z.number().int().positive().safe()),
]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
});
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) &&
    Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const text = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const serviceStatus = z.enum([
  "active", "suspended", "transferred", "closed", "deceased",
]);
const summaryStatus = z.enum([
  "completed", "pending", "overdue", "not_configured",
]);
const professionalKind = z.enum([
  "occupational_therapy", "physical_therapy", "chewing", "nutrition",
  "consultation", "case_conference", "referral",
]);
const sourcePageByKind = new Map<string, number>([
  ["occupational_therapy_assessment", 33],
  ["physical_therapy_assessment", 34],
  ["chewing_assessment", 35],
  ["mna_assessment", 36],
  ["consultation", 37],
  ["case_conference", 38],
  ["referral", 39],
  ["physical_therapy_service", 40],
  ["occupational_therapy_service", 41],
]);
const sourcePathByKind = new Map<string, string>([
  ["occupational_therapy_assessment", "occupational-assessment"],
  ["physical_therapy_assessment", "physical-assessment"],
  ["chewing_assessment", "chewing"],
  ["mna_assessment", "mna"],
  ["consultation", "consultations"],
  ["case_conference", "case-conferences"],
  ["referral", "referrals"],
  ["physical_therapy_service", "physical-services"],
  ["occupational_therapy_service", "occupational-services"],
]);

const item = z.object({
  item_id: text(160),
  source_kind: z.enum(PROFESSIONAL_SUMMARY_SOURCE_KINDS),
  professional_kind: professionalKind,
  professional_label: text(120),
  source_page: z.number().int().min(33).max(41),
  source_page_title: text(120),
  source_href: z.string().min(1).max(500),
  client_id: uuid,
  client_display_name: text(160),
  service_status: serviceStatus,
  source_record_id: uuid,
  source_record_key: uuid,
  source_version: positive,
  raw_status: text(120),
  summary_status: summaryStatus,
  expectation_status: text(120),
  expected_count: count,
  completed_count: count,
  pending_count: count,
  overdue_count: count,
  service_count: count,
  latest_on: date,
  next_due_on: date.nullable(),
  status_reason: text(500),
  source_hash: hash,
}).strict();

const clientOption = z.object({
  client_id: uuid,
  display_name: text(160),
  service_status: serviceStatus,
}).strict();

const sourceConfiguration = z.object({
  source_kind: z.enum(PROFESSIONAL_SUMMARY_SOURCE_KINDS),
  source_page: z.number().int().min(33).max(41),
  data_status: z.enum([
    "configured", "candidate_only", "license_required_not_configured",
  ]),
  expectation_status: z.enum([
    "manual_due_date_only",
    "not_configured",
    "manual_deadline_or_explicit_missing_state",
    "action_deadline_only",
    "due_rule_not_configured",
    "existing_records_only_frequency_not_configured",
  ]),
}).strict();

const payload = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  month: z.string().regex(/^\d{4}-\d{2}$/u),
  month_start: date,
  month_end: date,
  cutoff_on: date,
  items: z.array(item).max(300),
  item_count: count,
  item_total: count,
  items_truncated: z.boolean(),
  metrics: z.object({
    expected: count,
    completed: count,
    pending: count,
    overdue: count,
    service_records: count,
    not_configured_items: count,
  }).strict(),
  client_options: z.array(clientOption).max(200),
  client_total: count,
  client_options_truncated: z.boolean(),
  source_configuration: z.array(sourceConfiguration).length(9),
  source_configuration_count: z.literal(9),
  configured_source_count: z.literal(7),
  not_configured_source_count: z.literal(2),
  expectation_coverage_status: z.literal("partial_authoritative_rows_only"),
  missing_schedule_claim: z.literal("not_made"),
  export_status: z.literal("immutable_snapshot_available"),
  offline_status: z.literal("not_configured"),
}).strict();

const sourceRow = z.object({
  snapshot_id: uuid,
  snapshot_hash: hash,
  expires_at: timestamp,
  payload,
}).strict();

export type ProfessionalServiceSummarySourceRow = z.input<typeof sourceRow>;

function invalid(): never {
  throw new Error("INVALID_PROFESSIONAL_SERVICE_SUMMARY_PROJECTION");
}

function endOfMonth(month: string) {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5));
  return new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);
}

function validSourceHref(
  value: z.output<typeof item>,
  body: z.output<typeof payload>,
) {
  try {
    const url = new URL(value.source_href, "https://local.invalid");
    const expectedPath = sourcePathByKind.get(value.source_kind);
    const serviceSource = value.source_kind.endsWith("_service");
    const expectedKeys = serviceSource
      ? ["client", "from", "to"] : ["client"];
    const keys = Array.from(url.searchParams.keys());
    return url.origin === "https://local.invalid" && url.hash === "" &&
      url.pathname === `/app/staff/professional-care/${expectedPath}` &&
      keys.length === expectedKeys.length &&
      expectedKeys.every((key) => url.searchParams.getAll(key).length === 1) &&
      keys.every((key) => expectedKeys.includes(key)) &&
      url.searchParams.get("client") === value.client_id &&
      (!serviceSource || (
        url.searchParams.get("from") === body.month_start &&
        url.searchParams.get("to") === body.month_end
      ));
  } catch {
    return false;
  }
}

export function projectProfessionalServiceSummary(input: {
  row: ProfessionalServiceSummarySourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): ProfessionalServiceSummarySnapshot {
  const parsed = sourceRow.safeParse(input.row);
  if (!parsed.success) invalid();
  const row = parsed.data;
  const body = row.payload;
  if (
    body.organization_id !== input.expectedOrganizationId.toLowerCase() ||
    body.branch_id !== input.expectedBranchId.toLowerCase() ||
    body.month_start !== `${body.month}-01` ||
    body.month_end !== endOfMonth(body.month) ||
    body.cutoff_on < body.month_start ||
    body.cutoff_on > body.month_end ||
    body.item_count !== body.items.length ||
    body.item_total < body.item_count ||
    body.items_truncated !== (body.item_total > body.item_count) ||
    body.client_total < body.client_options.length ||
    body.client_options_truncated !==
      (body.client_total > body.client_options.length) ||
    new Set(body.items.map((value) => value.item_id)).size !== body.items.length ||
    new Set(body.source_configuration.map((value) => value.source_kind)).size !== 9 ||
    new Set(body.client_options.map((value) => value.client_id)).size !==
      body.client_options.length ||
    new Date(row.expires_at).getTime() <= new Date(body.generated_at).getTime()
  ) invalid();

  for (const value of body.source_configuration) {
    if (sourcePageByKind.get(value.source_kind) !== value.source_page) invalid();
  }
  for (const value of body.items) {
    if (
      sourcePageByKind.get(value.source_kind) !== value.source_page ||
      !validSourceHref(value, body) ||
      value.expected_count !==
        value.completed_count + value.pending_count + value.overdue_count ||
      (value.summary_status === "overdue" && value.overdue_count < 1) ||
      (value.summary_status === "pending" &&
        (value.pending_count < 1 || value.overdue_count !== 0)) ||
      (value.summary_status === "completed" &&
        (value.expected_count < 1 ||
          value.completed_count !== value.expected_count)) ||
      (value.summary_status === "not_configured" &&
        value.expected_count !== 0) ||
      (value.source_kind.endsWith("_service") &&
        value.service_count !== value.expected_count) ||
      (!value.source_kind.endsWith("_service") && value.service_count !== 0) ||
      value.latest_on > body.cutoff_on
    ) invalid();
  }

  const visible = body.items.reduce((sum, value) => ({
    expected: sum.expected + value.expected_count,
    completed: sum.completed + value.completed_count,
    pending: sum.pending + value.pending_count,
    overdue: sum.overdue + value.overdue_count,
    serviceRecords: sum.serviceRecords + value.service_count,
    notConfiguredItems: sum.notConfiguredItems +
      Number(value.summary_status === "not_configured"),
  }), {
    expected: 0, completed: 0, pending: 0, overdue: 0,
    serviceRecords: 0, notConfiguredItems: 0,
  });
  const metrics = {
    expected: body.metrics.expected,
    completed: body.metrics.completed,
    pending: body.metrics.pending,
    overdue: body.metrics.overdue,
    serviceRecords: body.metrics.service_records,
    notConfiguredItems: body.metrics.not_configured_items,
  };
  if (
    metrics.expected !== metrics.completed + metrics.pending + metrics.overdue ||
    Object.entries(visible).some(([key, value]) =>
      body.items_truncated
        ? value > metrics[key as keyof typeof metrics]
        : value !== metrics[key as keyof typeof metrics])
  ) invalid();

  return {
    snapshotId: row.snapshot_id,
    snapshotHash: row.snapshot_hash,
    expiresAt: row.expires_at,
    organizationId: body.organization_id,
    branchId: body.branch_id,
    generatedAt: body.generated_at,
    staleAfter: new Date(
      new Date(body.generated_at).getTime() + 60_000,
    ).toISOString(),
    month: body.month,
    monthStart: body.month_start,
    monthEnd: body.month_end,
    cutoffOn: body.cutoff_on,
    items: body.items.map((value) => ({
      itemId: value.item_id,
      sourceKind: value.source_kind,
      professionalKind: value.professional_kind,
      professionalLabel: value.professional_label,
      sourcePage: value.source_page,
      sourcePageTitle: value.source_page_title,
      sourceHref: value.source_href,
      clientId: value.client_id,
      clientDisplayName: value.client_display_name,
      serviceStatus: value.service_status,
      sourceRecordId: value.source_record_id,
      sourceRecordKey: value.source_record_key,
      sourceVersion: value.source_version,
      rawStatus: value.raw_status,
      summaryStatus: value.summary_status,
      expectationStatus: value.expectation_status,
      expectedCount: value.expected_count,
      completedCount: value.completed_count,
      pendingCount: value.pending_count,
      overdueCount: value.overdue_count,
      serviceCount: value.service_count,
      latestOn: value.latest_on,
      nextDueOn: value.next_due_on,
      statusReason: value.status_reason,
      sourceHash: value.source_hash,
    })),
    matchingTotal: body.item_total,
    itemsTruncated: body.items_truncated,
    metrics,
    clientOptions: body.client_options.map((value) => ({
      clientId: value.client_id,
      displayName: value.display_name,
      serviceStatus: value.service_status,
    })),
    clientOptionsTruncated: body.client_options_truncated,
    sourceConfiguration: body.source_configuration.map((value) => ({
      sourceKind: value.source_kind,
      sourcePage: value.source_page,
      dataStatus: value.data_status,
      expectationStatus: value.expectation_status,
    })),
    configuredSourceCount: body.configured_source_count,
    notConfiguredSourceCount: body.not_configured_source_count,
    expectationCoverageStatus: body.expectation_coverage_status,
    missingScheduleClaim: body.missing_schedule_claim,
    exportStatus: body.export_status,
    offlineStatus: body.offline_status,
    demo: input.demo,
  };
}
