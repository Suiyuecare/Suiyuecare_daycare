import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  INFECTION_HANDLING_STATUSES,
  INFECTION_TIMELINE_ENTRY_TYPES,
  INFECTION_TYPE_STATES,
  type InfectionEventSnapshot,
  type InfectionIncidentItem,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const safeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrativeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const positive = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe()),
]);

const timelineSchema = z.object({
  entry_id: uuid,
  sequence_number: positive,
  entry_type: z.enum(INFECTION_TIMELINE_ENTRY_TYPES),
  occurred_at: timestamp,
  entry_text: narrativeText(2000).nullable(),
  cluster_id: uuid.nullable(),
  cluster_label: safeText(120).nullable(),
  closure_outcome: narrativeText(2000).nullable(),
  closure_reason: narrativeText(1000).nullable(),
  committer_display_name: safeText(120),
  committed_at: timestamp,
}).strict();

const itemSchema = z.object({
  incident_id: uuid,
  client_id: uuid,
  client_display_name: safeText(120),
  occurred_at: timestamp,
  reported_at: timestamp,
  location: safeText(240),
  event_summary: narrativeText(2000),
  infection_type_state: z.enum(INFECTION_TYPE_STATES),
  infection_type_text: safeText(240).nullable(),
  current_cluster_id: uuid.nullable(),
  current_cluster_label: safeText(120).nullable(),
  reporter_display_name: safeText(120),
  handling_status: z.enum(INFECTION_HANDLING_STATUSES),
  chain_version: count,
  last_activity_at: timestamp,
  timeline_total: count,
  timeline_truncated: z.boolean(),
  timeline: z.array(timelineSchema).max(100),
}).strict();

const clientOptionSchema = z.object({
  client_id: uuid,
  display_name: safeText(120),
  client_status: z.enum(["active", "suspended", "transferred", "closed", "deceased"]),
  admitted_on: date.nullable(),
  ended_on: date.nullable(),
  can_report: z.boolean(),
}).strict();
const clusterOptionSchema = z.object({
  cluster_id: uuid,
  label: safeText(120),
  created_at: timestamp,
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  items: z.array(itemSchema).max(200),
  item_total: count,
  matching_total: count,
  infection_provided_total: count,
  linked_total: count,
  awaiting_action_total: count,
  awaiting_closure_total: count,
  closed_total: count,
  items_truncated: z.boolean(),
  client_options: z.array(clientOptionSchema).max(200),
  client_options_available_total: count,
  client_options_truncated: z.boolean(),
  infection_type_options: z.array(safeText(240)).max(200),
  infection_options_available_total: count,
  infection_options_truncated: z.boolean(),
  cluster_options: z.array(clusterOptionSchema).max(200),
  cluster_options_available_total: count,
  cluster_options_truncated: z.boolean(),
  infection_taxonomy_status: z.literal("not_configured"),
  cluster_threshold_status: z.literal("not_configured"),
  legal_reporting_status: z.literal("not_configured"),
}).strict();

export type InfectionEventSnapshotSourceRow = z.input<typeof sourceSchema>;
function invalid(): never { throw new Error("INVALID_INFECTION_EVENT_PROJECTION"); }
function unique(values: readonly string[]) { return new Set(values).size === values.length; }

function normalizeItem(row: z.output<typeof itemSchema>): InfectionIncidentItem {
  const occurred = new Date(row.occurred_at).getTime();
  if (
    new Date(row.reported_at).getTime() < occurred ||
    (row.infection_type_state === "provided") !== (row.infection_type_text !== null) ||
    (row.current_cluster_id === null) !== (row.current_cluster_label === null) ||
    row.chain_version !== row.timeline_total ||
    row.timeline_truncated !== (row.timeline_total > row.timeline.length) ||
    (!row.timeline_truncated && row.timeline_total !== row.timeline.length) ||
    (row.timeline_truncated && row.timeline.length !== 100) ||
    !unique(row.timeline.map((entry) => entry.entry_id))
  ) invalid();

  let priorSequence = row.timeline.length ? row.timeline[0]!.sequence_number - 1 : 0;
  let priorTime = row.timeline_truncated ? Number.NEGATIVE_INFINITY : occurred;
  let clusterStateKnown = !row.timeline_truncated;
  let currentClusterId: string | null = null;
  let currentClusterLabel: string | null = null;
  for (const entry of row.timeline) {
    const entryTime = new Date(entry.occurred_at).getTime();
    const isCluster = entry.entry_type === "cluster_link" || entry.entry_type === "cluster_unlink";
    const isClosure = entry.entry_type === "closure";
    if (
      entry.sequence_number !== priorSequence + 1 || entryTime < priorTime ||
      new Date(entry.committed_at).getTime() < entryTime ||
      (isCluster !== (entry.cluster_id !== null && entry.cluster_label !== null)) ||
      (isClosure ? entry.entry_text !== null || entry.closure_outcome === null || entry.closure_reason === null
        : isCluster ? entry.entry_text !== null || entry.closure_outcome !== null || entry.closure_reason !== null
          : entry.entry_text === null || entry.closure_outcome !== null || entry.closure_reason !== null)
    ) invalid();
    if (entry.entry_type === "cluster_link") {
      if (clusterStateKnown && currentClusterId !== null) invalid();
      currentClusterId = entry.cluster_id;
      currentClusterLabel = entry.cluster_label;
      clusterStateKnown = true;
    } else if (entry.entry_type === "cluster_unlink") {
      if (clusterStateKnown &&
        (currentClusterId !== entry.cluster_id || currentClusterLabel !== entry.cluster_label)) invalid();
      currentClusterId = null;
      currentClusterLabel = null;
      clusterStateKnown = true;
    }
    priorSequence = entry.sequence_number;
    priorTime = entryTime;
  }
  const last = row.timeline.at(-1);
  const expectedStatus = row.chain_version === 0 ? "reported" : last?.entry_type === "closure" ? "closed" : "in_progress";
  if (
    row.handling_status !== expectedStatus ||
    (row.chain_version > 0 && last?.sequence_number !== row.chain_version) ||
    (row.chain_version === 0
      ? row.last_activity_at !== row.reported_at
      : last?.committed_at !== row.last_activity_at) ||
    (clusterStateKnown &&
      (currentClusterId !== row.current_cluster_id || currentClusterLabel !== row.current_cluster_label))
  ) invalid();

  return {
    id: row.incident_id, clientId: row.client_id, clientDisplayName: row.client_display_name,
    occurredAt: row.occurred_at, reportedAt: row.reported_at, location: row.location,
    eventSummary: row.event_summary, infectionTypeState: row.infection_type_state,
    infectionTypeText: row.infection_type_text, currentClusterId: row.current_cluster_id,
    currentClusterLabel: row.current_cluster_label, reporterDisplayName: row.reporter_display_name,
    handlingStatus: row.handling_status, chainVersion: row.chain_version,
    lastActivityAt: row.last_activity_at, timelineTotal: row.timeline_total,
    timelineTruncated: row.timeline_truncated,
    timeline: row.timeline.map((entry) => ({
      id: entry.entry_id, sequenceNumber: entry.sequence_number, entryType: entry.entry_type,
      occurredAt: entry.occurred_at, entryText: entry.entry_text, clusterId: entry.cluster_id,
      clusterLabel: entry.cluster_label, closureOutcome: entry.closure_outcome,
      closureReason: entry.closure_reason, committerDisplayName: entry.committer_display_name,
      committedAt: entry.committed_at,
    })),
  };
}

