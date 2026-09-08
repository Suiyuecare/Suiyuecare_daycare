import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import type {
  ClientInspectionReportFilters,
  ClientInspectionReportSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(parsed) === value && Number(value.slice(0, 4)) >= 1900 &&
    Number(value.slice(0, 4)) <= 2200;
});
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const count = z.union([z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe())]);
const positive = z.union([z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe())]);
const clean = (maximum: number, minimum = 1, multiline = false) =>
  z.string().trim().min(minimum).max(maximum).refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const valueStatus = z.enum(["present", "missing", "not_applicable"]);
const attachmentStatus = z.enum(["provided", "missing", "not_applicable"]);
const duplicateBasis = z.enum([
  "exact_content", "same_client_type_date_source", "same_attachment_sha256",
]);

const duplicateMatch = z.object({ report_key: uuid, record_version_id: uuid,
  examined_on: date, match_kind: duplicateBasis }).strict();
const contentShape = {
  report_type: clean(160), examined_on: date, result_status: valueStatus,
  result_text: clean(4_000, 1, true).nullable(),
  result_reason: clean(1_000, 8, true).nullable(), source_status: valueStatus,
  source_text: clean(1_000, 1, true).nullable(),
  source_reason: clean(1_000, 8, true).nullable(),
  attachment_status: attachmentStatus, attachment_id: uuid.nullable(),
  attachment_sha256: sha256.nullable(),
  attachment_source_filename: clean(255).nullable(), payload_hash: sha256,
  content_hash: sha256,
};
const record = z.object({ record_version_id: uuid, report_key: uuid,
  version: positive, previous_version_id: uuid.nullable(),
  record_status: z.enum(["active", "voided"]),
  correction_reason: clean(1_000, 8, true).nullable(), client_id: uuid,
  client_code: clean(120), client_display_name: clean(160), ...contentShape,
  exact_duplicate_count: count, key_field_duplicate_count: count,
  attachment_duplicate_count: count, duplicate_warning: z.boolean(),
  duplicate_bases: z.array(duplicateBasis).max(3),
  duplicate_matches: z.array(duplicateMatch).max(200),
  duplicate_matches_truncated: z.boolean(), recorded_by: uuid,
  recorded_by_display_name: clean(160), recorded_at: timestamp,
}).strict();
const history = z.object({ record_version_id: uuid, report_key: uuid,
  version: positive, previous_version_id: uuid.nullable(),
  record_status: z.enum(["active", "voided"]),
  correction_reason: clean(1_000, 8, true).nullable(), ...contentShape,
  recorded_by_display_name: clean(160), recorded_at: timestamp,
}).strict();
const clientOption = z.object({ client_id: uuid, client_code: clean(120),
  display_name: clean(160) }).strict();
const typeOption = z.object({ report_type: clean(160), record_count: count }).strict();
const source = z.object({ organization_id: uuid, branch_id: uuid,
  generated_at: timestamp, snapshot_date: date, records: z.array(record).max(200),
  record_total: count, records_truncated: z.boolean(), active_total: count,
  voided_total: count, missing_result_total: count, missing_attachment_total: count,
  duplicate_warning_total: count, history: z.array(history).max(500),
  history_total: count, history_truncated: z.boolean(),
  client_options: z.array(clientOption).max(200), client_total: count,
  clients_truncated: z.boolean(), type_options: z.array(typeOption).max(200),
  type_total: count, types_truncated: z.boolean(),
  duplicate_rule_status: z.literal("configured"),
  duplicate_resolution: z.literal("warning_only_no_auto_merge"),
  report_type_taxonomy_status: z.literal("manual_unstandardized"),
  medical_interpretation_status: z.literal("not_configured"),
  diagnosis_status: z.literal("not_configured"), ocr_status: z.literal("not_configured"),
  attachment_pipeline_status: z.literal("not_configured"),
  attachment_scan_status: z.literal("not_configured"),
  attachment_download_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"), offline_status: z.literal("not_configured"),
  recent_aal2_max_age_minutes: z.literal(15),
}).strict();

export type ClientInspectionReportSnapshotSourceRow = z.input<typeof source>;

