import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  ABCD_ASSESSMENT_STATES,
  ABCD_ASSESSMENT_TYPES,
  ABCD_VALUE_STATES,
  type AbcdAssessment,
  type AbcdAssessmentFilters,
  type AbcdAssessmentSnapshot,
  type AbcdAssessmentVersion,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const instant = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(instant.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant) === value;
});
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
const count = z.union([z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe())]);
const positive = z.union([z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe())]);
const year = z.union([z.number().int().min(2000).max(2200),
  z.string().regex(/^2\d{3}$/u).transform(Number).pipe(z.number().int().min(2000).max(2200))]);
const text = (max: number, min = 1) => z.string().trim().min(min).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const version = z.object({
  version_id: uuid, assessment_key: uuid, version: positive, previous_version_id: uuid.nullable(),
  content_hash: hash, assessment_state: z.enum(ABCD_ASSESSMENT_STATES), client_id: uuid,
  client_display_name: text(160), assessment_type: z.enum(ABCD_ASSESSMENT_TYPES),
  assessment_year: year, assessment_date: date, manual_summary: text(8_000),
  result_state: z.enum(ABCD_VALUE_STATES), result_text: text(4_000).nullable(),
  result_reason: text(1_000).nullable(), reassessment_state: z.enum(ABCD_VALUE_STATES),
  reassessment_date: date.nullable(), reassessment_basis: text(1_000),
  author_user_id: uuid, author_display_name: text(160), revision_reason: text(1_000).nullable(),
  correction_reason: text(1_000, 8).nullable(), signed_at: timestamp.nullable(),
  signed_by_user_id: uuid.nullable(), signer_display_name: text(160).nullable(),
  signer_role_keys: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/u)).min(1).max(50).nullable(),
  signature_purpose: text(160).nullable(), signature_reauth_challenge_id: uuid.nullable(),
  form_kind: z.literal("manual_unstandardized"), formal_rule_status: z.literal("not_configured"),
  created_at: timestamp,
}).strict();
const assessment = version.extend({ history: z.array(version).max(50), history_total: count }).strict();
const client = z.object({ client_id: uuid, display_name: text(160) }).strict();
const source = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp,
  assessments: z.array(assessment).max(200), matching_total: count, assessments_truncated: z.boolean(),
  assessment_total: count, a_total: count, b_total: count, c_total: count, d_total: count,
  reassessment_missing_total: count, draft_total: count, signed_total: count,
  clients: z.array(client).max(200), client_total: count, clients_truncated: z.boolean(),
  years: z.array(year).max(200), year_total: count, years_truncated: z.boolean(),
  form_kind: z.literal("manual_unstandardized"), formal_rule_status: z.literal("not_configured"),
  attachment_status: z.literal("not_configured"), notification_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"), offline_status: z.literal("not_configured"),
}).strict();

export type AbcdAssessmentSnapshotSourceRow = z.input<typeof source>;

function invalid(): never { throw new Error("INVALID_ABCD_ASSESSMENT_SNAPSHOT"); }
function unique(values: readonly string[]) { return new Set(values).size === values.length; }
function stableText(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0; }

