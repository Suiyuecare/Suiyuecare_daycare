import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { mnaGovernanceSnapshotSchema } from "./parser";
import {
  CLIENT_SERVICE_STATUSES,
  MNA_FOLLOW_UP_STATUSES,
  MNA_GOVERNANCE_VERSION,
  MNA_RISK_STATES,
  type MnaAssessmentFilters,
  type MnaAssessmentSnapshot,
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
const decimal = (max: number) => z.union([
  z.number().min(0).max(max).multipleOf(0.5),
  z.string().regex(/^\d+(?:\.5)?$/u).transform(Number)
    .pipe(z.number().min(0).max(max).multipleOf(0.5)),
]);
const text = (max: number) => z.string().trim().min(1).max(max);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

const historySchema = z.object({
  version_id: uuid,
  assessment_version: positiveInteger,
  record_state: z.enum(["synthetic_demo_signed", "synthetic_demo_corrected"]),
  assessed_on: date,
  full_assessment_on: date.nullable(),
  author_user_id: uuid,
  author_display_name: text(120),
  service_status_at_assessment: z.enum(CLIENT_SERVICE_STATUSES),
  short_form_score: decimal(14),
  short_form_risk: z.enum(MNA_RISK_STATES),
  full_score: decimal(30).nullable(),
  full_risk: z.enum(MNA_RISK_STATES).nullable(),
  reassessment_due_on: date.nullable(),
  reassessment_basis: text(500).nullable(),
  follow_up_status: z.enum(MNA_FOLLOW_UP_STATUSES),
  follow_up_plan: text(2000).nullable(),
  follow_up_owner_display_name: text(120).nullable(),
  governance_version_id: z.literal(MNA_GOVERNANCE_VERSION),
  governance_snapshot: mnaGovernanceSnapshotSchema,
  governance_snapshot_hash: sha256,
  source_form_version_reference: text(240),
  signed_at: timestamp,
  signed_by_user_id: uuid,
  correction_of_version_id: uuid.nullable(),
  correction_reason: text(1000).nullable(),
  content_hash: sha256,
  created_at: timestamp,
}).strict().superRefine((value, context) => {
  const fullPair = value.full_score === null === (value.full_risk === null) &&
    value.full_score === null === (value.full_assessment_on === null);
  if (!fullPair) {
    context.addIssue({ code: "custom", path: ["full_score"], message: "完整評估欄位不一致。" });
  }
  if ((value.reassessment_due_on === null) !==
    (value.reassessment_basis === null)) {
    context.addIssue({ code: "custom", path: ["reassessment_due_on"], message: "人工期限與依據須成對。" });
  }
  if (value.record_state === "synthetic_demo_signed" &&
    (value.correction_of_version_id !== null || value.correction_reason !== null)) {
    context.addIssue({ code: "custom", path: ["correction_of_version_id"], message: "初版不應有更正來源。" });
  }
  if (value.record_state === "synthetic_demo_corrected" &&
    (value.correction_of_version_id === null || value.correction_reason === null)) {
    context.addIssue({ code: "custom", path: ["correction_of_version_id"], message: "更正版須有來源與理由。" });
  }
});

const nullableHistoryShape = {
  version_id: uuid.nullable(),
  assessment_key: uuid.nullable(),
  assessment_version: positiveInteger.nullable(),
  record_state: z.enum(["synthetic_demo_signed", "synthetic_demo_corrected"]).nullable(),
  assessed_on: date.nullable(),
  full_assessment_on: date.nullable(),
  author_user_id: uuid.nullable(),
  author_display_name: text(120).nullable(),
  service_status_at_assessment: z.enum(CLIENT_SERVICE_STATUSES).nullable(),
  short_form_score: decimal(14).nullable(),
  short_form_risk: z.enum(MNA_RISK_STATES).nullable(),
  full_score: decimal(30).nullable(),
  full_risk: z.enum(MNA_RISK_STATES).nullable(),
  reassessment_due_on: date.nullable(),
  reassessment_basis: text(500).nullable(),
  follow_up_status: z.enum(MNA_FOLLOW_UP_STATUSES).nullable(),
  follow_up_plan: text(2000).nullable(),
  follow_up_owner_display_name: text(120).nullable(),
  governance_version_id: z.literal(MNA_GOVERNANCE_VERSION).nullable(),
  governance_snapshot: mnaGovernanceSnapshotSchema.nullable(),
  governance_snapshot_hash: sha256.nullable(),
  source_form_version_reference: text(240).nullable(),
  signed_at: timestamp.nullable(),
  signed_by_user_id: uuid.nullable(),
  correction_of_version_id: uuid.nullable(),
  correction_reason: text(1000).nullable(),
  content_hash: sha256.nullable(),
  created_at: timestamp.nullable(),
};

const itemSchema = z.object({
  client_id: uuid,
  client_display_name: text(160),
  service_status: z.enum(CLIENT_SERVICE_STATUSES),
  admitted_on: date.nullable(),
  ended_on: date.nullable(),
  ...nullableHistoryShape,
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
  normal_total: nonnegativeInteger,
  at_risk_total: nonnegativeInteger,
  malnourished_total: nonnegativeInteger,
  follow_up_pending_total: nonnegativeInteger,
  client_options: z.array(clientOptionSchema).max(500),
  client_total: nonnegativeInteger,
  client_options_truncated: z.boolean(),
  governance_version_id: z.literal(MNA_GOVERNANCE_VERSION),
  license_status: z.literal("license_required_not_configured"),
  questionnaire_content_status: z.literal("not_configured"),
  scoring_algorithm_status: z.literal("not_configured"),
  risk_classification_status: z.literal("not_configured"),
  formal_draft_status: z.literal("blocked_license_not_configured"),
  formal_sign_status: z.literal("blocked_license_not_configured"),
  formal_correction_status: z.literal("blocked_license_not_configured"),
  automatic_reassessment_status: z.literal("not_configured"),
  automatic_follow_up_status: z.literal("not_configured"),
  attachment_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"),
  offline_sync_status: z.literal("not_configured"),
  notification_status: z.literal("not_configured"),
}).strict();

export type MnaAssessmentSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_MNA_ASSESSMENT_SNAPSHOT");
}

