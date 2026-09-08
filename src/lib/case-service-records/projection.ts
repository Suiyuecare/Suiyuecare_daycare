import { z } from "zod";

import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";

import {
  CASE_SERVICE_EXECUTION_STATUSES,
  CASE_SERVICE_EXECUTION_VERIFICATIONS,
  CASE_SERVICE_RECORD_STATES,
  type CaseServiceRecord,
  type CaseServiceRecordFilters,
  type CaseServiceRecordSnapshot,
  type CaseServiceRecordVersion,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().refine(isStrictOffsetDateTime)
  .transform((value) => new Date(value).toISOString());
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const positive = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe()),
]);
const text = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));

const version = z.object({
  version_id: uuid,
  record_key: uuid,
  version: positive,
  previous_version_id: uuid.nullable(),
  content_hash: hash,
  record_state: z.enum(CASE_SERVICE_RECORD_STATES),
  client_id: uuid,
  client_display_name: text(160),
  started_at: timestamp,
  ended_at: timestamp,
  service_type: text(120),
  service_content: text(8_000),
  service_result: text(4_000),
  execution_reference_id: uuid.nullable(),
  execution_reference_status: z.enum(CASE_SERVICE_EXECUTION_STATUSES),
  execution_reference_content_hash: hash.nullable(),
  execution_reference_verification: z.enum(CASE_SERVICE_EXECUTION_VERIFICATIONS),
  author_user_id: uuid,
  author_display_name: text(160),
  revision_reason: text(1_000).nullable(),
  correction_reason: text(1_000, 8).nullable(),
  signed_at: timestamp.nullable(),
  signed_by_user_id: uuid.nullable(),
  signer_display_name: text(160).nullable(),
  signer_role_keys: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/u)).min(1).max(50).nullable(),
  signature_purpose: text(160).nullable(),
  signature_reauth_challenge_id: uuid.nullable(),
  source_kind: z.literal("manual_local"),
  schema_kind: z.literal("manual_service_narrative_v1"),
  statutory_rule_status: z.literal("not_configured"),
  claim_eligibility_status: z.literal("not_configured"),
  created_at: timestamp,
}).strict();
const record = version.extend({ history: z.array(version).max(50), history_total: count }).strict();
const client = z.object({ client_id: uuid, display_name: text(160) }).strict();
const author = z.object({ user_id: uuid, display_name: text(160) }).strict();
const source = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  records: z.array(record).max(200),
  matching_total: count,
  records_truncated: z.boolean(),
  service_total: count,
  draft_total: count,
  signed_total: count,
  corrected_total: count,
  linked_execution_total: count,
  changed_execution_total: count,
  clients: z.array(client).max(200),
  client_total: count,
  clients_truncated: z.boolean(),
  service_types: z.array(text(120)).max(200),
  service_type_total: count,
  service_types_truncated: z.boolean(),
  authors: z.array(author).max(200),
  author_total: count,
  authors_truncated: z.boolean(),
  schema_kind: z.literal("manual_service_narrative_v1"),
  statutory_rule_status: z.literal("not_configured"),
  attachment_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"),
  notification_status: z.literal("not_configured"),
  offline_status: z.literal("not_configured"),
  claim_eligibility_status: z.literal("not_configured"),
}).strict();

export type CaseServiceRecordSnapshotSourceRow = z.input<typeof source>;