function invalid(): never { throw new Error("INVALID_CLIENT_INSPECTION_REPORT_SNAPSHOT"); }
function unique(values: readonly string[]) { return new Set(values).size === values.length; }
function stateValid(status: "present" | "missing" | "not_applicable",
  value: string | null, reason: string | null) {
  return status === "present" ? value !== null && reason === null :
    value === null && reason !== null;
}
function attachmentValid(item: z.output<typeof record> | z.output<typeof history>) {
  const populated = item.attachment_id !== null && item.attachment_sha256 !== null &&
    item.attachment_source_filename !== null;
  return item.attachment_status === "provided" ? populated :
    item.attachment_id === null && item.attachment_sha256 === null &&
      item.attachment_source_filename === null;
}
function matches(item: z.output<typeof record>, filters: ClientInspectionReportFilters) {
  const haystack = [item.client_code, item.client_display_name, item.report_type,
    item.result_text ?? item.result_reason ?? "", item.source_text ?? item.source_reason ?? "",
    item.attachment_source_filename ?? ""].join(" ").toLocaleLowerCase("zh-Hant-TW");
  return (filters.clientId === null || item.client_id === filters.clientId) &&
    (filters.reportType === null || item.report_type === filters.reportType) &&
    (filters.examinedFrom === null || item.examined_on >= filters.examinedFrom) &&
    (filters.examinedTo === null || item.examined_on <= filters.examinedTo) &&
    (filters.recordStatus === "all" || item.record_status === filters.recordStatus) &&
    (filters.resultStatus === "all" || item.result_status === filters.resultStatus) &&
    (filters.sourceStatus === "all" || item.source_status === filters.sourceStatus) &&
    (filters.attachmentStatus === "all" ||
      item.attachment_status === filters.attachmentStatus) &&
    (filters.duplicateStatus === "all" ||
      (filters.duplicateStatus === "any" && item.duplicate_warning) ||
      (filters.duplicateStatus === "exact" && item.exact_duplicate_count > 0) ||
      (filters.duplicateStatus === "key_fields" && item.key_field_duplicate_count > 0) ||
      (filters.duplicateStatus === "attachment" && item.attachment_duplicate_count > 0) ||
      (filters.duplicateStatus === "none" && !item.duplicate_warning)) &&
    (!filters.query || haystack.includes(filters.query.toLocaleLowerCase("zh-Hant-TW")));
}