function mapHistory(value: z.output<typeof historySchema>) {
  return {
    versionId: value.version_id,
    assessmentVersion: value.assessment_version,
    recordState: value.record_state,
    assessedOn: value.assessed_on,
    fullAssessmentOn: value.full_assessment_on,
    authorUserId: value.author_user_id,
    authorDisplayName: value.author_display_name,
    serviceStatusAtAssessment: value.service_status_at_assessment,
    shortFormScore: value.short_form_score,
    shortFormRisk: value.short_form_risk,
    fullScore: value.full_score,
    fullRisk: value.full_risk,
    reassessmentDueOn: value.reassessment_due_on,
    reassessmentBasis: value.reassessment_basis,
    followUpStatus: value.follow_up_status,
    followUpPlan: value.follow_up_plan,
    followUpOwnerDisplayName: value.follow_up_owner_display_name,
    governanceVersionId: value.governance_version_id,
    governanceSnapshot: value.governance_snapshot,
    governanceSnapshotHash: value.governance_snapshot_hash,
    sourceFormVersionReference: value.source_form_version_reference,
    signedAt: value.signed_at,
    signedByUserId: value.signed_by_user_id,
    correctionOfVersionId: value.correction_of_version_id,
    correctionReason: value.correction_reason,
    contentHash: value.content_hash,
    createdAt: value.created_at,
  };
}

