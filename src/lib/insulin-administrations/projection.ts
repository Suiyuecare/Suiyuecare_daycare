import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  INSULIN_STATES,
  type InsulinAdministrationItem,
  type InsulinAdministrationSnapshot,
  type InsulinHistoryEntry,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const calendarDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const safeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrative = (max: number) => z.string().trim().min(2).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const decimal = z.string().regex(/^(?:[1-9][0-9]{0,7}|0\.[0-9]{0,3}[1-9]|[1-9][0-9]{0,7}\.[0-9]{0,3}[1-9])$/u);
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const positive = count.pipe(z.number().int().positive().max(100_000));
const eventStates = ["late_authorized", "pending_review", "completed"] as const;
const eventKinds = ["late_authorized", "executed", "reviewed"] as const;

const historySchema = z.object({
  event_id: uuid,
  event_sequence: positive,
  previous_event_id: uuid.nullable(),
  event_kind: z.enum(eventKinds),
  state: z.enum(eventStates),
  occurred_at: timestamp,
  actor_display_name: safeText(120),
  content_hash: hash,
}).strict();
const itemSchema = z.object({
  medication_plan_id: uuid,
  medication_plan_version: positive,
  medication_plan_content_hash: hash,
  client_id: uuid,
  client_code: safeText(80),
  client_display_name: safeText(120),
  medication_name: safeText(240),
  ordered_dose_text: decimal,
  dose_unit: safeText(32),
  medication_route: safeText(120),
  scheduled_for: timestamp,
  event_id: uuid.nullable(),
  administration_key: uuid.nullable(),
  event_sequence: count,
  previous_event_id: uuid.nullable(),
  state: z.enum(INSULIN_STATES),
  event_kind: z.enum(eventKinds).nullable(),
  actual_dose_text: decimal.nullable(),
  actual_dose_unit: safeText(32).nullable(),
  site_code: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/u).nullable(),
  site_text: narrative(120).nullable(),
  executed_at: timestamp.nullable(),
  executor_user_id: uuid.nullable(),
  executor_display_name: safeText(120).nullable(),
  late_entry: z.boolean(),
  late_reason: narrative(1_000).nullable(),
  late_authorized_at: timestamp.nullable(),
  late_authorizer_user_id: uuid.nullable(),
  late_authorizer_display_name: safeText(120).nullable(),
  reviewed_at: timestamp.nullable(),
  reviewer_user_id: uuid.nullable(),
  reviewer_display_name: safeText(120).nullable(),
  content_hash: hash.nullable(),
  is_late: z.boolean(),
  history: z.array(historySchema).max(100_000),
}).strict();
const sourceSchema = z.object({
  organization_id: uuid,
  organization_name: safeText(160),
  branch_id: uuid,
  branch_name: safeText(160),
  generated_at: timestamp,
  service_date: calendarDate,
  snapshot_token: hash,
  items: z.array(itemSchema).max(200),
  matching_total: count,
  scheduled_total: count,
  late_authorized_total: count,
  pending_review_total: count,
  completed_total: count,
  late_exception_total: count,
  items_truncated: z.boolean(),
  client_options: z.array(z.object({
    client_id: uuid,
    client_code: safeText(80),
    display_name: safeText(120),
  }).strict()).max(500),
  governance_status: z.enum(["not_configured", "published"]),
  plan_designation_status: z.enum(["not_configured", "published"]),
  qualification_status: z.enum(["not_configured", "published"]),
  dose_rule_status: z.enum(["not_configured", "published"]),
  late_entry_rule_status: z.enum(["not_configured", "published"]),
  can_execute: z.boolean(),
  can_review: z.boolean(),
  can_authorize_late: z.boolean(),
  offline_status: z.literal("not_configured"),
  attachment_status: z.literal("not_configured"),
  external_delivery_status: z.literal("not_configured"),
  delivery_claim: z.literal("no_external_delivery_claim"),
}).strict();

