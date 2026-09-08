import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import {
  FEEDBACK_CASE_TYPES,
  FEEDBACK_EVENT_TYPES,
  FEEDBACK_RISKS,
  FEEDBACK_SOURCES,
  FEEDBACK_STATES,
  type FeedbackComplaintFilters,
  type FeedbackComplaintSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const integer = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const positiveInteger = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/u).transform(Number)
    .pipe(z.number().int().positive().safe()),
]);
const text = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrative = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const automaticReason = z.enum([
  "high_risk", "overdue", "high_risk_and_overdue",
]).nullable();

const timelineEvent = z.object({
  id: uuid,
  version: positiveInteger,
  event_type: z.enum(FEEDBACK_EVENT_TYPES),
  occurred_at: timestamp,
  resulting_status: z.enum(FEEDBACK_STATES),
  risk_after: z.enum(FEEDBACK_RISKS),
  automatic_reason: automaticReason,
  assignee_membership_id: uuid.nullable(),
  assignee_display_name: text(160).nullable(),
  corrected_event_id: uuid.nullable(),
  note: narrative(4_000).nullable(),
  sensitive_masked: z.boolean(),
  actor_display_name: text(160),
  committed_at: timestamp,
}).strict().superRefine((event, context) => {
  if (event.sensitive_masked && event.note !== null) {
    context.addIssue({ code: "custom", message: "masked timeline exposed note" });
  }
  if ((event.assignee_membership_id === null) !==
    (event.assignee_display_name === null)) {
    context.addIssue({ code: "custom", message: "assignee identity mismatch" });
  }
  if ((event.event_type === "correction") !== (event.corrected_event_id !== null)) {
    context.addIssue({ code: "custom", message: "correction target mismatch" });
  }
});

const item = z.object({
  id: uuid,
  case_number: z.string().regex(/^FC-\d{8}-[A-F0-9]{8}$/u),
  received_at: timestamp,
  source: z.enum(FEEDBACK_SOURCES),
  case_type: z.enum(FEEDBACK_CASE_TYPES),
  reported_risk: z.enum(FEEDBACK_RISKS),
  effective_risk: z.enum(FEEDBACK_RISKS),
  status: z.enum(FEEDBACK_STATES),
  due_at: timestamp,
  overdue: z.boolean(),
  escalation_reason: automaticReason,
  assignee_membership_id: uuid.nullable(),
  assignee_display_name: text(160).nullable(),
  chain_version: positiveInteger,
  latest_event_at: timestamp,
  reporter_name: text(160).nullable(),
  reporter_contact: text(240).nullable(),
  subject: text(240).nullable(),
  description: narrative(4_000).nullable(),
  sensitive_masked: z.boolean(),
  timeline_total: integer,
  timeline_truncated: z.boolean(),
  timeline: z.array(timelineEvent).max(50),
}).strict().superRefine((record, context) => {
  if (record.sensitive_masked && [record.reporter_name, record.reporter_contact,
    record.subject, record.description].some((value) => value !== null)) {
    context.addIssue({ code: "custom", message: "masked case exposed sensitive fields" });
  }
  if (!record.sensitive_masked &&
    (record.subject === null || record.description === null)) {
    context.addIssue({ code: "custom", message: "unmasked case omitted content" });
  }
  if ((record.assignee_membership_id === null) !==
    (record.assignee_display_name === null)) {
    context.addIssue({ code: "custom", message: "case assignee mismatch" });
  }
  if (new Date(record.due_at) <= new Date(record.received_at)) {
    context.addIssue({ code: "custom", message: "deadline must follow receipt" });
  }
  const versions = record.timeline.map((entry) => entry.version);
  if (new Set(versions).size !== versions.length ||
    (versions.length > 0 && versions.at(-1) !== record.chain_version) ||
    record.timeline_total < record.timeline.length ||
    record.timeline_truncated !== (record.timeline_total > record.timeline.length)) {
    context.addIssue({ code: "custom", message: "timeline version contract mismatch" });
  }
  if (record.overdue && (record.status === "closed" ||
    !["overdue", "high_risk_and_overdue"].includes(record.escalation_reason ?? ""))) {
    context.addIssue({ code: "custom", message: "overdue projection mismatch" });
  }
});

const assignee = z.object({
  membership_id: uuid,
  display_name: text(160),
  scope: z.enum(["organization", "branch"]),
}).strict();
const deadlineRule = z.object({
  id: uuid,
  label: text(160),
  source: z.enum(FEEDBACK_SOURCES),
  case_type: z.enum(FEEDBACK_CASE_TYPES),
  risk: z.enum(FEEDBACK_RISKS),
  response_hours: z.number().int().positive().max(8_760),
  effective_from: date,
  effective_through: date.nullable(),
}).strict();

const sourceRow = z.object({
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  stale_after: timestamp,
  items: z.array(item).max(100),
  matching_total: integer,
  items_truncated: z.boolean(),
  case_total: integer,
  high_risk_total: integer,
  in_progress_total: integer,
  overdue_total: integer,
  assignees: z.array(assignee).max(100),
  assignees_truncated: z.boolean(),
  deadline_rules: z.array(deadlineRule).max(100),
  deadline_rule_status: z.enum(["configured", "not_configured"]),
  escalation_evaluation_status: z.literal("server_clock"),
  escalation_delivery_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"),
  can_view_sensitive: z.boolean(),
}).strict();

export type FeedbackComplaintSnapshotSourceRow = z.input<typeof sourceRow>;

