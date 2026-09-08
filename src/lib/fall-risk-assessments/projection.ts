import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  buildFallRiskTrialPreview,
  fallRiskAnswersSchema,
  fallRiskRuleSnapshotSchema,
} from "./parser";
import {
  CLIENT_SERVICE_STATUSES,
  FALL_RISK_PREVIEW_STATUSES,
  FALL_RISK_RULE_VERSION,
  type FallRiskAssessmentFilters,
  type FallRiskAssessmentSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) &&
    Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const positiveInteger = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number)
    .pipe(z.number().int().positive().safe()),
]);
const nonnegativeInteger = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const nullablePreviewInteger = z.union([
  z.number().int().min(0).max(6),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().min(0).max(6)),
]).nullable();
const text = (max: number) => z.string().trim().min(1).max(max);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

const historySchema = z.object({
  version_id: uuid,
  assessment_version: positiveInteger,
  record_state: z.literal("draft_preview"),
  assessed_on: date,
  author_user_id: uuid,
  author_display_name: text(120),
  service_status_at_assessment: z.enum(CLIENT_SERVICE_STATUSES),
  answers: fallRiskAnswersSchema,
  rule_version_id: z.literal(FALL_RISK_RULE_VERSION),
  rule_snapshot: fallRiskRuleSnapshotSchema,
  rule_snapshot_hash: sha256,
  governance_status: z.literal("candidate_unactivated"),
  preview_status: z.enum(FALL_RISK_PREVIEW_STATUSES),
  preview_candidate_points: nullablePreviewInteger,
  preview_band_key: text(80).nullable(),
  content_hash: sha256,
  created_at: timestamp,
}).strict();

const itemSchema = z.object({
  client_id: uuid,
  client_display_name: text(160),
  service_status: z.enum(CLIENT_SERVICE_STATUSES),
  admitted_on: date.nullable(),
  ended_on: date.nullable(),
  version_id: uuid.nullable(),
  assessment_key: uuid.nullable(),
  assessment_version: positiveInteger.nullable(),
  record_state: z.literal("draft_preview").nullable(),
  assessed_on: date.nullable(),
  author_user_id: uuid.nullable(),
  author_display_name: text(120).nullable(),
  service_status_at_assessment: z.enum(CLIENT_SERVICE_STATUSES).nullable(),
  answers: fallRiskAnswersSchema.nullable(),
  rule_version_id: z.literal(FALL_RISK_RULE_VERSION).nullable(),
  rule_snapshot: fallRiskRuleSnapshotSchema.nullable(),
  rule_snapshot_hash: sha256.nullable(),
  governance_status: z.literal("candidate_unactivated").nullable(),
  preview_status: z.enum(FALL_RISK_PREVIEW_STATUSES).nullable(),
  preview_candidate_points: nullablePreviewInteger,
  preview_band_key: text(80).nullable(),
  content_hash: sha256.nullable(),
  created_at: timestamp.nullable(),
  version_history: z.array(historySchema).max(50),
  version_history_total: nonnegativeInteger,
}).strict();

const clientOptionSchema = z.object({
  client_id: uuid,
  display_name: text(160),
  service_status: z.enum(CLIENT_SERVICE_STATUSES),
  admitted_on: date.nullable(),
  ended_on: date.nullable(),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  items: z.array(itemSchema).max(200),
  item_total: nonnegativeInteger,
  matching_total: nonnegativeInteger,
  items_truncated: z.boolean(),
  not_assessed_total: nonnegativeInteger,
  candidate_complete_total: nonnegativeInteger,
  incomplete_total: nonnegativeInteger,
  draft_total: nonnegativeInteger,
  client_options: z.array(clientOptionSchema).max(500),
  client_total: nonnegativeInteger,
  client_options_truncated: z.boolean(),
  rule_version_id: z.literal(FALL_RISK_RULE_VERSION),
  rule_activation_status: z.literal("candidate_unactivated"),
  formal_sign_status: z.literal("blocked_rule_not_activated"),
  formal_score_status: z.literal("not_available"),
  formal_risk_status: z.literal("not_available"),
  care_decision_status: z.literal("blocked"),
  draft_task_suggestion_status: z.literal("not_configured"),
  attachment_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"),
  offline_sync_status: z.literal("not_configured"),
  notification_status: z.literal("not_configured"),
}).strict();

export type FallRiskAssessmentSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_FALL_RISK_ASSESSMENT_SNAPSHOT");
}

