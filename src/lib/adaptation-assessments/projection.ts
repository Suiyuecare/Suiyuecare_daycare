import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  ADAPTATION_FOLLOW_UP_STATUSES,
  ADAPTATION_RECORD_STATES,
  ADAPTATION_STATUSES,
  CLIENT_SERVICE_STATUSES,
  type AdaptationAssessmentFilters,
  type AdaptationAssessmentListItem,
  type AdaptationAssessmentSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const positiveInteger = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(z.number().int().positive().safe()),
]);
const narrative = (max: number) => z.string().trim().min(1).max(max);

const versionHistorySchema = z.object({
  version_id: uuid,
  assessment_version: positiveInteger,
  record_state: z.enum(ADAPTATION_RECORD_STATES),
  assessed_on: date,
  adaptation_status: z.enum(ADAPTATION_STATUSES),
  assessment_summary: narrative(5000),
  reassessment_due_on: date,
  needs_follow_up: z.boolean(),
  form_basis: z.literal("manual_unstandardized"),
  form_version_reference: z.literal("manual-adaptation-v1"),
  correction_reason: narrative(1000).nullable(),
  assessor_display_name: narrative(120),
  signed_at: timestamp.nullable(),
  signer_display_name: narrative(120).nullable(),
  created_at: timestamp,
}).strict();

const followUpHistorySchema = z.object({
  event_id: uuid,
  sequence: positiveInteger,
  follow_up_status: z.enum(ADAPTATION_FOLLOW_UP_STATUSES),
  due_on: date.nullable(),
  follow_up_plan: narrative(2000).nullable(),
  follow_up_outcome: narrative(2000).nullable(),
  transition_reason: narrative(1000).nullable(),
  committer_display_name: narrative(120),
  committed_at: timestamp,
}).strict();

const itemSchema = z.object({
  client_id: uuid,
  client_display_name: narrative(120),
  service_status: z.enum(CLIENT_SERVICE_STATUSES),
  admitted_on: date.nullable(),
  ended_on: date.nullable(),
  version_id: uuid.nullable(),
  assessment_key: uuid.nullable(),
  assessment_version: positiveInteger.nullable(),
  record_state: z.enum(ADAPTATION_RECORD_STATES).nullable(),
  assessed_on: date.nullable(),
  adaptation_status: z.enum(ADAPTATION_STATUSES).nullable(),
  assessment_summary: narrative(5000).nullable(),
  reassessment_due_on: date.nullable(),
  reassessment_due: z.boolean(),
  needs_follow_up: z.boolean(),
  current_follow_up_status: z.enum([
    "not_assessed", "not_required", "not_started",
    ...ADAPTATION_FOLLOW_UP_STATUSES,
  ]),
  form_basis: z.literal("manual_unstandardized").nullable(),
  form_version_reference: z.literal("manual-adaptation-v1").nullable(),
  assessor_user_id: uuid.nullable(),
  assessor_display_name: narrative(120).nullable(),
  correction_reason: narrative(1000).nullable(),
  signed_at: timestamp.nullable(),
  signer_display_name: narrative(120).nullable(),
  created_at: timestamp.nullable(),
  follow_up_event_id: uuid.nullable(),
  follow_up_sequence: count,
  follow_up_status: z.enum(ADAPTATION_FOLLOW_UP_STATUSES).nullable(),
  follow_up_due_on: date.nullable(),
  follow_up_plan: narrative(2000).nullable(),
  follow_up_outcome: narrative(2000).nullable(),
  follow_up_transition_reason: narrative(1000).nullable(),
  follow_up_committer_display_name: narrative(120).nullable(),
  follow_up_committed_at: timestamp.nullable(),
  follow_up_overdue: z.boolean(),
  version_history: z.array(versionHistorySchema).max(50),
  version_history_total: count,
  follow_up_history: z.array(followUpHistorySchema).max(50),
  follow_up_history_total: count,
}).strict();