export function projectInfectionEventSnapshot(input: {
  row: unknown; expectedOrganizationId: string; expectedBranchId: string; demo: boolean;
}): InfectionEventSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data) invalid();
  const items = row.items.map(normalizeItem);
  if (
    !unique(items.map((item) => item.id)) ||
    !unique(row.client_options.map((option) => option.client_id)) ||
    !unique(row.infection_type_options) || !unique(row.cluster_options.map((option) => option.cluster_id)) ||
    row.item_total !== items.length || row.matching_total < row.item_total ||
    row.items_truncated !== (row.matching_total > row.item_total) ||
    row.client_options_available_total < row.client_options.length ||
    row.infection_options_available_total < row.infection_type_options.length ||
    row.cluster_options_available_total < row.cluster_options.length ||
    row.client_options_truncated !== (row.client_options_available_total > row.client_options.length) ||
    row.infection_options_truncated !== (row.infection_options_available_total > row.infection_type_options.length) ||
    row.cluster_options_truncated !== (row.cluster_options_available_total > row.cluster_options.length) ||
    row.infection_provided_total > row.matching_total || row.linked_total > row.matching_total ||
    row.awaiting_action_total + row.awaiting_closure_total + row.closed_total !== row.matching_total ||
    (!row.items_truncated && (
      items.filter((item) => item.infectionTypeState === "provided").length !== row.infection_provided_total ||
      items.filter((item) => item.currentClusterId !== null).length !== row.linked_total ||
      items.filter((item) => item.handlingStatus === "reported").length !== row.awaiting_action_total ||
      items.filter((item) => item.handlingStatus === "in_progress").length !== row.awaiting_closure_total ||
      items.filter((item) => item.handlingStatus === "closed").length !== row.closed_total
    ))
  ) invalid();
  return {
    organizationId: row.organization_id, branchId: row.branch_id, generatedAt: row.generated_at,
    staleAfter: new Date(new Date(row.generated_at).getTime() + 60_000).toISOString(), items,
    itemTotal: row.item_total, matchingTotal: row.matching_total,
    metrics: { infectionProvided: row.infection_provided_total, linked: row.linked_total,
      awaitingAction: row.awaiting_action_total, awaitingClosure: row.awaiting_closure_total,
      closed: row.closed_total },
    itemsTruncated: row.items_truncated,
    clientOptions: row.client_options.map((option) => ({ clientId: option.client_id,
      displayName: option.display_name, clientStatus: option.client_status,
      admittedOn: option.admitted_on, endedOn: option.ended_on, canReport: option.can_report })),
    clientOptionsAvailableTotal: row.client_options_available_total,
    clientOptionsTruncated: row.client_options_truncated,
    infectionTypeOptions: row.infection_type_options,
    infectionOptionsAvailableTotal: row.infection_options_available_total,
    infectionOptionsTruncated: row.infection_options_truncated,
    clusterOptions: row.cluster_options.map((option) => ({ clusterId: option.cluster_id,
      label: option.label, createdAt: option.created_at })),
    clusterOptionsAvailableTotal: row.cluster_options_available_total,
    clusterOptionsTruncated: row.cluster_options_truncated,
    infectionTaxonomyStatus: row.infection_taxonomy_status,
    clusterThresholdStatus: row.cluster_threshold_status,
    legalReportingStatus: row.legal_reporting_status,
    demo: input.demo,
  };
}
