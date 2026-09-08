import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { physicalTherapyMeasurementsSchema } from "./parser";
import {
  CLIENT_SERVICE_STATUSES,
  PHYSICAL_THERAPY_RECORD_STATES,
  type PhysicalTherapyAssessmentFilters,
  type PhysicalTherapyAssessmentSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
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
const narrative = (max: number) => z.string().trim().min(1).max(max);

const historySchema = z.object({
  version_id: uuid,
  assessment_version: positiveInteger,
  record_state: z.enum(PHYSICAL_THERAPY_RECORD_STATES),
  assessed_on: date,
  therapist_user_id: uuid,
  therapist_display_name: narrative(120),
  service_status_at_assessment: z.enum(CLIENT_SERVICE_STATUSES),
  reassessment_due_on: date,
  due_basis: narrative(1000),
  measurements: physicalTherapyMeasurementsSchema,
  functional_observation: narrative(5000),
  goals: narrative(5000),
  recommendations: narrative(5000),
  follow_up_plan: narrative(5000),
  form_basis: z.literal("manual_unstandardized"),
  form_version_reference: z.literal("manual-physical-therapy-v1"),
  correction_reason: narrative(1000).nullable(),
  signed_at: timestamp.nullable(),
  signer_display_name: narrative(120).nullable(),
  created_at: timestamp,
}).strict();

const itemSchema = z.object({
  client_id: uuid,
  client_display_name: narrative(160),
  service_status: z.enum(CLIENT_SERVICE_STATUSES),
  admitted_on: date.nullable(),
  ended_on: date.nullable(),
  version_id: uuid.nullable(),
  assessment_key: uuid.nullable(),
  assessment_version: positiveInteger.nullable(),
  record_state: z.enum(PHYSICAL_THERAPY_RECORD_STATES).nullable(),
  assessed_on: date.nullable(),
  therapist_user_id: uuid.nullable(),
  therapist_display_name: narrative(120).nullable(),
  service_status_at_assessment: z.enum(CLIENT_SERVICE_STATUSES).nullable(),
  reassessment_due_on: date.nullable(),
  reassessment_due: z.boolean(),
  due_basis: narrative(1000).nullable(),
  measurements: physicalTherapyMeasurementsSchema.nullable(),
  functional_observation: narrative(5000).nullable(),
  goals: narrative(5000).nullable(),
  recommendations: narrative(5000).nullable(),
  follow_up_plan: narrative(5000).nullable(),
  form_basis: z.literal("manual_unstandardized").nullable(),
  form_version_reference: z.literal("manual-physical-therapy-v1").nullable(),
  correction_reason: narrative(1000).nullable(),
  signed_at: timestamp.nullable(),
  signer_display_name: narrative(120).nullable(),
  created_at: timestamp.nullable(),
  version_history: z.array(historySchema).max(50),
  version_history_total: nonnegativeInteger,
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
  therapist_options: z.array(therapistOptionSchema).max(200),
  therapist_total: nonnegativeInteger,
  therapist_options_truncated: z.boolean(),
  assessment_method_status: z.literal("manual_unstandardized_only"),
  form_publication_status: z.literal("not_published_not_claimed"),
  due_rule_status: z.literal("not_configured_manual_date_and_basis_only"),
  formula_status: z.literal("not_configured"),
  score_status: z.literal("not_configured"),
  diagnosis_status: z.literal("not_configured"),
  attachment_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"),
  reminder_status: z.literal("not_configured"),
  offline_sync_status: z.literal("not_configured"),
}).strict();

export type PhysicalTherapyAssessmentSnapshotSourceRow =
  z.input<typeof sourceSchema>;

function taipeiDate(instant: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

function invalid(): never {
  throw new Error("INVALID_PHYSICAL_THERAPY_SNAPSHOT");
}

function validSignedState(item: z.output<typeof historySchema>) {
  return item.record_state === "draft"
    ? item.signed_at === null && item.signer_display_name === null &&
      item.correction_reason === null
    : item.record_state === "signed"
      ? item.signed_at !== null && item.signer_display_name !== null &&
        item.correction_reason === null
      : item.signed_at !== null && item.signer_display_name !== null &&
        item.correction_reason !== null;
}

function terminalMatchesHistory(
  item: z.output<typeof itemSchema>,
  history: z.output<typeof historySchema>,
) {
  return history.version_id === item.version_id &&
    history.assessment_version === item.assessment_version &&
    history.record_state === item.record_state &&
    history.assessed_on === item.assessed_on &&
    history.therapist_user_id === item.therapist_user_id &&
    history.therapist_display_name === item.therapist_display_name &&
    history.service_status_at_assessment === item.service_status_at_assessment &&
    history.reassessment_due_on === item.reassessment_due_on &&
    history.due_basis === item.due_basis &&
    JSON.stringify(history.measurements) === JSON.stringify(item.measurements) &&
    history.functional_observation === item.functional_observation &&
    history.goals === item.goals &&
    history.recommendations === item.recommendations &&
    history.follow_up_plan === item.follow_up_plan &&
    history.form_basis === item.form_basis &&
    history.form_version_reference === item.form_version_reference &&
    history.correction_reason === item.correction_reason &&
    history.signed_at === item.signed_at &&
    history.signer_display_name === item.signer_display_name &&
    history.created_at === item.created_at;
}

export function projectPhysicalTherapyAssessmentSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): PhysicalTherapyAssessmentSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  if (!parsed.success) invalid();
  const row = parsed.data;
  const itemClientIds = row.items.map((item) => item.client_id);
  const clientOptionIds = row.client_options.map((item) => item.client_id);
  const therapistOptionIds = row.therapist_options.map((item) => item.user_id);
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
    row.therapist_total < row.therapist_options.length ||
    row.therapist_options_truncated !==
      (row.therapist_total > row.therapist_options.length) ||
    new Set(itemClientIds).size !== itemClientIds.length ||
    new Set(clientOptionIds).size !== clientOptionIds.length ||
    new Set(therapistOptionIds).size !== therapistOptionIds.length ||
    (!row.client_options_truncated && itemClientIds.some((clientId) =>
      !clientOptionIds.includes(clientId))) ||
    (!row.therapist_options_truncated && row.items.some((item) =>
      item.therapist_user_id !== null &&
      !therapistOptionIds.includes(item.therapist_user_id)))
  ) invalid();

  if (!row.items_truncated) {
    const assessed = row.items.filter((item) => item.version_id !== null);
    if (
      assessed.length !== row.assessed_total ||
      row.items.length - assessed.length !== row.not_assessed_total ||
      assessed.filter((item) => item.reassessment_due).length !== row.due_total ||
      assessed.filter((item) => !item.reassessment_due).length !== row.upcoming_total ||
      assessed.filter((item) => item.record_state === "draft").length !==
        row.draft_total ||
      assessed.filter((item) =>
        item.record_state === "signed" || item.record_state === "corrected"
      ).length !== row.completed_total
    ) invalid();
  }

  const today = taipeiDate(row.generated_at);
  const items = row.items.map((item) => {
    const assessmentFields = [
      item.assessment_key,
      item.assessment_version,
      item.record_state,
      item.assessed_on,
      item.therapist_user_id,
      item.therapist_display_name,
      item.service_status_at_assessment,
      item.reassessment_due_on,
      item.due_basis,
      item.measurements,
      item.functional_observation,
      item.goals,
      item.recommendations,
      item.follow_up_plan,
      item.form_basis,
      item.form_version_reference,
      item.created_at,
    ];
    if (item.version_id === null) {
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
        (item.version_history_total > item.version_history.length &&
          item.version_history.length !== 50) ||
        !validSignedState({
          version_id: item.version_id,
          assessment_version: item.assessment_version!,
          record_state: item.record_state!,
          assessed_on: item.assessed_on!,
          therapist_user_id: item.therapist_user_id!,
          therapist_display_name: item.therapist_display_name!,
          service_status_at_assessment: item.service_status_at_assessment!,
          reassessment_due_on: item.reassessment_due_on!,
          due_basis: item.due_basis!,
          measurements: item.measurements!,
          functional_observation: item.functional_observation!,
          goals: item.goals!,
          recommendations: item.recommendations!,
          follow_up_plan: item.follow_up_plan!,
          form_basis: item.form_basis!,
          form_version_reference: item.form_version_reference!,
          correction_reason: item.correction_reason,
          signed_at: item.signed_at,
          signer_display_name: item.signer_display_name,
          created_at: item.created_at!,
        })
      ) invalid();
      const ids = new Set<string>();
      for (let index = 0; index < item.version_history.length; index += 1) {
        const history = item.version_history[index]!;
        if (
          history.assessment_version !== index + 1 ||
          history.reassessment_due_on < history.assessed_on ||
          !validSignedState(history) || ids.has(history.version_id)
        ) invalid();
        ids.add(history.version_id);
      }
      if (
        item.version_history_total === item.version_history.length &&
        (!item.version_history.at(-1) ||
          !terminalMatchesHistory(item, item.version_history.at(-1)!))
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
      therapistUserId: item.therapist_user_id,
      therapistDisplayName: item.therapist_display_name,
      serviceStatusAtAssessment: item.service_status_at_assessment,
      reassessmentDueOn: item.reassessment_due_on,
      reassessmentDue: item.reassessment_due,
      dueBasis: item.due_basis,
      measurements: item.measurements,
      functionalObservation: item.functional_observation,
      goals: item.goals,
      recommendations: item.recommendations,
      followUpPlan: item.follow_up_plan,
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
        therapistUserId: history.therapist_user_id,
        therapistDisplayName: history.therapist_display_name,
        serviceStatusAtAssessment: history.service_status_at_assessment,
        reassessmentDueOn: history.reassessment_due_on,
        dueBasis: history.due_basis,
        measurements: history.measurements,
        functionalObservation: history.functional_observation,
        goals: history.goals,
        recommendations: history.recommendations,
        followUpPlan: history.follow_up_plan,
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
    therapistOptions: row.therapist_options.map((item) => ({
      userId: item.user_id,
      displayName: item.display_name,
    })),
    therapistOptionsTruncated: row.therapist_options_truncated,
    assessmentMethodStatus: row.assessment_method_status,
    formPublicationStatus: row.form_publication_status,
    dueRuleStatus: row.due_rule_status,
    formulaStatus: row.formula_status,
    scoreStatus: row.score_status,
    diagnosisStatus: row.diagnosis_status,
    attachmentStatus: row.attachment_status,
    exportStatus: row.export_status,
    reminderStatus: row.reminder_status,
    offlineSyncStatus: row.offline_sync_status,
    demo: input.demo,
  };
}

export function filterDemoPhysicalTherapyAssessmentSnapshot(
  snapshot: PhysicalTherapyAssessmentSnapshot,
  filters: PhysicalTherapyAssessmentFilters,
): PhysicalTherapyAssessmentSnapshot {
  const items = snapshot.items.filter((item) =>
    (filters.clientId === null || item.clientId === filters.clientId) &&
    (filters.therapistUserId === null ||
      item.therapistUserId === filters.therapistUserId) &&
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