const clientOptionSchema = z.object({
  client_id: uuid,
  display_name: narrative(120),
  service_status: z.enum(CLIENT_SERVICE_STATUSES),
  admitted_on: date.nullable(),
  ended_on: date.nullable(),
}).strict();
const assessorOptionSchema = z.object({
  user_id: uuid,
  display_name: narrative(120),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  items: z.array(itemSchema).max(200),
  item_total: count,
  matching_total: count,
  items_truncated: z.boolean(),
  assessed_total: count,
  not_assessed_total: count,
  reassessment_due_total: count,
  needs_follow_up_total: count,
  open_follow_up_total: count,
  overdue_follow_up_total: count,
  draft_total: count,
  completed_total: count,
  client_options: z.array(clientOptionSchema).max(200),
  client_total: count,
  client_options_truncated: z.boolean(),
  assessor_options: z.array(assessorOptionSchema).max(200),
  assessor_total: count,
  assessor_options_truncated: z.boolean(),
  assessment_method_status: z.literal("manual_unstandardized_only"),
  form_publication_status: z.literal("not_published_not_claimed"),
  offline_sync_status: z.literal("not_configured"),
  follow_up_notification_status: z.literal("none_not_sent"),
}).strict();

export type AdaptationAssessmentSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_ADAPTATION_ASSESSMENT_PROJECTION");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function compareC(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function validVersionState(item: z.output<typeof versionHistorySchema>) {
  return item.record_state === "draft"
    ? item.correction_reason === null && item.signed_at === null &&
      item.signer_display_name === null
    : item.record_state === "signed"
      ? item.correction_reason === null && item.signed_at !== null &&
        item.signer_display_name !== null
      : item.correction_reason !== null && item.signed_at !== null &&
        item.signer_display_name !== null;
}

function validFollowUpState(item: z.output<typeof followUpHistorySchema>) {
  return item.follow_up_status === "pending"
    ? item.due_on !== null && item.follow_up_plan !== null &&
      item.follow_up_outcome === null && item.transition_reason === null
    : item.follow_up_status === "completed"
      ? item.due_on === null && item.follow_up_plan === null &&
        item.follow_up_outcome !== null && item.transition_reason === null
      : item.due_on === null && item.follow_up_plan === null &&
        item.follow_up_outcome === null && item.transition_reason !== null;
}

