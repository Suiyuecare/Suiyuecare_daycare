import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  FALL_HANDLING_STATUSES,
  FALL_INJURY_STATES,
  FALL_TIMELINE_ENTRY_TYPES,
  type FallEventSnapshot,
  type FallIncidentItem,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const positiveInteger = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe()),
]);

const timelineSchema = z.object({
  entry_id: uuid,
  sequence_number: positiveInteger,
  entry_type: z.enum(FALL_TIMELINE_ENTRY_TYPES),
  occurred_at: timestamp,
  entry_text: z.string().trim().min(1).max(2000).nullable(),
  closure_outcome: z.string().trim().min(1).max(2000).nullable(),
  closure_reason: z.string().trim().min(1).max(1000).nullable(),
  committer_display_name: z.string().trim().min(1).max(120),
  committed_at: timestamp,
}).strict();

const itemSchema = z.object({
  incident_id: uuid,
  client_id: uuid,
  client_display_name: z.string().trim().min(1).max(120),
  occurred_at: timestamp,
  reported_at: timestamp,
  location: z.string().trim().min(1).max(240),
  event_summary: z.string().trim().min(1).max(2000),
  injury_degree_state: z.enum(FALL_INJURY_STATES),
  injury_degree_text: z.string().trim().min(1).max(240).nullable(),
  late_entry_reason: z.string().trim().min(1).max(1000).nullable(),
  reporter_display_name: z.string().trim().min(1).max(120),
  handling_status: z.enum(FALL_HANDLING_STATUSES),
  chain_version: count,
  last_activity_at: timestamp,
  timeline_total: count,
  timeline_truncated: z.boolean(),
  timeline: z.array(timelineSchema).max(100),
}).strict();

const clientOptionSchema = z.object({
  client_id: uuid,
  display_name: z.string().trim().min(1).max(120),
  client_status: z.enum(["active", "suspended", "transferred", "closed", "deceased"]),
  admitted_on: date.nullable(),
  ended_on: date.nullable(),
  can_report: z.boolean(),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  items: z.array(itemSchema).max(200),
  item_total: count,
  matching_total: count,
  injury_provided_total: count,
  awaiting_action_total: count,
  awaiting_closure_total: count,
  closed_total: count,
  items_truncated: z.boolean(),
  client_options: z.array(clientOptionSchema).max(200),
  client_options_truncated: z.boolean(),
  injury_degree_options: z.array(z.string().trim().min(1).max(240)).max(200),
  injury_options_truncated: z.boolean(),
  injury_taxonomy_status: z.literal("not_configured"),
  severity_scoring_status: z.literal("not_configured"),
  reporting_threshold_status: z.literal("not_configured"),
}).strict();