function normalize(row: z.output<typeof version>): AbcdAssessmentVersion {
  const signed = row.assessment_state !== "draft";
  const expectedPurpose = row.assessment_state === "signed" ? "ABCD 人工候選評估簽署" :
    row.assessment_state === "corrected" ? "ABCD 人工候選評估更正簽署" : null;
  if ((row.version === 1) !== (row.previous_version_id === null) ||
    Number(row.assessment_date.slice(0, 4)) !== row.assessment_year ||
    (row.result_state === "recorded") !== (row.result_text !== null) ||
    (row.result_state === "recorded") !== (row.result_reason === null) ||
    (row.reassessment_state === "recorded") !== (row.reassessment_date !== null) ||
    (row.reassessment_date !== null && row.reassessment_date < row.assessment_date) ||
    signed !== (row.signed_at !== null && row.signed_by_user_id !== null &&
      row.signer_display_name !== null && row.signer_role_keys !== null &&
      row.signature_reauth_challenge_id !== null) || row.signature_purpose !== expectedPurpose ||
    (row.assessment_state === "draft") !== (row.revision_reason !== null) ||
    (row.assessment_state === "corrected") !== (row.correction_reason !== null) ||
    (row.assessment_state !== "corrected" && row.correction_reason !== null)) invalid();
  return {
    versionId: row.version_id, assessmentKey: row.assessment_key, version: row.version,
    previousVersionId: row.previous_version_id, contentHash: row.content_hash,
    assessmentState: row.assessment_state, clientId: row.client_id,
    clientDisplayName: row.client_display_name, assessmentType: row.assessment_type,
    assessmentYear: row.assessment_year, assessmentDate: row.assessment_date,
    manualSummary: row.manual_summary,
    result: { state: row.result_state, text: row.result_text, reason: row.result_reason },
    reassessment: { state: row.reassessment_state, date: row.reassessment_date,
      basis: row.reassessment_basis }, authorUserId: row.author_user_id,
    authorDisplayName: row.author_display_name, revisionReason: row.revision_reason,
    correctionReason: row.correction_reason, signedAt: row.signed_at,
    signedByUserId: row.signed_by_user_id, signerDisplayName: row.signer_display_name,
    signerRoleKeys: row.signer_role_keys, signaturePurpose: row.signature_purpose,
    signatureReauthChallengeId: row.signature_reauth_challenge_id,
    formKind: row.form_kind, formalRuleStatus: row.formal_rule_status, createdAt: row.created_at,
  };
}

function sameManualContent(left: AbcdAssessmentVersion, right: AbcdAssessmentVersion) {
  return left.assessmentType === right.assessmentType && left.assessmentYear === right.assessmentYear &&
    left.assessmentDate === right.assessmentDate && left.manualSummary === right.manualSummary &&
    left.result.state === right.result.state && left.result.text === right.result.text &&
    left.result.reason === right.result.reason && left.reassessment.state === right.reassessment.state &&
    left.reassessment.date === right.reassessment.date && left.reassessment.basis === right.reassessment.basis;
}

function matches(item: AbcdAssessmentVersion, filters: AbcdAssessmentFilters) {
  const needle = filters.query?.toLocaleLowerCase("zh-Hant-TW") ?? null;
  return (!filters.clientId || item.clientId === filters.clientId) &&
    (!filters.assessmentYear || item.assessmentYear === filters.assessmentYear) &&
    (filters.assessmentType === "all" || item.assessmentType === filters.assessmentType) &&
    (filters.reassessmentState === "all" || item.reassessment.state === filters.reassessmentState) &&
    (filters.status === "all" || item.assessmentState === filters.status) &&
    (!needle || item.clientDisplayName.toLocaleLowerCase("zh-Hant-TW").includes(needle) ||
      item.assessmentKey.includes(needle));
}

