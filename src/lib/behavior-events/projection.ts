import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { BEHAVIOR_EVENT_STATES, BEHAVIOR_FIELD_STATES,
  type BehaviorEvent, type BehaviorEventFilters, type BehaviorEventSnapshot,
  type BehaviorEventVersion } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
const count = z.union([z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe())]);
const positive = z.union([z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe())]);
const text = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const fieldState = z.enum(BEHAVIOR_FIELD_STATES);
const version = z.object({
  version_id: uuid, event_key: uuid, version: positive, previous_version_id: uuid.nullable(),
  content_hash: hash, event_state: z.enum(BEHAVIOR_EVENT_STATES), client_id: uuid,
  client_display_name: text(160), occurred_at: timestamp, event_type: text(120),
  antecedent_state: fieldState, antecedent_text: text(4_000).nullable(),
  behavior_state: fieldState, behavior_text: text(4_000).nullable(),
  intervention_state: fieldState, intervention_text: text(4_000).nullable(),
  outcome_state: fieldState, outcome_text: text(4_000).nullable(),
  author_user_id: uuid, author_display_name: text(160), correction_reason: text(1_000).nullable(),
  void_reason: text(1_000).nullable(), signed_at: timestamp.nullable(),
  signed_by_user_id: uuid.nullable(), signer_display_name: text(160).nullable(),
  signer_role_keys: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/u)).min(1).max(50).nullable(),
  signature_purpose: text(160).nullable(), signature_reauth_challenge_id: uuid.nullable(),
  created_at: timestamp,
}).strict();
const event = version.extend({ history: z.array(version).max(50), history_total: count }).strict();
const client = z.object({ client_id: uuid, display_name: text(160) }).strict();
const source = z.object({ organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  events: z.array(event).max(200), matching_total: count, events_truncated: z.boolean(),
  event_total: count, missing_field_total: count, draft_total: count, signed_total: count,
  voided_total: count, clients: z.array(client).max(200), client_total: count,
  clients_truncated: z.boolean(), event_types: z.array(text(120)).max(200), event_type_total: count,
  event_types_truncated: z.boolean(), attachment_status: z.literal("not_configured"),
  notification_status: z.literal("not_configured"), export_status: z.literal("not_configured"),
  offline_status: z.literal("not_configured") }).strict();

export type BehaviorEventSnapshotSourceRow = z.input<typeof source>;