export type InsulinAdministrationSnapshotSource = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("INVALID_INSULIN_ADMINISTRATION_SNAPSHOT");
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function projectHistory(value: z.output<typeof historySchema>): InsulinHistoryEntry {
  const expectedKind = value.state === "late_authorized" ? "late_authorized"
    : value.state === "pending_review" ? "executed" : "reviewed";
  if (value.event_kind !== expectedKind ||
      (value.event_sequence === 1) !== (value.previous_event_id === null)) invalid();
  return {
    eventId: value.event_id,
    eventSequence: value.event_sequence,
    previousEventId: value.previous_event_id,
    eventKind: value.event_kind,
    state: value.state,
    occurredAt: value.occurred_at,
    actorDisplayName: value.actor_display_name,
    contentHash: value.content_hash,
  };
}

function taipeiCalendarDate(value: string) {
  return new Date(Date.parse(value) + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function projectItem(
  value: z.output<typeof itemSchema>, generatedAt: string, serviceDate: string,
): InsulinAdministrationItem {
  const history = value.history.map(projectHistory);
  if (taipeiCalendarDate(value.scheduled_for) !== serviceDate ||
      !unique(history.map((entry) => entry.eventId)) ||
      history.some((entry, index) => index > 0 && (
        entry.eventSequence !== history[index - 1]!.eventSequence - 1 ||
        history[index - 1]!.previousEventId !== entry.eventId ||
        Date.parse(history[index - 1]!.occurredAt) < Date.parse(entry.occurredAt)
      ))) invalid();
  if (value.state === "scheduled") {
    if (value.event_id !== null || value.administration_key !== null ||
        value.event_sequence !== 0 || value.previous_event_id !== null ||
        value.event_kind !== null || value.actual_dose_text !== null ||
        value.actual_dose_unit !== null || value.site_code !== null ||
        value.site_text !== null || value.executed_at !== null ||
        value.executor_user_id !== null || value.executor_display_name !== null ||
        value.late_entry || value.late_reason !== null ||
        value.late_authorized_at !== null || value.late_authorizer_user_id !== null ||
        value.late_authorizer_display_name !== null || value.reviewed_at !== null ||
        value.reviewer_user_id !== null || value.reviewer_display_name !== null ||
        value.content_hash !== null || history.length !== 0) invalid();
  } else {
    const latest = history[0];
    if (!latest || value.event_id !== latest.eventId ||
        history.length !== value.event_sequence ||
        value.event_sequence !== latest.eventSequence ||
        value.previous_event_id !== latest.previousEventId ||
        value.event_kind !== latest.eventKind || value.state !== latest.state ||
        value.content_hash !== latest.contentHash || value.administration_key === null ||
        Date.parse(latest.occurredAt) > Date.parse(generatedAt)) invalid();
    if (value.state === "late_authorized") {
      if (!value.late_entry || value.late_reason === null ||
          value.late_authorized_at === null || value.late_authorizer_user_id === null ||
          value.late_authorizer_display_name === null || value.actual_dose_text !== null ||
          value.executed_at !== null || value.reviewer_user_id !== null) invalid();
    } else {
      if (value.actual_dose_text !== value.ordered_dose_text ||
          value.actual_dose_unit !== value.dose_unit || value.site_code === null ||
          value.site_text === null || value.executed_at === null ||
          value.executor_user_id === null || value.executor_display_name === null ||
          Date.parse(value.executed_at) > Date.parse(generatedAt) ||
          (value.late_entry && (value.late_reason === null ||
            value.late_authorizer_user_id === null ||
            value.late_authorizer_user_id === value.executor_user_id))) invalid();
      if (value.state === "pending_review") {
        if (value.reviewed_at !== null || value.reviewer_user_id !== null ||
            value.reviewer_display_name !== null) invalid();
      } else if (value.reviewed_at === null || value.reviewer_user_id === null ||
          value.reviewer_display_name === null ||
          value.reviewer_user_id === value.executor_user_id ||
          Date.parse(value.reviewed_at) < Date.parse(value.executed_at) ||
          Date.parse(value.reviewed_at) > Date.parse(generatedAt)) invalid();
    }
  }
  return {
    medicationPlanId: value.medication_plan_id,
    medicationPlanVersion: value.medication_plan_version,
    medicationPlanContentHash: value.medication_plan_content_hash,
    clientId: value.client_id,
    clientCode: value.client_code,
    clientDisplayName: value.client_display_name,
    medicationName: value.medication_name,
    orderedDoseText: value.ordered_dose_text,
    doseUnit: value.dose_unit,
    medicationRoute: value.medication_route,
    scheduledFor: value.scheduled_for,
    eventId: value.event_id,
    administrationKey: value.administration_key,
    eventSequence: value.event_sequence,
    previousEventId: value.previous_event_id,
    state: value.state,
    eventKind: value.event_kind,
    actualDoseText: value.actual_dose_text,
    actualDoseUnit: value.actual_dose_unit,
    siteCode: value.site_code,
    siteText: value.site_text,
    executedAt: value.executed_at,
    executorUserId: value.executor_user_id,
    executorDisplayName: value.executor_display_name,
    lateEntry: value.late_entry,
    lateReason: value.late_reason,
    lateAuthorizedAt: value.late_authorized_at,
    lateAuthorizerUserId: value.late_authorizer_user_id,
    lateAuthorizerDisplayName: value.late_authorizer_display_name,
    reviewedAt: value.reviewed_at,
    reviewerUserId: value.reviewer_user_id,
    reviewerDisplayName: value.reviewer_display_name,
    contentHash: value.content_hash,
    isLate: value.is_late,
    history,
  };
}

export function projectInsulinAdministrationSnapshot(
  source: InsulinAdministrationSnapshotSource,
): InsulinAdministrationSnapshot {
  const parsed = sourceSchema.safeParse(source);
  if (!parsed.success) invalid();
  const value = parsed.data;
  const items = value.items.map((entry) =>
    projectItem(entry, value.generated_at, value.service_date));
  const stateTotal = value.scheduled_total + value.late_authorized_total +
    value.pending_review_total + value.completed_total;
  const configured = value.governance_status === "published";
  if (stateTotal !== value.matching_total || value.late_exception_total > value.matching_total ||
      value.items_truncated !== (value.matching_total > items.length) ||
      (!value.items_truncated && items.length !== value.matching_total) ||
      !unique(value.client_options.map((entry) => entry.client_id)) ||
      (!configured && (
        value.plan_designation_status !== "not_configured" ||
        value.qualification_status !== "not_configured" ||
        value.dose_rule_status !== "not_configured" ||
        value.late_entry_rule_status !== "not_configured" ||
        value.matching_total !== 0 || items.length !== 0 || value.can_execute ||
        value.can_review || value.can_authorize_late
      )) ||
      (value.plan_designation_status === "not_configured" && (
        value.matching_total !== 0 || items.length !== 0 || value.can_execute ||
        value.can_review || value.can_authorize_late
      )) ||
      (configured && (
        value.qualification_status !== "published" ||
        value.dose_rule_status !== "published" ||
        value.late_entry_rule_status !== "published"
      ))) invalid();
  return {
    organizationId: value.organization_id,
    organizationName: value.organization_name,
    branchId: value.branch_id,
    branchName: value.branch_name,
    generatedAt: value.generated_at,
    staleAfter: new Date(Date.parse(value.generated_at) + 60_000).toISOString(),
    serviceDate: value.service_date,
    snapshotToken: value.snapshot_token,
    items,
    metrics: {
      matching: value.matching_total,
      scheduled: value.scheduled_total,
      lateAuthorized: value.late_authorized_total,
      pendingReview: value.pending_review_total,
      completed: value.completed_total,
      lateException: value.late_exception_total,
    },
    itemsTruncated: value.items_truncated,
    clientOptions: value.client_options.map((entry) => ({
      clientId: entry.client_id,
      clientCode: entry.client_code,
      displayName: entry.display_name,
    })),
    governanceStatus: value.governance_status,
    planDesignationStatus: value.plan_designation_status,
    qualificationStatus: value.qualification_status,
    doseRuleStatus: value.dose_rule_status,
    lateEntryRuleStatus: value.late_entry_rule_status,
    canExecute: value.can_execute,
    canReview: value.can_review,
    canAuthorizeLate: value.can_authorize_late,
    offlineStatus: value.offline_status,
    attachmentStatus: value.attachment_status,
    externalDeliveryStatus: value.external_delivery_status,
    deliveryClaim: value.delivery_claim,
    demo: false,
  };
}