export function projectFeedbackComplaintSnapshot({
  row,
  expectedOrganizationId,
  expectedBranchId,
  filters,
  demo = false,
}: {
  row: FeedbackComplaintSnapshotSourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: FeedbackComplaintFilters;
  demo?: boolean;
}): FeedbackComplaintSnapshot {
  const parsed = sourceRow.parse(row);
  const generatedAt = new Date(parsed.generated_at);
  if (parsed.organization_id !== expectedOrganizationId.toLowerCase() ||
    parsed.branch_id !== expectedBranchId.toLowerCase() ||
    new Date(parsed.stale_after) <= new Date(parsed.generated_at) ||
    parsed.case_total !== parsed.matching_total ||
    parsed.high_risk_total > parsed.case_total ||
    parsed.in_progress_total > parsed.case_total ||
    parsed.overdue_total > parsed.in_progress_total ||
    parsed.matching_total < parsed.items.length ||
    parsed.items_truncated !== (parsed.matching_total > parsed.items.length) ||
    new Set(parsed.items.map((record) => record.id)).size !== parsed.items.length ||
    new Set(parsed.items.map((record) => record.case_number)).size !== parsed.items.length ||
    new Set(parsed.assignees.map((record) => record.membership_id)).size !== parsed.assignees.length ||
    new Set(parsed.deadline_rules.map((record) => record.id)).size !== parsed.deadline_rules.length ||
    parsed.deadline_rule_status !==
      (parsed.deadline_rules.length > 0 ? "configured" : "not_configured") ||
    (!parsed.can_view_sensitive && parsed.items.some((record) => !record.sensitive_masked)) ||
    parsed.items.filter((record) => record.effective_risk === "high").length >
      parsed.high_risk_total ||
    parsed.items.filter((record) => record.status !== "closed").length >
      parsed.in_progress_total ||
    parsed.items.filter((record) => record.overdue).length > parsed.overdue_total ||
    parsed.items.some((record) => {
      const shouldBeOverdue = record.status !== "closed" &&
        new Date(record.due_at) <= generatedAt;
      const current = record.timeline.at(-1);
      return record.overdue !== shouldBeOverdue ||
        (record.overdue && (record.status !== "escalated" ||
          record.effective_risk !== "high" ||
          !["overdue", "high_risk_and_overdue"].includes(
            record.escalation_reason ?? "",
          ))) ||
        (!record.overdue && ["overdue", "high_risk_and_overdue"].includes(
          record.escalation_reason ?? "",
        )) ||
        (record.status === "escalated" && record.escalation_reason === null) ||
        (record.status !== "closed" && record.escalation_reason !== null &&
          record.effective_risk !== "high") ||
        current?.committed_at !== record.latest_event_at ||
        current?.assignee_membership_id !== record.assignee_membership_id;
    })) {
    throw new Error("feedback complaint snapshot contract mismatch");
  }
  return {
    organizationId: parsed.organization_id,
    branchId: parsed.branch_id,
    generatedAt: parsed.generated_at,
    staleAfter: parsed.stale_after,
    filters,
    items: parsed.items.map((record) => ({
      id: record.id,
      caseNumber: record.case_number,
      receivedAt: record.received_at,
      source: record.source,
      caseType: record.case_type,
      reportedRisk: record.reported_risk,
      effectiveRisk: record.effective_risk,
      status: record.status,
      dueAt: record.due_at,
      overdue: record.overdue,
      escalationReason: record.escalation_reason,
      assigneeMembershipId: record.assignee_membership_id,
      assigneeDisplayName: record.assignee_display_name,
      chainVersion: record.chain_version,
      latestEventAt: record.latest_event_at,
      reporterName: record.reporter_name,
      reporterContact: record.reporter_contact,
      subject: record.subject,
      description: record.description,
      sensitiveMasked: record.sensitive_masked,
      timelineTotal: record.timeline_total,
      timelineTruncated: record.timeline_truncated,
      timeline: record.timeline.map((event) => ({
        id: event.id,
        version: event.version,
        eventType: event.event_type,
        occurredAt: event.occurred_at,
        resultingStatus: event.resulting_status,
        riskAfter: event.risk_after,
        automaticReason: event.automatic_reason,
        assigneeMembershipId: event.assignee_membership_id,
        assigneeDisplayName: event.assignee_display_name,
        correctedEventId: event.corrected_event_id,
        note: event.note,
        sensitiveMasked: event.sensitive_masked,
        actorDisplayName: event.actor_display_name,
        committedAt: event.committed_at,
      })),
    })),
    matchingTotal: parsed.matching_total,
    itemsTruncated: parsed.items_truncated,
    metrics: {
      cases: parsed.case_total,
      highRisk: parsed.high_risk_total,
      inProgress: parsed.in_progress_total,
      overdue: parsed.overdue_total,
    },
    assignees: parsed.assignees.map((record) => ({
      membershipId: record.membership_id,
      displayName: record.display_name,
      scope: record.scope,
    })),
    assigneesTruncated: parsed.assignees_truncated,
    deadlineRules: parsed.deadline_rules.map((record) => ({
      id: record.id,
      label: record.label,
      source: record.source,
      caseType: record.case_type,
      risk: record.risk,
      responseHours: record.response_hours,
      effectiveFrom: record.effective_from,
      effectiveThrough: record.effective_through,
    })),
    deadlineRuleStatus: parsed.deadline_rule_status,
    escalationEvaluationStatus: parsed.escalation_evaluation_status,
    escalationDeliveryStatus: parsed.escalation_delivery_status,
    exportStatus: parsed.export_status,
    canViewSensitive: parsed.can_view_sensitive,
    demo,
  };
}
