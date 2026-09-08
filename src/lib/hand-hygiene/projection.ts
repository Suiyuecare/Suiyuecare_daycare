import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import type { HandHygieneFilters, HandHygieneSnapshot } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const safeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const eventKind = z.enum(["hygiene_performed", "opportunity"]);
const matchStatus = z.enum(["matched", "unmatched", "excluded"]);

const eventSchema = z.object({
  event_id: uuid,
  source_provider: safeText(120),
  source_event_id: safeText(240),
  device_code: safeText(120),
  event_kind: eventKind,
  occurred_at: timestamp,
  received_at: timestamp,
  match_status: matchStatus,
  staff_membership_id: uuid.nullable(),
  staff_display_name: safeText(120).nullable(),
  staff_employee_code: safeText(120).nullable(),
  correction_sequence: count,
  correction_reason: narrative(1_000).nullable(),
  corrected_by_display_name: safeText(120).nullable(),
  corrected_at: timestamp.nullable(),
}).strict();

const staffSchema = z.object({
  staff_membership_id: uuid,
  display_name: safeText(120),
  employee_code: safeText(120).nullable(),
  is_current: z.boolean(),
}).strict();

const deviceSchema = z.object({
  device_code: safeText(120),
  event_count: count,
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  events: z.array(eventSchema).max(200),
  event_total: count,
  events_truncated: z.boolean(),
  performed_event_total: count,
  matched_performed_total: count,
  observed_opportunity_event_total: count,
  unmatched_total: count,
  excluded_total: count,
  denominator_total: z.null(),
  attainment_rate: z.null(),
  staff_options: z.array(staffSchema).max(500),
  staff_total: count,
  staff_truncated: z.boolean(),
  device_options: z.array(deviceSchema).max(200),
  device_total: count,
  devices_truncated: z.boolean(),
  numerator_definition: z.literal("matched_distinct_hygiene_performed_events"),
  denominator_policy_status: z.literal("not_configured"),
  denominator_definition: z.null(),
  source_integration_status: z.literal("database_contract_only"),
  export_status: z.literal("not_configured"),
}).strict();

export type HandHygieneSnapshotSource = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_HAND_HYGIENE_SNAPSHOT");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

export function projectHandHygieneSnapshot({
  row: value,
  expectedOrganizationId,
  expectedBranchId,
  filters,
  demo,
}: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: HandHygieneFilters;
  demo: boolean;
}): HandHygieneSnapshot {
  const parsed = sourceSchema.safeParse(value);
  const organization = uuid.safeParse(expectedOrganizationId);
  const branch = uuid.safeParse(expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data ||
      row.events_truncated !== (row.event_total > row.events.length) ||
      row.staff_truncated !== (row.staff_total > row.staff_options.length) ||
      row.devices_truncated !== (row.device_total > row.device_options.length) ||
      row.events.length > row.event_total || row.staff_options.length > row.staff_total ||
      row.device_options.length > row.device_total ||
      row.performed_event_total > row.event_total ||
      row.matched_performed_total > row.performed_event_total ||
      row.observed_opportunity_event_total > row.event_total ||
      row.unmatched_total > row.event_total || row.excluded_total > row.event_total ||
      !unique(row.events.map((event) => event.event_id)) ||
      !unique(row.staff_options.map((staff) => staff.staff_membership_id)) ||
      !unique(row.device_options.map((device) => device.device_code))) invalid();

  let priorSort = "";
  for (const event of row.events) {
    const staffPresent = event.staff_membership_id !== null &&
      event.staff_display_name !== null;
    const correctionPresent = event.correction_sequence > 0 &&
      event.correction_reason !== null && event.corrected_by_display_name !== null &&
      event.corrected_at !== null;
    const sort = `${event.occurred_at}:${event.received_at}:${event.event_id}`;
    if ((event.match_status === "matched") !== staffPresent ||
        (event.match_status !== "matched" && event.staff_employee_code !== null) ||
        (event.correction_sequence > 0) !== correctionPresent ||
        (event.correction_sequence === 0 && (
          event.correction_reason !== null || event.corrected_by_display_name !== null ||
          event.corrected_at !== null
        )) || (event.corrected_at !== null && event.corrected_at < event.occurred_at) ||
        (priorSort !== "" && sort > priorSort)) invalid();
    priorSort = sort;
  }

  if (!row.events_truncated) {
    const nonExcluded = row.events.filter((event) => event.match_status !== "excluded");
    if (row.event_total !== row.events.length ||
        row.performed_event_total !== nonExcluded.filter((event) =>
          event.event_kind === "hygiene_performed").length ||
        row.matched_performed_total !== row.events.filter((event) =>
          event.event_kind === "hygiene_performed" && event.match_status === "matched").length ||
        row.observed_opportunity_event_total !== nonExcluded.filter((event) =>
          event.event_kind === "opportunity").length ||
        row.unmatched_total !== row.events.filter((event) =>
          event.match_status === "unmatched").length ||
        row.excluded_total !== row.events.filter((event) =>
          event.match_status === "excluded").length) invalid();
  }

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(Date.parse(row.generated_at) + 5 * 60_000).toISOString(),
    filters,
    events: row.events.map((event) => ({
      eventId: event.event_id,
      sourceProvider: event.source_provider,
      sourceEventId: event.source_event_id,
      deviceCode: event.device_code,
      eventKind: event.event_kind,
      occurredAt: event.occurred_at,
      receivedAt: event.received_at,
      matchStatus: event.match_status,
      staffMembershipId: event.staff_membership_id,
      staffDisplayName: event.staff_display_name,
      staffEmployeeCode: event.staff_employee_code,
      correctionSequence: event.correction_sequence,
      correctionReason: event.correction_reason,
      correctedByDisplayName: event.corrected_by_display_name,
      correctedAt: event.corrected_at,
    })),
    eventTotal: row.event_total,
    eventsTruncated: row.events_truncated,
    metrics: {
      performedEventTotal: row.performed_event_total,
      matchedPerformedTotal: row.matched_performed_total,
      observedOpportunityEventTotal: row.observed_opportunity_event_total,
      unmatchedTotal: row.unmatched_total,
      excludedTotal: row.excluded_total,
      denominatorTotal: null,
      attainmentRate: null,
    },
    staffOptions: row.staff_options.map((staff) => ({
      staffMembershipId: staff.staff_membership_id,
      displayName: staff.display_name,
      employeeCode: staff.employee_code,
      isCurrent: staff.is_current,
    })),
    staffTotal: row.staff_total,
    staffTruncated: row.staff_truncated,
    deviceOptions: row.device_options.map((device) => ({
      deviceCode: device.device_code,
      eventCount: device.event_count,
    })),
    deviceTotal: row.device_total,
    devicesTruncated: row.devices_truncated,
    numeratorDefinition: row.numerator_definition,
    denominatorPolicyStatus: row.denominator_policy_status,
    denominatorDefinition: null,
    sourceIntegrationStatus: row.source_integration_status,
    exportStatus: row.export_status,
    demo,
  };
}
