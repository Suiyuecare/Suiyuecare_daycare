import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { occupationalTherapyServiceValueSchema } from "./parser";
import {
  CLIENT_SERVICE_STATUSES,
  OCCUPATIONAL_THERAPY_SERVICE_RECORD_STATES,
  type OccupationalTherapyServiceFilters,
  type OccupationalTherapyServiceRecord,
  type OccupationalTherapyServiceSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
});
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) &&
    Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const positiveInteger = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number)
    .pipe(z.number().int().positive().safe()),
]);
const narrative = (max: number) => z.string().trim().min(1).max(max);

const assessmentReferenceSchema = z.object({
  status: z.enum(["linked", "none_available"]),
  version_id: uuid.nullable(),
  assessment_key: uuid.nullable(),
  assessment_version: positiveInteger.nullable(),
  assessed_on: date.nullable(),
  therapist_display_name: narrative(120).nullable(),
}).strict();

const versionHistorySchema = z.object({
  version_id: uuid,
  record_version: positiveInteger,
  record_state: z.enum(OCCUPATIONAL_THERAPY_SERVICE_RECORD_STATES),
  occurred_at: timestamp,
  service_content: occupationalTherapyServiceValueSchema,
  client_reaction: occupationalTherapyServiceValueSchema,
  recommendation: occupationalTherapyServiceValueSchema,
  therapist_user_id: uuid,
  therapist_display_name: narrative(120),
  service_status_at_occurrence: z.enum(CLIENT_SERVICE_STATUSES),
  assessment_reference: assessmentReferenceSchema,
  correction_reason: narrative(1000).nullable(),
  signed_at: timestamp.nullable(),
  signer_display_name: narrative(120).nullable(),
  created_at: timestamp,
}).strict();

const recordSchema = versionHistorySchema.extend({
  record_key: uuid,
  client_id: uuid,
  client_display_name: narrative(160),
  version_history: z.array(versionHistorySchema).max(50),
  version_history_total: count,
}).strict();

const clientOptionSchema = z.object({
  client_id: uuid,
  display_name: narrative(160),
  service_status: z.enum(CLIENT_SERVICE_STATUSES),
  admitted_on: date.nullable(),
  ended_on: date.nullable(),
}).strict();
const therapistOptionSchema = z.object({
  user_id: uuid,
  display_name: narrative(120),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  records: z.array(recordSchema).max(200),
  record_total: count,
  matching_total: count,
  records_truncated: z.boolean(),
  today_total: count,
  draft_total: count,
  signed_total: count,
  corrected_total: count,
  linked_assessment_total: count,
  client_options: z.array(clientOptionSchema).max(200),
  client_total: count,
  client_options_truncated: z.boolean(),
  therapist_options: z.array(therapistOptionSchema).max(200),
  therapist_total: count,
  therapist_options_truncated: z.boolean(),
  assessment_link_status: z.literal("readonly_latest_terminal"),
  formula_status: z.literal("not_configured"),
  diagnosis_status: z.literal("not_configured"),
  automatic_recommendation_status: z.literal("not_configured"),
  attachment_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"),
  offline_sync_status: z.literal("not_configured"),
}).strict();

export type OccupationalTherapyServiceSnapshotSourceRow =
  z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_OCCUPATIONAL_THERAPY_SERVICE_PROJECTION");
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

function validReference(
  value: z.output<typeof assessmentReferenceSchema>,
) {
  const fields = [
    value.version_id,
    value.assessment_key,
    value.assessment_version,
    value.assessed_on,
    value.therapist_display_name,
  ];
  return value.status === "linked"
    ? fields.every((item) => item !== null)
    : fields.every((item) => item === null);
}

function validVersionState(value: z.output<typeof versionHistorySchema>) {
  return validReference(value.assessment_reference) &&
    (value.record_state === "draft"
      ? value.correction_reason === null && value.signed_at === null &&
        value.signer_display_name === null
      : value.record_state === "signed"
        ? value.correction_reason === null && value.signed_at !== null &&
          value.signer_display_name !== null
        : value.correction_reason !== null && value.signed_at !== null &&
          value.signer_display_name !== null);
}

