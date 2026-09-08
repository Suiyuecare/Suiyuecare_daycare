import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { psychosocialDimensionsSchema } from "./parser";
import {
  CLIENT_SERVICE_STATUSES,
  PSYCHOSOCIAL_RECORD_STATES,
  type PsychosocialAssessmentFilters,
  type PsychosocialAssessmentSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) &&
    Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const nonnegativeInteger = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const positiveInteger = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number)
    .pipe(z.number().int().positive().safe()),
]);

const historySchema = z.object({
  version_id: uuid,
  assessment_version: positiveInteger,
  record_state: z.enum(PSYCHOSOCIAL_RECORD_STATES),
  assessed_on: date,
  responsible_user_id: uuid,
  responsible_display_name: z.string().trim().min(1).max(120),
  service_status_at_assessment: z.enum(CLIENT_SERVICE_STATUSES),
  reassessment_due_on: date,
  due_basis: z.string().trim().min(1).max(1000),
  dimensions: psychosocialDimensionsSchema,
  assessment_summary: z.string().trim().min(1).max(5000),
  form_basis: z.literal("manual_unstandardized"),
  form_version_reference: z.literal("manual-psychosocial-v1"),
  correction_reason: z.string().trim().min(1).max(1000).nullable(),
  signed_at: timestamp.nullable(),
  signer_display_name: z.string().trim().min(1).max(120).nullable(),
  created_at: timestamp,
}).strict();

const itemSchema = z.object({
  client_id: uuid,
  client_display_name: z.string().trim().min(1).max(160),
  service_status: z.enum(CLIENT_SERVICE_STATUSES),
  admitted_on: date.nullable(),
  ended_on: date.nullable(),
  version_id: uuid.nullable(),
  assessment_key: uuid.nullable(),
  assessment_version: positiveInteger.nullable(),
  record_state: z.enum(PSYCHOSOCIAL_RECORD_STATES).nullable(),
  assessed_on: date.nullable(),
  responsible_user_id: uuid.nullable(),
  responsible_display_name: z.string().trim().min(1).max(120).nullable(),
  service_status_at_assessment: z.enum(CLIENT_SERVICE_STATUSES).nullable(),
  reassessment_due_on: date.nullable(),
  reassessment_due: z.boolean(),
  due_basis: z.string().trim().min(1).max(1000).nullable(),
  dimensions: psychosocialDimensionsSchema.nullable(),
  assessment_summary: z.string().trim().min(1).max(5000).nullable(),
  form_basis: z.literal("manual_unstandardized").nullable(),
  form_version_reference: z.literal("manual-psychosocial-v1").nullable(),
  correction_reason: z.string().trim().min(1).max(1000).nullable(),
  signed_at: timestamp.nullable(),
  signer_display_name: z.string().trim().min(1).max(120).nullable(),
  created_at: timestamp.nullable(),
  version_history: z.array(historySchema).max(50),
  version_history_total: nonnegativeInteger,
}).strict();

const clientOptionSchema = z.object({
  client_id: uuid,
  display_name: z.string().trim().min(1).max(160),
  service_status: z.enum(CLIENT_SERVICE_STATUSES),
  admitted_on: date.nullable(),
  ended_on: date.nullable(),
}).strict();
const responsibleOptionSchema = z.object({
  user_id: uuid,
  display_name: z.string().trim().min(1).max(120),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  items: z.array(itemSchema).max(200),
  item_total: nonnegativeInteger,
  matching_total: nonnegativeInteger,
  items_truncated: z.boolean(),
  assessed_total: nonnegativeInteger,
  not_assessed_total: nonnegativeInteger,
  due_total: nonnegativeInteger,
  upcoming_total: nonnegativeInteger,
  draft_total: nonnegativeInteger,
  completed_total: nonnegativeInteger,
  client_options: z.array(clientOptionSchema).max(200),
  client_total: nonnegativeInteger,
  client_options_truncated: z.boolean(),
  responsible_options: z.array(responsibleOptionSchema).max(200),
  responsible_total: nonnegativeInteger,
  responsible_options_truncated: z.boolean(),
  assessment_method_status: z.literal("manual_unstandardized_only"),
  form_publication_status: z.literal("not_published_not_claimed"),
  due_rule_status: z.literal("not_configured_manual_date_and_basis_only"),
  score_status: z.literal("not_configured"),
  diagnosis_status: z.literal("not_configured"),
  attachment_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"),
  offline_sync_status: z.literal("not_configured"),
}).strict();

export type PsychosocialAssessmentSnapshotSourceRow = z.input<typeof sourceSchema>;