export function projectClientInspectionReportSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: ClientInspectionReportFilters;
  demo: boolean;
}): ClientInspectionReportSnapshot {
  const parsed = source.safeParse(input.row);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== input.expectedOrganizationId.toLowerCase() ||
    row.branch_id !== input.expectedBranchId.toLowerCase() ||
    !unique(row.records.map(({ report_key }) => report_key)) ||
    !unique(row.records.map(({ record_version_id }) => record_version_id)) ||
    !unique(row.history.map(({ record_version_id }) => record_version_id)) ||
    !unique(row.client_options.map(({ client_id }) => client_id)) ||
    !unique(row.type_options.map(({ report_type }) => report_type.toLocaleLowerCase())) ||
    row.record_total < row.records.length ||
    row.active_total + row.voided_total !== row.record_total ||
    row.missing_result_total > row.record_total ||
    row.missing_attachment_total > row.record_total ||
    row.duplicate_warning_total > row.active_total ||
    row.records_truncated !== (row.record_total > row.records.length) ||
    (row.records_truncated && row.records.length !== 200) ||
    row.history_total < row.history.length ||
    row.history_total < row.records.length ||
    row.history_truncated !== (row.history_total > row.history.length) ||
    (row.history_truncated && row.history.length !== 500) ||
    row.client_total < row.client_options.length ||
    row.clients_truncated !== (row.client_total > row.client_options.length) ||
    row.type_total < row.type_options.length ||
    row.types_truncated !== (row.type_total > row.type_options.length)) invalid();

  const visibleKeys = new Set(row.records.map(({ report_key }) => report_key));
  for (const item of row.records) {
    const expectedBases = [item.exact_duplicate_count > 0 ? "exact_content" : null,
      item.key_field_duplicate_count > 0 ? "same_client_type_date_source" : null,
      item.attachment_duplicate_count > 0 ? "same_attachment_sha256" : null]
      .filter((value): value is z.output<typeof duplicateBasis> => value !== null);
    if (!matches(item, input.filters) ||
      !stateValid(item.result_status, item.result_text, item.result_reason) ||
      !stateValid(item.source_status, item.source_text, item.source_reason) ||
      !attachmentValid(item) || item.key_field_duplicate_count < item.exact_duplicate_count ||
      item.duplicate_warning !== (expectedBases.length > 0) ||
      JSON.stringify(item.duplicate_bases) !== JSON.stringify(expectedBases) ||
      item.duplicate_matches.length > item.exact_duplicate_count +
        item.key_field_duplicate_count + item.attachment_duplicate_count ||
      (!item.duplicate_matches_truncated && item.duplicate_matches.length !==
        item.exact_duplicate_count + item.key_field_duplicate_count +
          item.attachment_duplicate_count) ||
      item.duplicate_matches.filter(({ match_kind }) =>
        match_kind === "exact_content").length > item.exact_duplicate_count ||
      item.duplicate_matches.filter(({ match_kind }) =>
        match_kind === "same_client_type_date_source").length >
          item.key_field_duplicate_count ||
      item.duplicate_matches.filter(({ match_kind }) =>
        match_kind === "same_attachment_sha256").length >
          item.attachment_duplicate_count ||
      (item.record_status === "voided" && item.duplicate_warning) ||
      item.duplicate_matches.some((match) => match.report_key === item.report_key) ||
      !unique(item.duplicate_matches.map((match) =>
        `${match.record_version_id}:${match.match_kind}`))) invalid();
  }
  for (const item of row.history) if (!visibleKeys.has(item.report_key) ||
    !stateValid(item.result_status, item.result_text, item.result_reason) ||
    !stateValid(item.source_status, item.source_text, item.source_reason) ||
    !attachmentValid(item)) invalid();

  if (!row.history_truncated) for (const terminal of row.records) {
    const versions = row.history.filter(({ report_key }) => report_key === terminal.report_key)
      .sort((a, b) => a.version - b.version);
    if (versions.length !== terminal.version ||
      versions.some((item, index) => item.version !== index + 1 ||
        item.previous_version_id !== (index === 0 ? null : versions[index - 1]!.record_version_id)) ||
      versions.at(-1)?.record_version_id !== terminal.record_version_id) invalid();
  }

  if (!row.records_truncated) {
    if (row.active_total !== row.records.filter(({ record_status }) =>
      record_status === "active").length ||
      row.voided_total !== row.records.filter(({ record_status }) =>
        record_status === "voided").length ||
      row.missing_result_total !== row.records.filter(({ result_status }) =>
        result_status === "missing").length ||
      row.missing_attachment_total !== row.records.filter(({ attachment_status }) =>
        attachment_status === "missing").length ||
      row.duplicate_warning_total !== row.records.filter(({ duplicate_warning }) =>
        duplicate_warning).length) invalid();
  }

  const mapContent = (item: z.output<typeof record> | z.output<typeof history>) => ({
    reportType: item.report_type, examinedOn: item.examined_on,
    resultStatus: item.result_status, resultText: item.result_text,
    resultReason: item.result_reason, sourceStatus: item.source_status,
    sourceText: item.source_text, sourceReason: item.source_reason,
    attachmentStatus: item.attachment_status, attachmentId: item.attachment_id,
    attachmentSha256: item.attachment_sha256,
    attachmentSourceFilename: item.attachment_source_filename,
    payloadHash: item.payload_hash, contentHash: item.content_hash,
  });
  return { organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at, snapshotDate: row.snapshot_date,
    staleAfter: new Date(Date.parse(row.generated_at) + 5 * 60_000).toISOString(),
    filters: input.filters, records: row.records.map((item) => ({
      recordVersionId: item.record_version_id, reportKey: item.report_key,
      version: item.version, previousVersionId: item.previous_version_id,
      recordStatus: item.record_status, correctionReason: item.correction_reason,
      clientId: item.client_id, clientCode: item.client_code,
      clientDisplayName: item.client_display_name, ...mapContent(item),
      exactDuplicateCount: item.exact_duplicate_count,
      keyFieldDuplicateCount: item.key_field_duplicate_count,
      attachmentDuplicateCount: item.attachment_duplicate_count,
      duplicateWarning: item.duplicate_warning,
      duplicateBases: item.duplicate_bases,
      duplicateMatches: item.duplicate_matches.map((match) => ({
        reportKey: match.report_key, recordVersionId: match.record_version_id,
        examinedOn: match.examined_on, matchKind: match.match_kind,
      })), duplicateMatchesTruncated: item.duplicate_matches_truncated,
      recordedBy: item.recorded_by,
      recordedByDisplayName: item.recorded_by_display_name,
      recordedAt: item.recorded_at,
    })), recordTotal: row.record_total, recordsTruncated: row.records_truncated,
    activeTotal: row.active_total, voidedTotal: row.voided_total,
    missingResultTotal: row.missing_result_total,
    missingAttachmentTotal: row.missing_attachment_total,
    duplicateWarningTotal: row.duplicate_warning_total,
    history: row.history.map((item) => ({ recordVersionId: item.record_version_id,
      reportKey: item.report_key, version: item.version,
      previousVersionId: item.previous_version_id, recordStatus: item.record_status,
      correctionReason: item.correction_reason, ...mapContent(item),
      recordedByDisplayName: item.recorded_by_display_name,
      recordedAt: item.recorded_at })), historyTotal: row.history_total,
    historyTruncated: row.history_truncated,
    clientOptions: row.client_options.map((item) => ({ clientId: item.client_id,
      clientCode: item.client_code, displayName: item.display_name })),
    clientTotal: row.client_total, clientsTruncated: row.clients_truncated,
    typeOptions: row.type_options.map((item) => ({ reportType: item.report_type,
      recordCount: item.record_count })), typeTotal: row.type_total,
    typesTruncated: row.types_truncated,
    duplicateRuleStatus: row.duplicate_rule_status,
    duplicateResolution: row.duplicate_resolution,
    reportTypeTaxonomyStatus: row.report_type_taxonomy_status,
    medicalInterpretationStatus: row.medical_interpretation_status,
    diagnosisStatus: row.diagnosis_status, ocrStatus: row.ocr_status,
    attachmentPipelineStatus: row.attachment_pipeline_status,
    attachmentScanStatus: row.attachment_scan_status,
    attachmentDownloadStatus: row.attachment_download_status,
    exportStatus: row.export_status, offlineStatus: row.offline_status,
    recentAal2MaxAgeMinutes: row.recent_aal2_max_age_minutes, demo: input.demo };
}