export function projectAbcdAssessmentSnapshot(input: { row: unknown; expectedOrganizationId: string;
  expectedBranchId: string; filters: AbcdAssessmentFilters; demo: boolean }): AbcdAssessmentSnapshot {
  const parsed = source.safeParse(input.row);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== input.expectedOrganizationId.toLowerCase() ||
    row.branch_id !== input.expectedBranchId.toLowerCase() || row.matching_total < row.assessments.length ||
    row.assessments_truncated !== (row.matching_total > row.assessments.length) ||
    (row.assessments_truncated && row.assessments.length !== 200) ||
    row.client_total < row.clients.length || row.clients_truncated !== (row.client_total > row.clients.length) ||
    (row.clients_truncated && row.clients.length !== 200) || row.year_total < row.years.length ||
    row.years_truncated !== (row.year_total > row.years.length) ||
    (row.years_truncated && row.years.length !== 200) ||
    !unique(row.assessments.map(({ assessment_key }) => assessment_key)) ||
    !unique(row.assessments.map((item) => `${item.client_id}:${item.assessment_year}:${item.assessment_type}`)) ||
    !unique(row.clients.map(({ client_id }) => client_id)) || !unique(row.years.map(String)) ||
    row.years.some((value, index) => index > 0 && value >= row.years[index - 1]!)) invalid();
  const assessments: AbcdAssessment[] = row.assessments.map((item) => {
    const latest = normalize(item);
    const history = item.history.map(normalize);
    if (item.history_total < history.length || (item.history_total > history.length && history.length !== 50) ||
      !unique(history.map(({ versionId }) => versionId)) || history.some((entry, index) =>
        entry.assessmentKey !== latest.assessmentKey || entry.clientId !== latest.clientId ||
        entry.assessmentType !== latest.assessmentType || entry.assessmentYear !== latest.assessmentYear ||
        entry.version !== index + 1 || (entry.signerRoleKeys !== null && !unique(entry.signerRoleKeys)) ||
        (index === 0 ? entry.previousVersionId !== null :
          entry.previousVersionId !== history[index - 1]?.versionId) ||
        (index > 0 && Date.parse(entry.createdAt) < Date.parse(history[index - 1]!.createdAt)) ||
        (index > 0 && entry.assessmentState === "signed" && !sameManualContent(entry, history[index - 1]!)) ||
        (index === 0 ? entry.assessmentState !== "draft" :
          entry.assessmentState === "draft" ? history[index - 1]?.assessmentState !== "draft" :
            entry.assessmentState === "signed" ? history[index - 1]?.assessmentState !== "draft" :
              !["signed", "corrected"].includes(history[index - 1]!.assessmentState))) ||
      (item.history_total === history.length && (history.at(-1)?.versionId !== latest.versionId ||
        history.at(-1)?.contentHash !== latest.contentHash)) || !matches(latest, input.filters)) invalid();
    return { ...latest, history, historyTotal: item.history_total,
      historyTruncated: item.history_total > history.length };
  });
  const sorted = [...assessments].sort((left, right) => stableText(right.assessmentDate, left.assessmentDate) ||
    stableText(left.clientId, right.clientId) || stableText(left.assessmentType, right.assessmentType) ||
    stableText(left.assessmentKey, right.assessmentKey));
  const visibleType = (type: "A" | "B" | "C" | "D") => assessments.filter((item) => item.assessmentType === type).length;
  const visibleMissing = assessments.filter((item) => item.reassessment.state === "missing").length;
  const visibleDraft = assessments.filter((item) => item.assessmentState === "draft").length;
  const visibleSigned = assessments.filter((item) => item.assessmentState !== "draft").length;
  const visible = [visibleType("A"), visibleType("B"), visibleType("C"), visibleType("D"),
    visibleMissing, visibleDraft, visibleSigned];
  const totals = [row.a_total, row.b_total, row.c_total, row.d_total,
    row.reassessment_missing_total, row.draft_total, row.signed_total];
  if (assessments.some((item, index) => item.assessmentKey !== sorted[index]?.assessmentKey) ||
    row.assessment_total !== row.matching_total ||
    row.a_total + row.b_total + row.c_total + row.d_total !== row.assessment_total ||
    row.draft_total + row.signed_total !== row.assessment_total ||
    row.reassessment_missing_total > row.assessment_total ||
    (!row.assessments_truncated && visible.some((value, index) => value !== totals[index])) ||
    (row.assessments_truncated && visible.some((value, index) => value > totals[index]!))) invalid();
  return { organizationId: row.organization_id, branchId: row.branch_id, generatedAt: row.generated_at,
    staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(), filters: input.filters,
    assessments, matchingTotal: row.matching_total, assessmentsTruncated: row.assessments_truncated,
    metrics: { assessmentTotal: row.assessment_total, aTotal: row.a_total, bTotal: row.b_total,
      cTotal: row.c_total, dTotal: row.d_total, reassessmentMissingTotal: row.reassessment_missing_total,
      draftTotal: row.draft_total, signedTotal: row.signed_total },
    clients: row.clients.map((item) => ({ clientId: item.client_id, displayName: item.display_name })),
    clientTotal: row.client_total, clientsTruncated: row.clients_truncated, years: row.years,
    yearTotal: row.year_total, yearsTruncated: row.years_truncated, formKind: row.form_kind,
    formalRuleStatus: row.formal_rule_status, attachmentStatus: row.attachment_status,
    notificationStatus: row.notification_status, exportStatus: row.export_status,
    offlineStatus: row.offline_status, demo: input.demo };
}