function normalizeItem(
  row: z.output<typeof itemSchema>,
  generatedDate: string,
): AdaptationAssessmentListItem {
  const versionHistoryTruncated = row.version_history_total > row.version_history.length;
  const followUpHistoryTruncated = row.follow_up_history_total > row.follow_up_history.length;
  if (
    row.version_history_total < row.version_history.length ||
    (versionHistoryTruncated && row.version_history.length !== 50) ||
    !unique(row.version_history.map((item) => item.version_id)) ||
    row.version_history.some((item, index) =>
      item.assessment_version !== index + 1 || !validVersionState(item) ||
      item.reassessment_due_on < item.assessed_on,
    ) ||
    row.follow_up_history_total < row.follow_up_history.length ||
    (followUpHistoryTruncated && row.follow_up_history.length !== 50) ||
    !unique(row.follow_up_history.map((item) => item.event_id)) ||
    row.follow_up_history.some((item, index) =>
      item.sequence !== index + 1 || !validFollowUpState(item),
    )
  ) invalid();

  if (row.version_id === null) {
    if (
      row.assessment_key !== null || row.assessment_version !== null ||
      row.record_state !== null || row.assessed_on !== null ||
      row.adaptation_status !== null || row.assessment_summary !== null ||
      row.reassessment_due_on !== null || row.reassessment_due ||
      row.needs_follow_up || row.current_follow_up_status !== "not_assessed" ||
      row.form_basis !== null || row.form_version_reference !== null ||
      row.assessor_user_id !== null || row.assessor_display_name !== null ||
      row.correction_reason !== null || row.signed_at !== null ||
      row.signer_display_name !== null || row.created_at !== null ||
      row.follow_up_event_id !== null || row.follow_up_sequence !== 0 ||
      row.follow_up_status !== null || row.follow_up_due_on !== null ||
      row.follow_up_plan !== null || row.follow_up_outcome !== null ||
      row.follow_up_transition_reason !== null ||
      row.follow_up_committer_display_name !== null ||
      row.follow_up_committed_at !== null || row.follow_up_overdue ||
      row.version_history_total !== 0 || row.follow_up_history_total !== 0
    ) invalid();
  } else {
    if (
      row.assessment_key === null || row.assessment_version === null ||
      row.record_state === null || row.assessed_on === null ||
      row.adaptation_status === null || row.assessment_summary === null ||
      row.reassessment_due_on === null || row.form_basis !== "manual_unstandardized" ||
      row.form_version_reference !== "manual-adaptation-v1" ||
      row.assessor_user_id === null || row.assessor_display_name === null ||
      row.created_at === null || row.reassessment_due_on < row.assessed_on ||
      row.reassessment_due !== (row.reassessment_due_on <= generatedDate) ||
      !validVersionState({
        version_id: row.version_id,
        assessment_version: row.assessment_version,
        record_state: row.record_state,
        assessed_on: row.assessed_on,
        adaptation_status: row.adaptation_status,
        assessment_summary: row.assessment_summary,
        reassessment_due_on: row.reassessment_due_on,
        needs_follow_up: row.needs_follow_up,
        form_basis: row.form_basis,
        form_version_reference: row.form_version_reference,
        correction_reason: row.correction_reason,
        assessor_display_name: row.assessor_display_name,
        signed_at: row.signed_at,
        signer_display_name: row.signer_display_name,
        created_at: row.created_at,
      })
    ) invalid();
    const latestVersion = row.version_history.at(-1);
    if (!versionHistoryTruncated && (
      latestVersion?.version_id !== row.version_id ||
      latestVersion.assessment_version !== row.assessment_version ||
      latestVersion.record_state !== row.record_state ||
      latestVersion.assessed_on !== row.assessed_on ||
      latestVersion.adaptation_status !== row.adaptation_status ||
      latestVersion.assessment_summary !== row.assessment_summary ||
      latestVersion.reassessment_due_on !== row.reassessment_due_on ||
      latestVersion.needs_follow_up !== row.needs_follow_up
    )) invalid();
  }

  const latestFollowUp = row.follow_up_history.at(-1);
  if (row.follow_up_event_id === null) {
    const expectedCurrent = row.version_id === null ? "not_assessed"
      : row.needs_follow_up ? "not_started" : "not_required";
    if (
      row.follow_up_sequence !== 0 || row.follow_up_status !== null ||
      row.follow_up_due_on !== null || row.follow_up_plan !== null ||
      row.follow_up_outcome !== null || row.follow_up_transition_reason !== null ||
      row.follow_up_committer_display_name !== null || row.follow_up_committed_at !== null ||
      row.follow_up_overdue || row.follow_up_history_total !== 0 ||
      row.current_follow_up_status !== expectedCurrent
    ) invalid();
  } else {
    const expectedOverdue = row.follow_up_status === "pending" &&
      row.follow_up_due_on !== null && row.follow_up_due_on < generatedDate;
    const latestShape = row.follow_up_status === "pending"
      ? row.follow_up_due_on !== null && row.follow_up_plan !== null &&
        row.follow_up_outcome === null && row.follow_up_transition_reason === null
      : row.follow_up_status === "completed"
        ? row.follow_up_due_on === null && row.follow_up_plan === null &&
          row.follow_up_outcome !== null && row.follow_up_transition_reason === null
        : row.follow_up_status === "cancelled" && row.follow_up_due_on === null &&
          row.follow_up_plan === null && row.follow_up_outcome === null &&
          row.follow_up_transition_reason !== null;
    const expectedCurrent = row.needs_follow_up ? row.follow_up_status : "not_required";
    if (
      row.follow_up_sequence < 1 || row.follow_up_status === null ||
      row.follow_up_committer_display_name === null || row.follow_up_committed_at === null ||
      !latestShape || row.follow_up_overdue !== expectedOverdue ||
      row.current_follow_up_status !== expectedCurrent ||
      (!followUpHistoryTruncated && (
        latestFollowUp?.event_id !== row.follow_up_event_id ||
        latestFollowUp.sequence !== row.follow_up_sequence ||
        latestFollowUp.follow_up_status !== row.follow_up_status
      ))
    ) invalid();
  }

  return {
    clientId: row.client_id,
    clientDisplayName: row.client_display_name,
    serviceStatus: row.service_status,
    admittedOn: row.admitted_on,
    endedOn: row.ended_on,
    versionId: row.version_id,
    assessmentKey: row.assessment_key,
    assessmentVersion: row.assessment_version,
    recordState: row.record_state,
    assessedOn: row.assessed_on,
    adaptationStatus: row.adaptation_status,
    assessmentSummary: row.assessment_summary,
    reassessmentDueOn: row.reassessment_due_on,
    reassessmentDue: row.reassessment_due,
    needsFollowUp: row.needs_follow_up,
    currentFollowUpStatus: row.current_follow_up_status,
    formBasis: row.form_basis,
    formVersionReference: row.form_version_reference,
    assessorUserId: row.assessor_user_id,
    assessorDisplayName: row.assessor_display_name,
    correctionReason: row.correction_reason,
    signedAt: row.signed_at,
    signerDisplayName: row.signer_display_name,
    createdAt: row.created_at,
    followUpEventId: row.follow_up_event_id,
    followUpSequence: row.follow_up_sequence,
    followUpStatus: row.follow_up_status,
    followUpDueOn: row.follow_up_due_on,
    followUpPlan: row.follow_up_plan,
    followUpOutcome: row.follow_up_outcome,
    followUpTransitionReason: row.follow_up_transition_reason,
    followUpCommitterDisplayName: row.follow_up_committer_display_name,
    followUpCommittedAt: row.follow_up_committed_at,
    followUpOverdue: row.follow_up_overdue,
    versionHistory: row.version_history.map((item) => ({
      versionId: item.version_id,
      assessmentVersion: item.assessment_version,
      recordState: item.record_state,
      assessedOn: item.assessed_on,
      adaptationStatus: item.adaptation_status,
      assessmentSummary: item.assessment_summary,
      reassessmentDueOn: item.reassessment_due_on,
      needsFollowUp: item.needs_follow_up,
      formBasis: item.form_basis,
      formVersionReference: item.form_version_reference,
      correctionReason: item.correction_reason,
      assessorDisplayName: item.assessor_display_name,
      signedAt: item.signed_at,
      signerDisplayName: item.signer_display_name,
      createdAt: item.created_at,
    })),
    versionHistoryTotal: row.version_history_total,
    versionHistoryTruncated,
    followUpHistory: row.follow_up_history.map((item) => ({
      eventId: item.event_id,
      sequence: item.sequence,
      status: item.follow_up_status,
      dueOn: item.due_on,
      plan: item.follow_up_plan,
      outcome: item.follow_up_outcome,
      transitionReason: item.transition_reason,
      committerDisplayName: item.committer_display_name,
      committedAt: item.committed_at,
    })),
    followUpHistoryTotal: row.follow_up_history_total,
    followUpHistoryTruncated,
  };
}

export function projectAdaptationAssessmentSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  demo: boolean;
}): AdaptationAssessmentSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data) invalid();
  const generatedDate = taipeiDate(row.generated_at);
  const items = row.items.map((item) => normalizeItem(item, generatedDate));
  const sorted = [...items].sort((left, right) =>
    compareC(left.clientDisplayName, right.clientDisplayName) ||
      compareC(left.clientId, right.clientId),
  );
  const clientOptionsSorted = [...row.client_options].sort((left, right) =>
    compareC(left.display_name, right.display_name) ||
      compareC(left.client_id, right.client_id),
  );
  const assessorOptionsSorted = [...row.assessor_options].sort((left, right) =>
    compareC(left.display_name, right.display_name) ||
      compareC(left.user_id, right.user_id),
  );
  if (
    items.some((item, index) => item.clientId !== sorted[index]?.clientId) ||
    !unique(items.map((item) => item.clientId)) ||
    row.item_total !== items.length || row.matching_total < row.item_total ||
    row.items_truncated !== (row.matching_total > row.item_total) ||
    (row.items_truncated && row.item_total !== 200) ||
    row.assessed_total + row.not_assessed_total !== row.matching_total ||
    row.draft_total + row.completed_total + row.not_assessed_total !== row.matching_total ||
    [row.reassessment_due_total, row.needs_follow_up_total, row.open_follow_up_total,
      row.overdue_follow_up_total, row.draft_total, row.completed_total]
      .some((value) => value > row.matching_total) ||
    row.overdue_follow_up_total > row.open_follow_up_total ||
    !unique(row.client_options.map((item) => item.client_id)) ||
    row.client_options.some((item, index) =>
      item.client_id !== clientOptionsSorted[index]?.client_id) ||
    row.client_total < row.client_options.length ||
    row.client_options_truncated !== (row.client_total > row.client_options.length) ||
    (row.client_options_truncated && row.client_options.length !== 200) ||
    !unique(row.assessor_options.map((item) => item.user_id)) ||
    row.assessor_options.some((item, index) =>
      item.user_id !== assessorOptionsSorted[index]?.user_id) ||
    row.assessor_total < row.assessor_options.length ||
    row.assessor_options_truncated !== (row.assessor_total > row.assessor_options.length) ||
    (row.assessor_options_truncated && row.assessor_options.length !== 200)
  ) invalid();

  if (!row.items_truncated && (
    items.filter((item) => item.versionId !== null).length !== row.assessed_total ||
    items.filter((item) => item.versionId === null).length !== row.not_assessed_total ||
    items.filter((item) => item.reassessmentDue).length !== row.reassessment_due_total ||
    items.filter((item) => item.needsFollowUp).length !== row.needs_follow_up_total ||
    items.filter((item) => item.followUpStatus === "pending").length !== row.open_follow_up_total ||
    items.filter((item) => item.followUpOverdue).length !== row.overdue_follow_up_total ||
    items.filter((item) => item.recordState === "draft").length !== row.draft_total ||
    items.filter((item) => item.recordState === "signed" || item.recordState === "corrected")
      .length !== row.completed_total
  )) invalid();

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
      assessed: row.assessed_total,
      notAssessed: row.not_assessed_total,
      reassessmentDue: row.reassessment_due_total,
      needsFollowUp: row.needs_follow_up_total,
      openFollowUp: row.open_follow_up_total,
      overdueFollowUp: row.overdue_follow_up_total,
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
    assessorOptions: row.assessor_options.map((item) => ({
      userId: item.user_id,
      displayName: item.display_name,
    })),
    assessorOptionsTruncated: row.assessor_options_truncated,
    assessmentMethodStatus: row.assessment_method_status,
    formPublicationStatus: row.form_publication_status,
    offlineSyncStatus: row.offline_sync_status,
    followUpNotificationStatus: row.follow_up_notification_status,
    demo: input.demo,
  };
}