function invalid(): never {
  throw new Error("INVALID_CASE_SERVICE_RECORD_SNAPSHOT");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function normalizeVersion(row: z.output<typeof version>): CaseServiceRecordVersion {
  const signed = row.record_state !== "draft";
  const expectedPurpose = row.record_state === "signed" ? "個案服務紀錄簽署" :
    row.record_state === "corrected" ? "個案服務紀錄更正簽署" : null;
  const linked = row.execution_reference_id !== null;
  if ((row.version === 1) !== (row.previous_version_id === null) ||
    Date.parse(row.ended_at) < Date.parse(row.started_at) ||
    Date.parse(row.started_at) > Date.parse(row.created_at) + 5 * 60_000 ||
    Date.parse(row.ended_at) > Date.parse(row.created_at) + 5 * 60_000 ||
    linked !== (row.execution_reference_status === "linked_completed_event") ||
    linked !== (row.execution_reference_content_hash !== null) ||
    (!linked && row.execution_reference_verification !== "not_linked") ||
    (linked && row.execution_reference_verification === "not_linked") ||
    signed !== (row.signed_at !== null && row.signed_by_user_id !== null &&
      row.signer_display_name !== null && row.signer_role_keys !== null &&
      row.signature_reauth_challenge_id !== null) || row.signature_purpose !== expectedPurpose ||
    (row.record_state === "draft") !== (row.revision_reason !== null) ||
    (row.record_state === "corrected") !== (row.correction_reason !== null) ||
    (row.record_state !== "corrected" && row.correction_reason !== null)) {
    invalid();
  }
  return {
    versionId: row.version_id,
    recordKey: row.record_key,
    version: row.version,
    previousVersionId: row.previous_version_id,
    contentHash: row.content_hash,
    recordState: row.record_state,
    clientId: row.client_id,
    clientDisplayName: row.client_display_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    serviceType: row.service_type,
    serviceContent: row.service_content,
    serviceResult: row.service_result,
    executionReferenceId: row.execution_reference_id,
    executionReferenceStatus: row.execution_reference_status,
    executionReferenceContentHash: row.execution_reference_content_hash,
    executionReferenceVerification: row.execution_reference_verification,
    authorUserId: row.author_user_id,
    authorDisplayName: row.author_display_name,
    revisionReason: row.revision_reason,
    correctionReason: row.correction_reason,
    signedAt: row.signed_at,
    signedByUserId: row.signed_by_user_id,
    signerDisplayName: row.signer_display_name,
    signerRoleKeys: row.signer_role_keys,
    signaturePurpose: row.signature_purpose,
    signatureReauthChallengeId: row.signature_reauth_challenge_id,
    sourceKind: row.source_kind,
    schemaKind: row.schema_kind,
    statutoryRuleStatus: row.statutory_rule_status,
    claimEligibilityStatus: row.claim_eligibility_status,
    createdAt: row.created_at,
  };
}

function samePayload(left: CaseServiceRecordVersion, right: CaseServiceRecordVersion) {
  return left.clientId === right.clientId && left.startedAt === right.startedAt &&
    left.endedAt === right.endedAt && left.serviceType === right.serviceType &&
    left.serviceContent === right.serviceContent && left.serviceResult === right.serviceResult &&
    left.executionReferenceId === right.executionReferenceId &&
    left.executionReferenceStatus === right.executionReferenceStatus &&
    left.executionReferenceContentHash === right.executionReferenceContentHash &&
    left.authorUserId === right.authorUserId && left.sourceKind === right.sourceKind &&
    left.schemaKind === right.schemaKind && left.statutoryRuleStatus === right.statutoryRuleStatus &&
    left.claimEligibilityStatus === right.claimEligibilityStatus;
}

function sameTerminal(left: CaseServiceRecordVersion, right: CaseServiceRecordVersion) {
  return samePayload(left, right) && left.versionId === right.versionId &&
    left.recordKey === right.recordKey && left.version === right.version &&
    left.previousVersionId === right.previousVersionId && left.contentHash === right.contentHash &&
    left.recordState === right.recordState && left.clientDisplayName === right.clientDisplayName &&
    left.executionReferenceVerification === right.executionReferenceVerification &&
    left.authorDisplayName === right.authorDisplayName &&
    left.revisionReason === right.revisionReason && left.correctionReason === right.correctionReason &&
    left.signedAt === right.signedAt && left.signedByUserId === right.signedByUserId &&
    left.signerDisplayName === right.signerDisplayName &&
    JSON.stringify(left.signerRoleKeys) === JSON.stringify(right.signerRoleKeys) &&
    left.signaturePurpose === right.signaturePurpose &&
    left.signatureReauthChallengeId === right.signatureReauthChallengeId &&
    left.createdAt === right.createdAt;
}

function normalizeRecord(row: z.output<typeof record>): CaseServiceRecord {
  const terminal = normalizeVersion(row);
  const history = row.history.map(normalizeVersion);
  const truncated = row.history_total > history.length;
  if (row.history_total < history.length || (truncated && history.length !== 50) ||
    row.history_total !== terminal.version || !unique(history.map((item) => item.versionId)) ||
    history.some((item, index) => item.version !== index + 1 ||
      item.recordKey !== terminal.recordKey || item.clientId !== terminal.clientId ||
      item.authorUserId !== terminal.authorUserId ||
      (index === 0 ? item.previousVersionId !== null :
        item.previousVersionId !== history[index - 1]!.versionId) ||
      (item.recordState === "draft" && index > 0 && history[index - 1]!.recordState !== "draft") ||
      (item.recordState === "signed" && (index === 0 || history[index - 1]!.recordState !== "draft" ||
        !samePayload(item, history[index - 1]!))) ||
      (item.recordState === "corrected" && (index === 0 ||
        !["signed", "corrected"].includes(history[index - 1]!.recordState))))) {
    invalid();
  }
  if (!truncated && (!history.length || !sameTerminal(terminal, history.at(-1)!))) invalid();
  return { ...terminal, history, historyTotal: row.history_total, historyTruncated: truncated };
}

function matches(item: CaseServiceRecord, filters: CaseServiceRecordFilters) {
  const date = taipeiDate(item.startedAt);
  return (!filters.dateFrom || date >= filters.dateFrom) &&
    (!filters.dateTo || date <= filters.dateTo) &&
    (!filters.clientId || item.clientId === filters.clientId) &&
    (!filters.serviceType || item.serviceType === filters.serviceType) &&
    (!filters.authorUserId || item.authorUserId === filters.authorUserId) &&
    (filters.recordState === "all" || item.recordState === filters.recordState);
}

function compareRecords(left: CaseServiceRecord, right: CaseServiceRecord) {
  const time = Date.parse(right.startedAt) - Date.parse(left.startedAt);
  if (time !== 0) return time;
  const client = left.clientId < right.clientId ? -1 : left.clientId > right.clientId ? 1 : 0;
  if (client !== 0) return client;
  return left.recordKey < right.recordKey ? -1 : left.recordKey > right.recordKey ? 1 : 0;
}

export function projectCaseServiceRecordSnapshot({
  row,
  expectedOrganizationId,
  expectedBranchId,
  filters,
  demo,
}: {
  row: CaseServiceRecordSnapshotSourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: CaseServiceRecordFilters;
  demo: boolean;
}): CaseServiceRecordSnapshot {
  const parsed = source.safeParse(row);
  const expected = z.object({ organizationId: uuid, branchId: uuid }).strict().safeParse({
    organizationId: expectedOrganizationId,
    branchId: expectedBranchId,
  });
  if (!parsed.success || !expected.success) invalid();
  const value = parsed.data;
  if (value.organization_id !== expected.data.organizationId ||
    value.branch_id !== expected.data.branchId) invalid();
  const records = value.records.map(normalizeRecord);
  if (!unique(records.map((item) => item.recordKey)) || records.some((item) => !matches(item, filters)) ||
    records.some((item, index) => index > 0 && compareRecords(records[index - 1]!, item) > 0) ||
    value.matching_total < records.length || value.service_total !== value.matching_total ||
    value.records_truncated !== (value.matching_total > records.length) ||
    (!value.records_truncated && value.matching_total !== records.length)) invalid();

  const visible = {
    draft: records.filter((item) => item.recordState === "draft").length,
    signed: records.filter((item) => item.recordState === "signed").length,
    corrected: records.filter((item) => item.recordState === "corrected").length,
    linked: records.filter((item) => item.executionReferenceStatus === "linked_completed_event").length,
    changed: records.filter((item) => item.executionReferenceVerification === "changed_or_unavailable").length,
  };
  const totalsSum = value.draft_total + value.signed_total + value.corrected_total;
  if (totalsSum !== value.service_total ||
    (!value.records_truncated && (visible.draft !== value.draft_total ||
      visible.signed !== value.signed_total || visible.corrected !== value.corrected_total ||
      visible.linked !== value.linked_execution_total || visible.changed !== value.changed_execution_total)) ||
    (value.records_truncated && (visible.draft > value.draft_total ||
      visible.signed > value.signed_total || visible.corrected > value.corrected_total ||
      visible.linked > value.linked_execution_total || visible.changed > value.changed_execution_total))) invalid();

  const clients = value.clients.map((item) => ({ clientId: item.client_id, displayName: item.display_name }));
  const authors = value.authors.map((item) => ({ userId: item.user_id, displayName: item.display_name }));
  if (!unique(clients.map((item) => item.clientId)) || !unique(value.service_types) ||
    !unique(authors.map((item) => item.userId)) || value.client_total < clients.length ||
    value.service_type_total < value.service_types.length || value.author_total < authors.length ||
    value.clients_truncated !== (value.client_total > clients.length) ||
    value.service_types_truncated !== (value.service_type_total > value.service_types.length) ||
    value.authors_truncated !== (value.author_total > authors.length) ||
    (!value.clients_truncated && value.client_total !== clients.length) ||
    (!value.service_types_truncated && value.service_type_total !== value.service_types.length) ||
    (!value.authors_truncated && value.author_total !== authors.length)) invalid();

  const generated = Date.parse(value.generated_at);
  if (!Number.isFinite(generated)) invalid();
  return {
    organizationId: value.organization_id,
    branchId: value.branch_id,
    generatedAt: value.generated_at,
    staleAfter: new Date(generated + 60_000).toISOString(),
    filters,
    records,
    matchingTotal: value.matching_total,
    recordsTruncated: value.records_truncated,
    metrics: {
      serviceTotal: value.service_total,
      draftTotal: value.draft_total,
      signedTotal: value.signed_total,
      correctedTotal: value.corrected_total,
      linkedExecutionTotal: value.linked_execution_total,
      changedExecutionTotal: value.changed_execution_total,
    },
    clients,
    clientTotal: value.client_total,
    clientsTruncated: value.clients_truncated,
    serviceTypes: value.service_types,
    serviceTypeTotal: value.service_type_total,
    serviceTypesTruncated: value.service_types_truncated,
    authors,
    authorTotal: value.author_total,
    authorsTruncated: value.authors_truncated,
    schemaKind: value.schema_kind,
    statutoryRuleStatus: value.statutory_rule_status,
    attachmentStatus: value.attachment_status,
    exportStatus: value.export_status,
    notificationStatus: value.notification_status,
    offlineStatus: value.offline_status,
    claimEligibilityStatus: value.claim_eligibility_status,
    demo,
  };
}
