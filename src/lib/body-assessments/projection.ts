import { z } from "zod";
import { bodyHash, bodyObservationsReady, bodyObservationsSchema, bodyText, bodyTimestamp, bodyUuid, stableBodyJson } from "./parser";
import { BODY_RECORD_STATES, type BodyAssessmentFilters, type BodyAssessmentSnapshot, type BodyAssessmentVersion } from "./types";

const count = z.number().int().nonnegative().safe();
export const bodyVersionSchema = z.object({ version_id: bodyUuid, assessment_key: bodyUuid,
  version: count.min(1), previous_version_id: bodyUuid.nullable(), content_hash: bodyHash,
  record_state: z.enum(BODY_RECORD_STATES), client_id: bodyUuid, client_display_name: bodyText(160),
  observed_at: bodyTimestamp, observations: bodyObservationsSchema, instrument: z.literal("manual_nonstandard_body_observation_v1"),
  reason: bodyText(1000), actor_user_id: bodyUuid, actor_display_name: bodyText(160), created_at: bodyTimestamp,
  signed_at: bodyTimestamp.nullable(), signed_by: bodyUuid.nullable(), signer_role_keys: z.array(bodyText(120)).min(1).max(50).nullable(),
  signature_purpose: bodyText(160).nullable(), signature_reauth_challenge_id: bodyUuid.nullable() }).strict();
const snapshotSchema = z.object({ organization_id: bodyUuid, branch_id: bodyUuid, generated_at: bodyTimestamp,
  records: z.array(bodyVersionSchema.extend({ history: z.array(bodyVersionSchema).max(50), history_total: count }).strict()).max(200),
  matching_total: count, records_truncated: z.boolean(), clients: z.array(z.object({ client_id: bodyUuid,
    display_name: bodyText(160) }).strict()).max(200), client_total: count, clients_truncated: z.boolean(),
  attachment_status: z.literal("not_configured") }).strict();

function invalid(): never { throw new Error("INVALID_BODY_ASSESSMENT_SNAPSHOT"); }
function checkVersion(row: BodyAssessmentVersion, generatedAt: string) {
  const signed = row.record_state !== "draft";
  const signature = [row.signed_at, row.signed_by, row.signer_role_keys, row.signature_purpose, row.signature_reauth_challenge_id];
  if ((row.version === 1) !== (row.previous_version_id === null) ||
    (signed ? signature.some((s) => s === null) : signature.some((s) => s !== null)) ||
    (signed && (!bodyObservationsReady(row.observations) || row.signed_by !== row.actor_user_id || row.signed_at !== row.created_at)) ||
    row.signature_purpose !== (row.record_state === "signed" ? "人工身體觀察簽署" : row.record_state === "corrected" ? "人工身體觀察更正簽署" : null) ||
    (row.record_state === "corrected" && row.reason.length < 8) ||
    Date.parse(row.observed_at) > Date.parse(row.created_at) + 300_000 ||
    Date.parse(row.created_at) > Date.parse(generatedAt) + 1000) invalid();
}
function checkTransition(newer: BodyAssessmentVersion, older: BodyAssessmentVersion) {
  if (newer.previous_version_id !== older.version_id || newer.version !== older.version + 1 ||
    newer.assessment_key !== older.assessment_key || newer.client_id !== older.client_id ||
    Date.parse(newer.created_at) < Date.parse(older.created_at) ||
    (newer.record_state === "draft" && older.record_state !== "draft") ||
    (newer.record_state === "signed" && (older.record_state !== "draft" ||
      newer.observed_at !== older.observed_at || stableBodyJson(newer.observations) !== stableBodyJson(older.observations))) ||
    (newer.record_state === "corrected" && older.record_state === "draft")) invalid();
}
export function projectBodyAssessmentSnapshot(input: { row: unknown; expectedOrganizationId: string;
  expectedBranchId: string; filters: BodyAssessmentFilters; demo: boolean }): BodyAssessmentSnapshot {
  const parsed = snapshotSchema.safeParse(input.row); if (!parsed.success) invalid(); const s = parsed.data;
  if (s.organization_id !== input.expectedOrganizationId || s.branch_id !== input.expectedBranchId ||
    Date.parse(s.generated_at) > Date.now() + 60_000 || (!input.demo && Date.parse(s.generated_at) < Date.now() - 300_000) ||
    s.matching_total < s.records.length || s.records_truncated !== (s.matching_total > s.records.length) ||
    (s.records_truncated && s.records.length !== 200) || s.client_total < s.clients.length ||
    s.clients_truncated !== (s.client_total > s.clients.length) || (s.clients_truncated && s.clients.length !== 200) ||
    new Set(s.clients.map((c) => c.client_id)).size !== s.clients.length ||
    new Set(s.records.map((r) => r.assessment_key)).size !== s.records.length) invalid();
  const seenVersions = new Set<string>();
  const records = s.records.map(({ history, history_total, ...r }, index) => {
    const client = s.clients.find((c) => c.client_id === r.client_id);
    if ((!s.clients_truncated && !client) || (client && client.display_name !== r.client_display_name) ||
      (input.filters.clientId && r.client_id !== input.filters.clientId) ||
      (input.filters.state !== "all" && r.record_state !== input.filters.state) ||
      history_total !== r.version - 1 || history.length !== Math.min(50, history_total) ||
      (index > 0 && Date.parse(s.records[index - 1].observed_at) < Date.parse(r.observed_at))) invalid();
    [r, ...history].forEach((version, i, chain) => {
      checkVersion(version, s.generated_at);
      if (seenVersions.has(version.version_id) || version.client_display_name !== r.client_display_name) invalid();
      seenVersions.add(version.version_id);
      if (i > 0) checkTransition(chain[i - 1], version);
    });
    return { ...r, history, historyTotal: history_total, historyTruncated: history_total > history.length };
  });
  return { organizationId: s.organization_id, branchId: s.branch_id, generatedAt: s.generated_at,
    staleAfter: new Date(Date.parse(s.generated_at) + 300_000).toISOString(), filters: input.filters, records,
    matchingTotal: s.matching_total, recordsTruncated: s.records_truncated, clients: s.clients.map((c) => ({
      clientId: c.client_id, displayName: c.display_name })), clientTotal: s.client_total,
    clientsTruncated: s.clients_truncated, attachmentStatus: s.attachment_status, demo: input.demo };
}