function taipeiDate(instant: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

function invalid(): never {
  throw new Error("INVALID_PSYCHOSOCIAL_SNAPSHOT");
}

export function projectPsychosocialAssessmentSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): PsychosocialAssessmentSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (
    row.organization_id !== input.expectedOrganizationId ||
    row.branch_id !== input.expectedBranchId ||
    row.item_total !== row.items.length ||
    row.matching_total < row.item_total ||
    row.items_truncated !== (row.matching_total > row.item_total) ||
    row.assessed_total + row.not_assessed_total !== row.matching_total ||
    row.draft_total + row.completed_total !== row.assessed_total ||
    row.due_total + row.upcoming_total !== row.assessed_total ||
    row.client_total < row.client_options.length ||
    row.client_options_truncated !==
      (row.client_total > row.client_options.length) ||
    row.responsible_total < row.responsible_options.length ||
    row.responsible_options_truncated !==
      (row.responsible_total > row.responsible_options.length)
  ) invalid();

  const today = taipeiDate(row.generated_at);
  const items = row.items.map((item) => {
    const unassessed = item.version_id === null;
    const assessmentFields = [
      item.assessment_key,
      item.assessment_version,
      item.record_state,
      item.assessed_on,
      item.responsible_user_id,
      item.responsible_display_name,
      item.service_status_at_assessment,
      item.reassessment_due_on,
      item.due_basis,
      item.dimensions,
      item.assessment_summary,
      item.form_basis,
      item.form_version_reference,
      item.created_at,
    ];
    if (unassessed) {
      if (
        assessmentFields.some((value) => value !== null) ||
        item.reassessment_due || item.version_history.length !== 0 ||
        item.version_history_total !== 0 || item.correction_reason !== null ||
        item.signed_at !== null || item.signer_display_name !== null
      ) invalid();
    } else {
      if (
        assessmentFields.some((value) => value === null) ||
        item.reassessment_due !== (item.reassessment_due_on! <= today) ||
        item.version_history_total < item.version_history.length ||
        item.record_state === "draft" &&
          (item.signed_at !== null || item.signer_display_name !== null) ||
        item.record_state !== "draft" &&
          (item.signed_at === null || item.signer_display_name === null) ||
        item.record_state === "corrected" && item.correction_reason === null ||
        item.record_state !== "corrected" && item.correction_reason !== null
      ) invalid();
      for (let index = 0; index < item.version_history.length; index += 1) {
        if (item.version_history[index]?.assessment_version !== index + 1) invalid();
      }
      if (
        item.version_history_total === item.version_history.length &&
        item.version_history.at(-1)?.version_id !== item.version_id
      ) invalid();
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
      responsibleUserId: item.responsible_user_id,
      responsibleDisplayName: item.responsible_display_name,
      serviceStatusAtAssessment: item.service_status_at_assessment,
      reassessmentDueOn: item.reassessment_due_on,
      reassessmentDue: item.reassessment_due,
      dueBasis: item.due_basis,
      dimensions: item.dimensions,
      assessmentSummary: item.assessment_summary,
      formBasis: item.form_basis,
      formVersionReference: item.form_version_reference,
      correctionReason: item.correction_reason,
      signedAt: item.signed_at,
      signerDisplayName: item.signer_display_name,
      createdAt: item.created_at,
      versionHistory: item.version_history.map((history) => ({
        versionId: history.version_id,
        assessmentVersion: history.assessment_version,
        recordState: history.record_state,
        assessedOn: history.assessed_on,
        responsibleUserId: history.responsible_user_id,
        responsibleDisplayName: history.responsible_display_name,
        serviceStatusAtAssessment: history.service_status_at_assessment,
        reassessmentDueOn: history.reassessment_due_on,
        dueBasis: history.due_basis,
        dimensions: history.dimensions,
        assessmentSummary: history.assessment_summary,
        formBasis: history.form_basis,
        formVersionReference: history.form_version_reference,
        correctionReason: history.correction_reason,
        signedAt: history.signed_at,
        signerDisplayName: history.signer_display_name,
        createdAt: history.created_at,
      })),
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
      assessed: row.assessed_total,
      notAssessed: row.not_assessed_total,
      due: row.due_total,
      upcoming: row.upcoming_total,
      drafts: row.draft_total,
      completed: row.completed_total,
    },
    clientOptions: row.client_options.map((item) => ({
      clientId: item.client_id,
      displayName: item.display_name,
      serviceStatus: item.service_status,
      admittedOn: item.admitted_on,
      endedOn: item.ended_on,
    })),
    clientOptionsTruncated: row.client_options_truncated,
    responsibleOptions: row.responsible_options.map((item) => ({
      userId: item.user_id,
      displayName: item.display_name,
    })),
    responsibleOptionsTruncated: row.responsible_options_truncated,
    assessmentMethodStatus: row.assessment_method_status,
    formPublicationStatus: row.form_publication_status,
    dueRuleStatus: row.due_rule_status,
    scoreStatus: row.score_status,
    diagnosisStatus: row.diagnosis_status,
    attachmentStatus: row.attachment_status,
    exportStatus: row.export_status,
    offlineSyncStatus: row.offline_sync_status,
    demo: input.demo,
  };
}

export function filterDemoPsychosocialAssessmentSnapshot(
  snapshot: PsychosocialAssessmentSnapshot,
  filters: PsychosocialAssessmentFilters,
): PsychosocialAssessmentSnapshot {
  const items = snapshot.items.filter((item) =>
    (filters.clientId === null || item.clientId === filters.clientId) &&
    (filters.responsibleUserId === null ||
      item.responsibleUserId === filters.responsibleUserId) &&
    (filters.serviceStatus === null ||
      item.serviceStatus === filters.serviceStatus) &&
    (filters.dueStatus === "all" ||
      filters.dueStatus === "due" && item.reassessmentDue ||
      filters.dueStatus === "upcoming" && item.versionId !== null &&
        !item.reassessmentDue ||
      filters.dueStatus === "not_assessed" && item.versionId === null)
  );
  const assessed = items.filter((item) => item.versionId !== null);
  return {
    ...snapshot,
    items,
    itemTotal: items.length,
    matchingTotal: items.length,
    itemsTruncated: false,
    metrics: {
      assessed: assessed.length,
      notAssessed: items.length - assessed.length,
      due: assessed.filter((item) => item.reassessmentDue).length,
      upcoming: assessed.filter((item) => !item.reassessmentDue).length,
      drafts: assessed.filter((item) => item.recordState === "draft").length,
      completed: assessed.filter((item) =>
        item.recordState === "signed" || item.recordState === "corrected"
      ).length,
    },
  };
}