function invalid(): never { throw new Error("INVALID_BEHAVIOR_EVENT_SNAPSHOT"); }
function unique(values: readonly string[]) { return new Set(values).size === values.length; }
function dateTaipei(value: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei",
  year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
function field(state: z.output<typeof fieldState>, narrative: string | null) {
  if ((state === "recorded") !== (narrative !== null)) invalid();
  return { state, text: narrative };
}
function normalize(row: z.output<typeof version>): BehaviorEventVersion {
  const signed = row.event_state !== "draft";
  const expectedPurpose = row.event_state === "signed" ? "行為與情緒事件簽署" :
    row.event_state === "corrected" ? "行為與情緒事件更正簽署" :
      row.event_state === "voided" ? "行為與情緒事件作廢簽署" : null;
  if ((row.version === 1) !== (row.previous_version_id === null) ||
    signed !== (row.signed_at !== null && row.signed_by_user_id !== null &&
      row.signer_display_name !== null && row.signer_role_keys !== null &&
      row.signature_reauth_challenge_id !== null) || row.signature_purpose !== expectedPurpose ||
    (row.event_state === "corrected") !== (row.correction_reason !== null) ||
    (row.event_state === "voided") !== (row.void_reason !== null) ||
    (row.event_state !== "corrected" && row.correction_reason !== null) ||
    (row.event_state !== "voided" && row.void_reason !== null) ||
    Date.parse(row.occurred_at) > Date.parse(row.created_at) + 5 * 60_000) invalid();
  return { versionId: row.version_id, eventKey: row.event_key, version: row.version,
    previousVersionId: row.previous_version_id, contentHash: row.content_hash,
    eventState: row.event_state, clientId: row.client_id, clientDisplayName: row.client_display_name,
    occurredAt: row.occurred_at, eventType: row.event_type,
    antecedent: field(row.antecedent_state, row.antecedent_text),
    behavior: field(row.behavior_state, row.behavior_text),
    intervention: field(row.intervention_state, row.intervention_text),
    outcome: field(row.outcome_state, row.outcome_text), authorUserId: row.author_user_id,
    authorDisplayName: row.author_display_name, correctionReason: row.correction_reason,
    voidReason: row.void_reason, signedAt: row.signed_at, signerDisplayName: row.signer_display_name,
    signedByUserId: row.signed_by_user_id, signerRoleKeys: row.signer_role_keys,
    signaturePurpose: row.signature_purpose,
    signatureReauthChallengeId: row.signature_reauth_challenge_id,
    createdAt: row.created_at };
}

function matches(item: BehaviorEventVersion, filters: BehaviorEventFilters) {
  const date = dateTaipei(item.occurredAt);
  return (!filters.dateFrom || date >= filters.dateFrom) && (!filters.dateTo || date <= filters.dateTo) &&
    (!filters.clientId || item.clientId === filters.clientId) &&
    (!filters.eventType || item.eventType === filters.eventType) &&
    (filters.state === "all" || item.eventState === filters.state);
}

function sameManualContent(left: BehaviorEventVersion, right: BehaviorEventVersion) {
  return left.occurredAt === right.occurredAt && left.eventType === right.eventType &&
    (["antecedent", "behavior", "intervention", "outcome"] as const).every((key) =>
      left[key].state === right[key].state && left[key].text === right[key].text);
}

export function projectBehaviorEventSnapshot(input: { row: unknown; expectedOrganizationId: string;
  expectedBranchId: string; filters: BehaviorEventFilters; demo: boolean }): BehaviorEventSnapshot {
  const parsed = source.safeParse(input.row);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== input.expectedOrganizationId.toLowerCase() ||
    row.branch_id !== input.expectedBranchId.toLowerCase() ||
    row.matching_total < row.events.length || row.events_truncated !== (row.matching_total > row.events.length) ||
    (row.events_truncated && row.events.length !== 200) || row.client_total < row.clients.length ||
    row.clients_truncated !== (row.client_total > row.clients.length) ||
    (row.clients_truncated && row.clients.length !== 200) || row.event_type_total < row.event_types.length ||
    row.event_types_truncated !== (row.event_type_total > row.event_types.length) ||
    (row.event_types_truncated && row.event_types.length !== 200) ||
    !unique(row.events.map(({ event_key }) => event_key)) || !unique(row.clients.map(({ client_id }) => client_id)) ||
    !unique(row.event_types.map((value) => value.toLocaleLowerCase("zh-Hant-TW")))) invalid();
  const events: BehaviorEvent[] = row.events.map((item) => {
    const latest = normalize(item);
    const history = item.history.map(normalize);
    if (item.history_total < history.length || (item.history_total > history.length && history.length !== 50) ||
      !unique(history.map(({ versionId }) => versionId)) || history.some((entry, index) =>
        entry.eventKey !== latest.eventKey || entry.clientId !== latest.clientId || entry.version !== index + 1 ||
        (index === 0 ? entry.previousVersionId !== null : entry.previousVersionId !== history[index - 1]?.versionId) ||
        (entry.signerRoleKeys !== null && !unique(entry.signerRoleKeys)) ||
        (index > 0 && Date.parse(entry.createdAt) < Date.parse(history[index - 1]!.createdAt)) ||
        (index > 0 && ["signed", "voided"].includes(entry.eventState) &&
          !sameManualContent(entry, history[index - 1]!)) ||
        (index === 0 ? entry.eventState !== "draft" :
          entry.eventState === "draft" ? history[index - 1]?.eventState !== "draft" :
            entry.eventState === "signed" ? history[index - 1]?.eventState !== "draft" :
              entry.eventState === "corrected" ? !["signed", "corrected"].includes(history[index - 1]!.eventState) :
                !["signed", "corrected"].includes(history[index - 1]!.eventState))) ||
      (item.history_total === history.length && (history.at(-1)?.versionId !== latest.versionId ||
        history.at(-1)?.contentHash !== latest.contentHash)) || !matches(latest, input.filters)) invalid();
    return { ...latest, history, historyTotal: item.history_total,
      historyTruncated: item.history_total > history.length,
      hasMissingFields: [latest.antecedent, latest.behavior, latest.intervention, latest.outcome]
        .some(({ state }) => state === "missing") };
  });
  const sorted = [...events].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
    left.eventKey.localeCompare(right.eventKey, "en"));
  const visibleDrafts = events.filter(({ eventState }) => eventState === "draft").length;
  const visibleSigned = events.filter(({ eventState }) => eventState === "signed" || eventState === "corrected").length;
  const visibleVoided = events.filter(({ eventState }) => eventState === "voided").length;
  const visibleMissing = events.filter(({ hasMissingFields }) => hasMissingFields).length;
  if (events.some((item, index) => item.eventKey !== sorted[index]?.eventKey) ||
    row.event_total !== row.matching_total || row.missing_field_total > row.event_total ||
    row.draft_total + row.signed_total + row.voided_total !== row.event_total ||
    (!row.events_truncated && (visibleDrafts !== row.draft_total || visibleSigned !== row.signed_total ||
      visibleVoided !== row.voided_total || visibleMissing !== row.missing_field_total)) ||
    (row.events_truncated && (visibleDrafts > row.draft_total || visibleSigned > row.signed_total ||
      visibleVoided > row.voided_total || visibleMissing > row.missing_field_total))) invalid();
  return { organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at, staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    filters: input.filters, events, matchingTotal: row.matching_total, eventsTruncated: row.events_truncated,
    metrics: { eventTotal: row.event_total, missingFieldTotal: row.missing_field_total,
      draftTotal: row.draft_total, signedTotal: row.signed_total, voidedTotal: row.voided_total },
    clients: row.clients.map((item) => ({ clientId: item.client_id, displayName: item.display_name })),
    clientTotal: row.client_total, clientsTruncated: row.clients_truncated,
    eventTypes: row.event_types, eventTypeTotal: row.event_type_total,
    eventTypesTruncated: row.event_types_truncated, attachmentStatus: row.attachment_status,
    notificationStatus: row.notification_status, exportStatus: row.export_status,
    offlineStatus: row.offline_status, demo: input.demo };
}