function terminalMatches(
  item: z.output<typeof itemSchema>,
  history: z.output<typeof historySchema>,
) {
  const mapped = mapHistory(history);
  return mapped.versionId === item.version_id &&
    mapped.assessmentVersion === item.assessment_version &&
    mapped.recordState === item.record_state &&
    mapped.assessedOn === item.assessed_on &&
    mapped.fullAssessmentOn === item.full_assessment_on &&
    mapped.authorUserId === item.author_user_id &&
    mapped.authorDisplayName === item.author_display_name &&
    mapped.serviceStatusAtAssessment === item.service_status_at_assessment &&
    mapped.shortFormScore === item.short_form_score &&
    mapped.shortFormRisk === item.short_form_risk &&
    mapped.fullScore === item.full_score && mapped.fullRisk === item.full_risk &&
    mapped.reassessmentDueOn === item.reassessment_due_on &&
    mapped.reassessmentBasis === item.reassessment_basis &&
    mapped.followUpStatus === item.follow_up_status &&
    mapped.followUpPlan === item.follow_up_plan &&
    mapped.followUpOwnerDisplayName === item.follow_up_owner_display_name &&
    mapped.governanceVersionId === item.governance_version_id &&
    JSON.stringify(mapped.governanceSnapshot) ===
      JSON.stringify(item.governance_snapshot) &&
    mapped.governanceSnapshotHash === item.governance_snapshot_hash &&
    mapped.sourceFormVersionReference === item.source_form_version_reference &&
    mapped.signedAt === item.signed_at &&
    mapped.signedByUserId === item.signed_by_user_id &&
    mapped.correctionOfVersionId === item.correction_of_version_id &&
    mapped.correctionReason === item.correction_reason &&
    mapped.contentHash === item.content_hash && mapped.createdAt === item.created_at;
}

export function projectMnaAssessmentSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): MnaAssessmentSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== input.expectedOrganizationId.toLowerCase() ||
    row.branch_id !== input.expectedBranchId.toLowerCase() ||
    row.item_total !== row.items.length || row.matching_total < row.item_total ||
    row.items_truncated !== (row.matching_total > row.item_total) ||
    row.matching_total !== row.not_assessed_total + row.normal_total +
      row.at_risk_total + row.malnourished_total ||
    row.client_total < row.client_options.length ||
    row.client_options_truncated !==
      (row.client_total > row.client_options.length)) invalid();

  const itemIds = row.items.map((item) => item.client_id);
  const optionIds = row.client_options.map((item) => item.client_id);
  if (new Set(itemIds).size !== itemIds.length ||
    new Set(optionIds).size !== optionIds.length ||
    (!row.client_options_truncated && itemIds.some((id) =>
      !optionIds.includes(id)))) invalid();

  if (!row.items_truncated) {
    if (row.items.filter((item) => item.version_id === null).length !==
      row.not_assessed_total ||
      row.items.filter((item) => item.short_form_risk === "normal").length !==
        row.normal_total ||
      row.items.filter((item) => item.short_form_risk === "at_risk").length !==
        row.at_risk_total ||
      row.items.filter((item) => item.short_form_risk === "malnourished").length !==
        row.malnourished_total ||
      row.items.filter((item) => item.follow_up_status !== null &&
        !["completed", "not_required"].includes(item.follow_up_status)).length !==
        row.follow_up_pending_total) invalid();
  }

  const items = row.items.map((item) => {
    const assessmentFields = Object.entries(item).filter(([key]) =>
      key !== "client_id" && key !== "client_display_name" &&
      key !== "service_status" && key !== "admitted_on" &&
      key !== "ended_on" && key !== "version_history" &&
      key !== "version_history_total").map(([, value]) => value);
    if (item.version_id === null) {
      if (assessmentFields.some((value) => value !== null) ||
        item.version_history.length !== 0 || item.version_history_total !== 0) {
        invalid();
      }
    } else {
      const requiredFields = [
        item.assessment_key, item.assessment_version, item.record_state,
        item.assessed_on, item.author_user_id, item.author_display_name,
        item.service_status_at_assessment, item.short_form_score,
        item.short_form_risk, item.follow_up_status,
        item.governance_version_id, item.governance_snapshot,
        item.governance_snapshot_hash, item.source_form_version_reference,
        item.signed_at, item.signed_by_user_id, item.content_hash,
        item.created_at,
      ];
      if (requiredFields.some((value) => value === null)) invalid();
      if (!input.demo || item.version_history.length === 0 ||
        item.version_history_total < item.version_history.length ||
        !terminalMatches(item, item.version_history[0]!)) invalid();
      const seen = new Set<string>();
      for (const [index, history] of item.version_history.entries()) {
        if (seen.has(history.version_id) ||
          history.assessment_version !== item.assessment_version! - index) invalid();
        seen.add(history.version_id);
        if (index > 0 &&
          item.version_history[index - 1]!.correction_of_version_id !==
            history.version_id) invalid();
      }
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
      fullAssessmentOn: item.full_assessment_on,
      authorUserId: item.author_user_id,
      authorDisplayName: item.author_display_name,
      serviceStatusAtAssessment: item.service_status_at_assessment,
      shortFormScore: item.short_form_score,
      shortFormRisk: item.short_form_risk,
      fullScore: item.full_score,
      fullRisk: item.full_risk,
      reassessmentDueOn: item.reassessment_due_on,
      reassessmentBasis: item.reassessment_basis,
      followUpStatus: item.follow_up_status,
      followUpPlan: item.follow_up_plan,
      followUpOwnerDisplayName: item.follow_up_owner_display_name,
      governanceVersionId: item.governance_version_id,
      governanceSnapshot: item.governance_snapshot,
      governanceSnapshotHash: item.governance_snapshot_hash,
      sourceFormVersionReference: item.source_form_version_reference,
      signedAt: item.signed_at,
      signedByUserId: item.signed_by_user_id,
      correctionOfVersionId: item.correction_of_version_id,
      correctionReason: item.correction_reason,
      contentHash: item.content_hash,
      createdAt: item.created_at,
      versionHistory: item.version_history.map(mapHistory),
      versionHistoryTotal: item.version_history_total,
      versionHistoryTruncated: item.version_history_total >
        item.version_history.length,
    };
  });

  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    staleAfter: new Date(new Date(row.generated_at).getTime() + 60_000).toISOString(),
    items,
    itemTotal: row.item_total,
    matchingTotal: row.matching_total,
    itemsTruncated: row.items_truncated,
    metrics: {
      notAssessed: row.not_assessed_total,
      normal: row.normal_total,
      atRisk: row.at_risk_total,
      malnourished: row.malnourished_total,
      followUpPending: row.follow_up_pending_total,
    },
    clientOptions: row.client_options.map((item) => ({
      clientId: item.client_id,
      displayName: item.display_name,
      serviceStatus: item.service_status,
      admittedOn: item.admitted_on,
      endedOn: item.ended_on,
    })),
    clientOptionsTruncated: row.client_options_truncated,
    governanceVersionId: row.governance_version_id,
    licenseStatus: row.license_status,
    questionnaireContentStatus: row.questionnaire_content_status,
    scoringAlgorithmStatus: row.scoring_algorithm_status,
    riskClassificationStatus: row.risk_classification_status,
    formalDraftStatus: row.formal_draft_status,
    formalSignStatus: row.formal_sign_status,
    formalCorrectionStatus: row.formal_correction_status,
    automaticReassessmentStatus: row.automatic_reassessment_status,
    automaticFollowUpStatus: row.automatic_follow_up_status,
    attachmentStatus: row.attachment_status,
    exportStatus: row.export_status,
    offlineSyncStatus: row.offline_sync_status,
    notificationStatus: row.notification_status,
    demo: input.demo,
  };
}