function terminalMatchesHistory(
  record: z.output<typeof recordSchema>,
  history: z.output<typeof versionHistorySchema>,
) {
  return history.version_id === record.version_id &&
    history.record_version === record.record_version &&
    history.record_state === record.record_state &&
    history.occurred_at === record.occurred_at &&
    JSON.stringify(history.service_content) ===
      JSON.stringify(record.service_content) &&
    JSON.stringify(history.client_reaction) ===
      JSON.stringify(record.client_reaction) &&
    JSON.stringify(history.recommendation) ===
      JSON.stringify(record.recommendation) &&
    history.therapist_user_id === record.therapist_user_id &&
    history.therapist_display_name === record.therapist_display_name &&
    history.service_status_at_occurrence ===
      record.service_status_at_occurrence &&
    JSON.stringify(history.assessment_reference) ===
      JSON.stringify(record.assessment_reference) &&
    history.correction_reason === record.correction_reason &&
    history.signed_at === record.signed_at &&
    history.signer_display_name === record.signer_display_name &&
    history.created_at === record.created_at;
}

function normalizeReference(
  value: z.output<typeof assessmentReferenceSchema>,
) {
  return {
    status: value.status,
    versionId: value.version_id,
    assessmentKey: value.assessment_key,
    assessmentVersion: value.assessment_version,
    assessedOn: value.assessed_on,
    therapistDisplayName: value.therapist_display_name,
  };
}

function normalizeRecord(
  row: z.output<typeof recordSchema>,
): OccupationalTherapyServiceRecord {
  if (
    !validVersionState(row) ||
    row.version_history_total < row.version_history.length ||
    row.version_history_total < row.record_version ||
    (row.version_history_total > row.version_history.length &&
      row.version_history.length !== 50) ||
    !unique(row.version_history.map((item) => item.version_id)) ||
    row.version_history.some((item) => !validVersionState(item))
  ) invalid();

  for (let index = 1; index < row.version_history.length; index += 1) {
    if (row.version_history[index]!.record_version !==
        row.version_history[index - 1]!.record_version + 1) invalid();
  }
  const last = row.version_history.at(-1);
  if (!last || last.record_version !== row.record_version ||
      !terminalMatchesHistory(row, last)) invalid();

  return {
    recordKey: row.record_key,
    versionId: row.version_id,
    recordVersion: row.record_version,
    recordState: row.record_state,
    clientId: row.client_id,
    clientDisplayName: row.client_display_name,
    occurredAt: row.occurred_at,
    serviceContent: row.service_content,
    clientReaction: row.client_reaction,
    recommendation: row.recommendation,
    therapistUserId: row.therapist_user_id,
    therapistDisplayName: row.therapist_display_name,
    serviceStatusAtOccurrence: row.service_status_at_occurrence,
    assessmentReference: normalizeReference(row.assessment_reference),
    correctionReason: row.correction_reason,
    signedAt: row.signed_at,
    signerDisplayName: row.signer_display_name,
    createdAt: row.created_at,
    versionHistory: row.version_history.map((item) => ({
      versionId: item.version_id,
      recordVersion: item.record_version,
      recordState: item.record_state,
      occurredAt: item.occurred_at,
      serviceContent: item.service_content,
      clientReaction: item.client_reaction,
      recommendation: item.recommendation,
      therapistUserId: item.therapist_user_id,
      therapistDisplayName: item.therapist_display_name,
      serviceStatusAtOccurrence: item.service_status_at_occurrence,
      assessmentReference: normalizeReference(item.assessment_reference),
      correctionReason: item.correction_reason,
      signedAt: item.signed_at,
      signerDisplayName: item.signer_display_name,
      createdAt: item.created_at,
    })),
    versionHistoryTotal: row.version_history_total,
    versionHistoryTruncated:
      row.version_history_total > row.version_history.length,
  };
}

export function projectOccupationalTherapyServiceSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): OccupationalTherapyServiceSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data ||
      row.branch_id !== branch.data) invalid();

  const records = row.records.map(normalizeRecord);
  const sorted = [...records].sort((left, right) => {
    const time = new Date(right.occurredAt).getTime() -
      new Date(left.occurredAt).getTime();
    return time || left.recordKey.localeCompare(right.recordKey, "en");
  });
  if (
    records.some((item, index) => item.recordKey !== sorted[index]?.recordKey) ||
    !unique(records.map((item) => item.recordKey)) ||
    row.record_total !== records.length ||
    row.matching_total < row.record_total ||
    row.records_truncated !== (row.matching_total > row.record_total) ||
    (row.records_truncated && row.record_total !== 200) ||
    row.draft_total + row.signed_total + row.corrected_total !==
      row.matching_total ||
    [row.today_total, row.linked_assessment_total].some((value) =>
      value > row.matching_total) ||
    !unique(row.client_options.map((item) => item.client_id)) ||
    !unique(row.therapist_options.map((item) => item.user_id)) ||
    row.client_total < row.client_options.length ||
    row.client_options_truncated !==
      (row.client_total > row.client_options.length) ||
    (row.client_options_truncated && row.client_options.length !== 200) ||
    row.therapist_total < row.therapist_options.length ||
    row.therapist_options_truncated !==
      (row.therapist_total > row.therapist_options.length) ||
    (row.therapist_options_truncated &&
      row.therapist_options.length !== 200)
  ) invalid();

  if (!row.records_truncated) {
    const today = taipeiDate(row.generated_at);
    if (
      records.filter((item) => taipeiDate(item.occurredAt) === today).length !==
        row.today_total ||
      records.filter((item) => item.recordState === "draft").length !==
        row.draft_total ||
      records.filter((item) => item.recordState === "signed").length !==
        row.signed_total ||
      records.filter((item) => item.recordState === "corrected").length !==
        row.corrected_total ||
      records.filter((item) =>
        item.assessmentReference.status === "linked").length !==
        row.linked_assessment_total
    ) invalid();
  }

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(new Date(row.generated_at).getTime() + 60_000)
      .toISOString(),
    records,
    recordTotal: row.record_total,
    matchingTotal: row.matching_total,
    recordsTruncated: row.records_truncated,
    metrics: {
      today: row.today_total,
      drafts: row.draft_total,
      signed: row.signed_total,
      corrected: row.corrected_total,
      linkedAssessments: row.linked_assessment_total,
    },
    clientOptions: row.client_options.map((item) => ({
      clientId: item.client_id,
      displayName: item.display_name,
      serviceStatus: item.service_status,
      admittedOn: item.admitted_on,
      endedOn: item.ended_on,
    })),
    clientOptionsTruncated: row.client_options_truncated,
    therapistOptions: row.therapist_options.map((item) => ({
      userId: item.user_id,
      displayName: item.display_name,
    })),
    therapistOptionsTruncated: row.therapist_options_truncated,
    assessmentLinkStatus: row.assessment_link_status,
    formulaStatus: row.formula_status,
    diagnosisStatus: row.diagnosis_status,
    automaticRecommendationStatus: row.automatic_recommendation_status,
    attachmentStatus: row.attachment_status,
    exportStatus: row.export_status,
    offlineSyncStatus: row.offline_sync_status,
    demo: input.demo,
  };
}

export function filterDemoOccupationalTherapyServiceSnapshot(
  snapshot: OccupationalTherapyServiceSnapshot,
  filters: OccupationalTherapyServiceFilters,
): OccupationalTherapyServiceSnapshot {
  const keyword = filters.keyword?.toLocaleLowerCase("zh-Hant") ?? null;
  const records = snapshot.records.filter((record) => {
    const occurredDate = taipeiDate(record.occurredAt);
    const searchable = [
      record.clientDisplayName,
      record.serviceContent.text,
      record.clientReaction.text,
      record.recommendation.text,
    ].filter((value): value is string => value !== null)
      .join("\n").toLocaleLowerCase("zh-Hant");
    return (filters.dateFrom === null || occurredDate >= filters.dateFrom) &&
      (filters.dateTo === null || occurredDate <= filters.dateTo) &&
      (filters.clientId === null || record.clientId === filters.clientId) &&
      (filters.therapistUserId === null ||
        record.therapistUserId === filters.therapistUserId) &&
      (filters.recordState === null ||
        record.recordState === filters.recordState) &&
      (keyword === null || searchable.includes(keyword));
  });
  const today = taipeiDate(snapshot.generatedAt);
  return {
    ...snapshot,
    records,
    recordTotal: records.length,
    matchingTotal: records.length,
    recordsTruncated: false,
    metrics: {
      today: records.filter((item) =>
        taipeiDate(item.occurredAt) === today).length,
      drafts: records.filter((item) => item.recordState === "draft").length,
      signed: records.filter((item) => item.recordState === "signed").length,
      corrected: records.filter((item) =>
        item.recordState === "corrected").length,
      linkedAssessments: records.filter((item) =>
        item.assessmentReference.status === "linked").length,
    },
  };
}