function previewMatches(value: z.output<typeof historySchema>) {
  const computed = buildFallRiskTrialPreview(value.answers);
  return computed.status === value.preview_status &&
    computed.candidatePoints === value.preview_candidate_points &&
    computed.bandKey === value.preview_band_key;
}

function terminalMatchesHistory(
  item: z.output<typeof itemSchema>,
  history: z.output<typeof historySchema>,
) {
  return history.version_id === item.version_id &&
    history.assessment_version === item.assessment_version &&
    history.record_state === item.record_state &&
    history.assessed_on === item.assessed_on &&
    history.author_user_id === item.author_user_id &&
    history.author_display_name === item.author_display_name &&
    history.service_status_at_assessment === item.service_status_at_assessment &&
    JSON.stringify(history.answers) === JSON.stringify(item.answers) &&
    history.rule_version_id === item.rule_version_id &&
    JSON.stringify(history.rule_snapshot) === JSON.stringify(item.rule_snapshot) &&
    history.rule_snapshot_hash === item.rule_snapshot_hash &&
    history.governance_status === item.governance_status &&
    history.preview_status === item.preview_status &&
    history.preview_candidate_points === item.preview_candidate_points &&
    history.preview_band_key === item.preview_band_key &&
    history.content_hash === item.content_hash &&
    history.created_at === item.created_at;
}

function mapHistory(history: z.output<typeof historySchema>) {
  return {
    versionId: history.version_id,
    assessmentVersion: history.assessment_version,
    recordState: history.record_state,
    assessedOn: history.assessed_on,
    authorUserId: history.author_user_id,
    authorDisplayName: history.author_display_name,
    serviceStatusAtAssessment: history.service_status_at_assessment,
    answers: history.answers,
    ruleVersionId: history.rule_version_id,
    ruleSnapshot: history.rule_snapshot,
    ruleSnapshotHash: history.rule_snapshot_hash,
    governanceStatus: history.governance_status,
    previewStatus: history.preview_status,
    previewCandidatePoints: history.preview_candidate_points,
    previewBandKey: history.preview_band_key,
    contentHash: history.content_hash,
    createdAt: history.created_at,
  };
}

export function projectFallRiskAssessmentSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): FallRiskAssessmentSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (
    row.organization_id !== input.expectedOrganizationId.toLowerCase() ||
    row.branch_id !== input.expectedBranchId.toLowerCase() ||
    row.item_total !== row.items.length ||
    row.matching_total < row.item_total ||
    row.items_truncated !== (row.matching_total > row.item_total) ||
    row.draft_total !== row.candidate_complete_total + row.incomplete_total ||
    row.matching_total !== row.draft_total + row.not_assessed_total ||
    row.client_total < row.client_options.length ||
    row.client_options_truncated !==
      (row.client_total > row.client_options.length)
  ) invalid();

  const itemClientIds = row.items.map((item) => item.client_id);
  const optionIds = row.client_options.map((item) => item.client_id);
  if (
    new Set(itemClientIds).size !== itemClientIds.length ||
    new Set(optionIds).size !== optionIds.length ||
    (!row.client_options_truncated && itemClientIds.some((clientId) =>
      !optionIds.includes(clientId)))
  ) invalid();

  if (!row.items_truncated) {
    if (
      row.items.filter((item) => item.version_id === null).length !==
        row.not_assessed_total ||
      row.items.filter((item) =>
        item.preview_status === "candidate_complete"
      ).length !== row.candidate_complete_total ||
      row.items.filter((item) => item.preview_status === "incomplete").length !==
        row.incomplete_total ||
      row.items.filter((item) => item.version_id !== null).length !==
        row.draft_total
    ) invalid();
  }

  const items = row.items.map((item) => {
    const assessmentFields = [
      item.assessment_key, item.assessment_version, item.record_state,
      item.assessed_on, item.author_user_id, item.author_display_name,
      item.service_status_at_assessment, item.answers,
      item.rule_version_id,
      item.rule_snapshot, item.rule_snapshot_hash, item.governance_status,
      item.preview_status, item.content_hash, item.created_at,
    ];
    if (item.version_id === null) {
      if (
        assessmentFields.some((value) => value !== null) ||
        item.preview_candidate_points !== null ||
        item.preview_band_key !== null || item.version_history.length !== 0 ||
        item.version_history_total !== 0
      ) invalid();
    } else {
      if (
        assessmentFields.some((value) => value === null) ||
        item.version_history.length === 0 ||
        item.version_history_total < item.version_history.length ||
        (item.version_history_total > item.version_history.length &&
          item.version_history.length !== 50)
      ) invalid();
      const preview = buildFallRiskTrialPreview(item.answers!);
      if (
        preview.status !== item.preview_status ||
        preview.candidatePoints !== item.preview_candidate_points ||
        preview.bandKey !== item.preview_band_key
      ) invalid();
      const ids = new Set<string>();
      for (const [index, history] of item.version_history.entries()) {
        if (
          history.assessment_version !== item.assessment_version! - index ||
          ids.has(history.version_id) || !previewMatches(history)
        ) invalid();
        ids.add(history.version_id);
      }
      if (!terminalMatchesHistory(item, item.version_history[0]!)) invalid();
    }
    return {
      clientId: item.client_id,
      clientDisplayName: item.client_display_name,
      serviceStatus: item.service_status,
      admittedOn: item.admitted_on,
      endedOn: item.ended_on,
      versionId: item.version_id,
      assessmentKey: item.assessment_key,
      assessmentVersion: item.assessment_version,
      recordState: item.record_state,
      assessedOn: item.assessed_on,
      authorUserId: item.author_user_id,
      authorDisplayName: item.author_display_name,
      serviceStatusAtAssessment: item.service_status_at_assessment,
      answers: item.answers,
      ruleVersionId: item.rule_version_id,
      ruleSnapshot: item.rule_snapshot,
      ruleSnapshotHash: item.rule_snapshot_hash,
      governanceStatus: item.governance_status,
      previewStatus: item.preview_status,
      previewCandidatePoints: item.preview_candidate_points,
      previewBandKey: item.preview_band_key,
      contentHash: item.content_hash,
      createdAt: item.created_at,
      versionHistory: item.version_history.map(mapHistory),
      versionHistoryTotal: item.version_history_total,
      versionHistoryTruncated:
        item.version_history_total > item.version_history.length,
    };
  });

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(new Date(row.generated_at).getTime() + 60_000)
      .toISOString(),
    items,
    itemTotal: row.item_total,
    matchingTotal: row.matching_total,
    itemsTruncated: row.items_truncated,
    metrics: {
      notAssessed: row.not_assessed_total,
      candidateComplete: row.candidate_complete_total,
      incomplete: row.incomplete_total,
      drafts: row.draft_total,
    },
    clientOptions: row.client_options.map((item) => ({
      clientId: item.client_id,
      displayName: item.display_name,
      serviceStatus: item.service_status,
      admittedOn: item.admitted_on,
      endedOn: item.ended_on,
    })),
    clientOptionsTruncated: row.client_options_truncated,
    ruleVersionId: row.rule_version_id,
    ruleActivationStatus: row.rule_activation_status,
    formalSignStatus: row.formal_sign_status,
    formalScoreStatus: row.formal_score_status,
    formalRiskStatus: row.formal_risk_status,
    careDecisionStatus: row.care_decision_status,
    draftTaskSuggestionStatus: row.draft_task_suggestion_status,
    attachmentStatus: row.attachment_status,
    exportStatus: row.export_status,
    offlineSyncStatus: row.offline_sync_status,
    notificationStatus: row.notification_status,
    demo: input.demo,
  };
}

export function filterDemoFallRiskAssessmentSnapshot(
  snapshot: FallRiskAssessmentSnapshot,
  filters: FallRiskAssessmentFilters,
): FallRiskAssessmentSnapshot {
  const items = snapshot.items.filter((item) =>
    (filters.clientId === null || item.clientId === filters.clientId) &&
    (filters.previewStatus === "all" ||
      filters.previewStatus === "not_assessed" && item.versionId === null ||
      filters.previewStatus === item.previewStatus) &&
    (filters.answerState === "all" ||
      filters.answerState === "all_answered" && item.answers !== null &&
        Object.values(item.answers).every((answer) => answer.state === "answered") ||
      filters.answerState === "has_missing" && item.answers !== null &&
        Object.values(item.answers).some((answer) => answer.state === "missing") ||
      filters.answerState === "has_not_applicable" && item.answers !== null &&
        Object.values(item.answers).some((answer) =>
          answer.state === "not_applicable"))
  );
  return {
    ...snapshot,
    items,
    itemTotal: items.length,
    matchingTotal: items.length,
    itemsTruncated: false,
    metrics: {
      notAssessed: items.filter((item) => item.versionId === null).length,
      candidateComplete: items.filter((item) =>
        item.previewStatus === "candidate_complete").length,
      incomplete: items.filter((item) =>
        item.previewStatus === "incomplete").length,
      drafts: items.filter((item) => item.versionId !== null).length,
    },
  };
}