export function filterDemoMnaAssessmentSnapshot(
  snapshot: MnaAssessmentSnapshot,
  filters: MnaAssessmentFilters,
): MnaAssessmentSnapshot {
  const items = snapshot.items.filter((item) =>
    (filters.clientId === null || item.clientId === filters.clientId) &&
    (filters.risk === "all" ||
      filters.risk === "not_assessed" && item.versionId === null ||
      item.shortFormRisk === filters.risk) &&
    (filters.followUp === "all" ||
      filters.followUp === "not_assessed" && item.versionId === null ||
      filters.followUp === "completed" &&
        ["completed", "not_required"].includes(item.followUpStatus ?? "") ||
      filters.followUp === "pending" && item.followUpStatus !== null &&
        !["completed", "not_required"].includes(item.followUpStatus)));
  const assessed = items.filter((item) => item.versionId !== null);
  return {
    ...snapshot,
    items,
    itemTotal: items.length,
    matchingTotal: items.length,
    itemsTruncated: false,
    metrics: {
      notAssessed: items.filter((item) => item.versionId === null).length,
      normal: items.filter((item) => item.shortFormRisk === "normal").length,
      atRisk: items.filter((item) => item.shortFormRisk === "at_risk").length,
      malnourished: items.filter((item) =>
        item.shortFormRisk === "malnourished").length,
      followUpPending: assessed.filter((item) => item.followUpStatus !== null &&
        !["completed", "not_required"].includes(item.followUpStatus)).length,
    },
  };
}