export type FallEventSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_FALL_EVENT_PROJECTION");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function normalizeItem(row: z.output<typeof itemSchema>): FallIncidentItem {
  const occurredAt = new Date(row.occurred_at).getTime();
  const reportedAt = new Date(row.reported_at).getTime();
  const late = reportedAt - occurredAt > 24 * 60 * 60 * 1000;
  if (
    reportedAt < occurredAt ||
    (row.injury_degree_state === "provided"
      ? row.injury_degree_text === null
      : row.injury_degree_text !== null) ||
    (late ? row.late_entry_reason === null : row.late_entry_reason !== null) ||
    row.chain_version !== row.timeline_total ||
    row.timeline_truncated !== (row.timeline_total > row.timeline.length) ||
    (!row.timeline_truncated && row.timeline_total !== row.timeline.length) ||
    (row.timeline_truncated && row.timeline.length !== 100) ||
    !unique(row.timeline.map((entry) => entry.entry_id))
  ) invalid();

  let priorSequence = row.timeline.length ? row.timeline[0]!.sequence_number - 1 : 0;
  let priorOccurredAt = occurredAt;
  for (const entry of row.timeline) {
    const entryOccurredAt = new Date(entry.occurred_at).getTime();
    if (
      entry.sequence_number !== priorSequence + 1 ||
      entryOccurredAt < priorOccurredAt ||
      new Date(entry.committed_at).getTime() < entryOccurredAt ||
      (entry.entry_type === "closure"
        ? entry.entry_text !== null || entry.closure_outcome === null || entry.closure_reason === null
        : entry.entry_text === null || entry.closure_outcome !== null || entry.closure_reason !== null)
    ) invalid();
    priorSequence = entry.sequence_number;
    priorOccurredAt = entryOccurredAt;
  }

  const last = row.timeline.at(-1);
  const expectedStatus = row.chain_version === 0
    ? "reported"
    : last?.entry_type === "closure" ? "closed" : "in_progress";
  if (
    row.handling_status !== expectedStatus ||
    (row.chain_version > 0 && last?.sequence_number !== row.chain_version) ||
    new Date(row.last_activity_at).getTime() < reportedAt
  ) invalid();

  return {
    id: row.incident_id,
    clientId: row.client_id,
    clientDisplayName: row.client_display_name,
    occurredAt: row.occurred_at,
    reportedAt: row.reported_at,
    location: row.location,
    eventSummary: row.event_summary,
    injuryDegreeState: row.injury_degree_state,
    injuryDegreeText: row.injury_degree_text,
    lateEntryReason: row.late_entry_reason,
    reporterDisplayName: row.reporter_display_name,
    handlingStatus: row.handling_status,
    chainVersion: row.chain_version,
    lastActivityAt: row.last_activity_at,
    timelineTotal: row.timeline_total,
    timelineTruncated: row.timeline_truncated,
    timeline: row.timeline.map((entry) => ({
      id: entry.entry_id,
      sequenceNumber: entry.sequence_number,
      entryType: entry.entry_type,
      occurredAt: entry.occurred_at,
      entryText: entry.entry_text,
      closureOutcome: entry.closure_outcome,
      closureReason: entry.closure_reason,
      committerDisplayName: entry.committer_display_name,
      committedAt: entry.committed_at,
    })),
  };
}

export function projectFallEventSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): FallEventSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data) invalid();

  const items = row.items.map(normalizeItem);
  const generatedDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(row.generated_at));
  if (
    !unique(items.map((item) => item.id)) ||
    !unique(row.client_options.map((option) => option.client_id)) ||
    !unique(row.injury_degree_options) ||
    row.client_options.some((option) => option.can_report !== (
      option.client_status === "active" &&
      option.admitted_on !== null &&
      option.admitted_on <= generatedDate
    )) ||
    row.item_total !== items.length ||
    row.matching_total < row.item_total ||
    row.items_truncated !== (row.matching_total > row.item_total) ||
    (row.client_options_truncated && row.client_options.length !== 200) ||
    (row.injury_options_truncated && row.injury_degree_options.length !== 200) ||
    row.injury_provided_total > row.matching_total ||
    row.awaiting_action_total + row.awaiting_closure_total + row.closed_total !== row.matching_total ||
    (!row.items_truncated && (
      items.filter((item) => item.injuryDegreeState === "provided").length !== row.injury_provided_total ||
      items.filter((item) => item.handlingStatus === "reported").length !== row.awaiting_action_total ||
      items.filter((item) => item.handlingStatus === "in_progress").length !== row.awaiting_closure_total ||
      items.filter((item) => item.handlingStatus === "closed").length !== row.closed_total
    ))
  ) invalid();

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(new Date(row.generated_at).getTime() + 60_000).toISOString(),
    items,
    itemTotal: row.item_total,
    matchingTotal: row.matching_total,
    metrics: {
      injuryProvided: row.injury_provided_total,
      awaitingAction: row.awaiting_action_total,
      awaitingClosure: row.awaiting_closure_total,
      closed: row.closed_total,
    },
    itemsTruncated: row.items_truncated,
    clientOptions: row.client_options.map((option) => ({
      clientId: option.client_id,
      displayName: option.display_name,
      clientStatus: option.client_status,
      admittedOn: option.admitted_on,
      endedOn: option.ended_on,
      canReport: option.can_report,
    })),
    clientOptionsTruncated: row.client_options_truncated,
    injuryDegreeOptions: row.injury_degree_options,
    injuryOptionsTruncated: row.injury_options_truncated,
    injuryTaxonomyStatus: row.injury_taxonomy_status,
    severityScoringStatus: row.severity_scoring_status,
    reportingThresholdStatus: row.reporting_threshold_status,
    demo: input.demo,
  };
}