export function filterDemoAdaptationAssessmentSnapshot(
  snapshot: AdaptationAssessmentSnapshot,
  filters: AdaptationAssessmentFilters,
): AdaptationAssessmentSnapshot {
  const items = snapshot.items.filter((item) =>
    (filters.clientId === null || item.clientId === filters.clientId) &&
    (filters.serviceStatus === null || item.serviceStatus === filters.serviceStatus) &&
    (filters.assessmentPresence === "all" ||
      (filters.assessmentPresence === "assessed") === (item.versionId !== null)) &&
    (filters.reassessmentStatus === "all" ||
      (filters.reassessmentStatus === "due" ? item.reassessmentDue
        : item.versionId !== null && !item.reassessmentDue)) &&
    (filters.adaptationStatus === null || item.adaptationStatus === filters.adaptationStatus) &&
    (filters.followUpFilter === "all" ||
      (filters.followUpFilter === "needs_follow_up" && item.needsFollowUp) ||
      (filters.followUpFilter === "no_follow_up" && item.versionId !== null && !item.needsFollowUp) ||
      (filters.followUpFilter === "open" && item.followUpStatus === "pending") ||
      (filters.followUpFilter === "overdue" && item.followUpOverdue)),
  );
  return {
    ...snapshot,
    items,
    itemTotal: items.length,
    matchingTotal: items.length,
    itemsTruncated: false,
    metrics: {
      assessed: items.filter((item) => item.versionId !== null).length,
      notAssessed: items.filter((item) => item.versionId === null).length,
      reassessmentDue: items.filter((item) => item.reassessmentDue).length,
      needsFollowUp: items.filter((item) => item.needsFollowUp).length,
      openFollowUp: items.filter((item) => item.followUpStatus === "pending").length,
      overdueFollowUp: items.filter((item) => item.followUpOverdue).length,
      drafts: items.filter((item) => item.recordState === "draft").length,
      completed: items.filter((item) => item.recordState === "signed" || item.recordState === "corrected").length,
    },
  };
}
