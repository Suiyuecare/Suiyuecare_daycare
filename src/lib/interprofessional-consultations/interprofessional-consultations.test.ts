import { describe, expect, it } from "vitest";

import { buildDemoInterprofessionalConsultationSnapshot } from "./demo";
import {
  correlateInterprofessionalConsultationReceipt,
  parseInterprofessionalConsultationApiError,
  parseInterprofessionalConsultationApiSuccess,
  parseInterprofessionalConsultationDatabaseReceipt,
  parseInterprofessionalConsultationMutation,
} from "./parser";
import { projectInterprofessionalConsultationSnapshot } from "./projection";
import type { InterprofessionalConsultationFilters } from "./types";

const organizationId = "37000000-0000-4000-8000-000000000010";
const branchId = "37000000-0000-4000-8000-000000000011";
const clientId = "37000000-0000-4000-8000-000000000012";
const assigneeId = "37000000-0000-4000-8000-000000000013";
const key = "37000000-0000-4000-8000-000000000014";
const baseFilters: InterprofessionalConsultationFilters = {
  clientId: null, requesterUserId: null, assigneeMode: "all", assigneeUserId: null,
  disciplineCode: null, urgency: "all", status: "all", deadlineFilter: "all",
  dueFrom: null, dueTo: null, query: "",
};

function create(deadlineState: "dated" | "missing" | "not_applicable", dueAt: string | null) {
  return parseInterprofessionalConsultationMutation({
    action: "create", clientId, assigneeUserId: null,
    disciplineCode: "PT-MANUAL", disciplineLabel: "物理治療", urgency: "soon",
    requestedAt: "2026-09-02T09:00:00+08:00", deadlineState, dueAt,
    problemSummary: "合成個案跨專業問題摘要",
  }, key);
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: organizationId, branch_id: branchId,
    operation_id: "37000000-0000-4000-8000-000000000020",
    operation_kind: "create", consultation_key: "37000000-0000-4000-8000-000000000021",
    event_id: "37000000-0000-4000-8000-000000000022", event_sequence: 1,
    previous_event_id: null, event_kind: "created", consultation_status: "unassigned",
    assignment_state: "unassigned", assignee_user_id: null, deadline_state: "missing",
    notification_count: 1, notification_queue_status: "queued",
    notification_delivery_claim: "queued_not_delivered",
    external_provider_status: "not_configured", committed_at: "2026-09-02T01:01:00Z",
    replayed: false, ...overrides,
  };
}

describe("Page 37 interprofessional consultation contracts", () => {
  it("keeps missing and not-applicable deadlines as distinct explicit values", () => {
    expect(create("missing", null).deadlineState).toBe("missing");
    expect(create("not_applicable", null).deadlineState).toBe("not_applicable");
    expect(() => create("missing", "2026-09-03T09:00:00+08:00")).toThrow();
    const missing = buildDemoInterprofessionalConsultationSnapshot({
      organizationId, branchId, filters: { ...baseFilters, deadlineFilter: "missing" },
    });
    const notApplicable = buildDemoInterprofessionalConsultationSnapshot({
      organizationId, branchId, filters: { ...baseFilters, deadlineFilter: "not_applicable" },
    });
    expect(missing.items).toHaveLength(1);
    expect(missing.metrics.deadlineMissing).toBe(1);
    expect(missing.metrics.deadlineNotApplicable).toBe(0);
    expect(notApplicable.items).toHaveLength(1);
    expect(notApplicable.metrics.deadlineMissing).toBe(0);
    expect(notApplicable.metrics.deadlineNotApplicable).toBe(1);
  });

  it("strictly rejects unknown fields, bad chronology and missing reassignment reasons", () => {
    expect(() => parseInterprofessionalConsultationMutation({
      action: "create", clientId, disciplineCode: "PT-MANUAL", disciplineLabel: "物理治療",
      urgency: "soon", requestedAt: "2026-09-03T09:00:00+08:00", deadlineState: "dated",
      dueAt: "2026-09-02T09:00:00+08:00", problemSummary: "時間反向的合成摘要",
      unexpected: true,
    }, key)).toThrow();
    expect(() => parseInterprofessionalConsultationMutation({
      action: "reassign", consultationKey: organizationId, previousEventId: branchId,
      expectedSequence: 2, assigneeUserId: assigneeId,
    }, key)).toThrow(/改派必須填寫理由/u);
  });

  it("correlates tenant, branch, stream sequence and honest notification boundaries", () => {
    const input = create("missing", null);
    const parsed = parseInterprofessionalConsultationDatabaseReceipt(receipt());
    expect(correlateInterprofessionalConsultationReceipt(
      parsed, input, organizationId, branchId,
    ).notification_delivery_claim).toBe("queued_not_delivered");
    expect(() => correlateInterprofessionalConsultationReceipt(
      { ...parsed, organization_id: assigneeId }, input, organizationId, branchId,
    )).toThrow();
    expect(() => parseInterprofessionalConsultationDatabaseReceipt(receipt({
      notification_delivery_claim: "delivered",
    }))).toThrow();
  });

  it("requires a strict HTTP status and actor scope on API success", () => {
    const input = create("missing", null);
    const data = receipt();
    const envelope = {
      requestId: "37000000-0000-4000-8000-000000000030", status: "ok", errors: [],
      data: {
        organizationId: data.organization_id, branchId: data.branch_id,
        operationId: data.operation_id, operationKind: data.operation_kind,
        consultationKey: data.consultation_key, eventId: data.event_id,
        eventSequence: data.event_sequence, previousEventId: data.previous_event_id,
        eventKind: data.event_kind, consultationStatus: data.consultation_status,
        assignmentState: data.assignment_state, assigneeUserId: data.assignee_user_id,
        deadlineState: data.deadline_state, notificationCount: data.notification_count,
        notificationQueueStatus: data.notification_queue_status,
        notificationDeliveryClaim: data.notification_delivery_claim,
        externalProviderStatus: data.external_provider_status, committedAt: data.committed_at,
        replayed: false, persisted: true, demo: false,
      },
    };
    expect(parseInterprofessionalConsultationApiSuccess(
      envelope, input, organizationId, branchId, 201,
    ).data.organizationId).toBe(organizationId);
    expect(() => parseInterprofessionalConsultationApiSuccess(
      envelope, input, organizationId, branchId, 200,
    )).toThrow();
    expect(() => parseInterprofessionalConsultationApiSuccess(
      envelope, input, assigneeId, branchId, 201,
    )).toThrow();
  });

  it("does not trust unsafe structured errors", () => {
    const safe = { requestId: organizationId, status: "error", data: null,
      errors: [{ code: "SAFE_ERROR", message: "安全錯誤訊息", field: "dueAt" }] };
    expect(parseInterprofessionalConsultationApiError(safe)?.errors[0]?.code).toBe("SAFE_ERROR");
    expect(parseInterprofessionalConsultationApiError({
      ...safe, errors: [{ code: "unsafe-error", message: "錯誤\n注入" }],
    })).toBeNull();
  });

  it("fails closed on forged snapshot context, token or correction authority", () => {
    const row = {
      organization_id: organizationId, organization_name: "合成機構",
      branch_id: branchId, branch_name: "合成分支",
      generated_at: "2026-09-02T01:00:00Z", snapshot_token: "a".repeat(64), items: [],
      matching_total: 0, unassigned_total: 0, in_progress_total: 0, overdue_total: 0,
      closed_total: 0, deadline_missing_total: 0, deadline_not_applicable_total: 0,
      items_truncated: false, client_options: [], requester_options: [],
      assignee_options: [], discipline_options: [], can_create: false, can_assign: false,
      can_respond: true, can_correct: true, can_close: false,
      taxonomy_status: "manual_unstandardized", notification_queue_status: "queued",
      notification_delivery_claim: "queued_not_delivered", external_provider_status: "not_configured",
    };
    expect(() => projectInterprofessionalConsultationSnapshot({
      row, expectedOrganizationId: organizationId, expectedBranchId: branchId,
      expectedCanCreate: false, expectedCanAssign: false,
      expectedCanRespond: true, expectedCanCorrect: false,
      expectedCanClose: false, demo: false,
    })).toThrow("INVALID_INTERPROFESSIONAL_CONSULTATION_SNAPSHOT");
  });

  it("fails closed when an untruncated overdue total disagrees with its rows", () => {
    const snapshot = buildDemoInterprofessionalConsultationSnapshot({
      organizationId, branchId, filters: baseFilters,
    });
    const overdue = snapshot.items.find((item) =>
      item.deadlineState === "dated" && item.dueAt !== null &&
      item.dueAt < snapshot.generatedAt && item.status !== "closed");
    expect(overdue).toBeDefined();
    const item = overdue!;
    const row = {
      organization_id: organizationId, organization_name: "合成機構",
      branch_id: branchId, branch_name: "合成分支",
      generated_at: snapshot.generatedAt, snapshot_token: "b".repeat(64),
      items: [{
        event_id: item.eventId, consultation_key: item.consultationKey,
        sequence: item.sequence, previous_event_id: item.previousEventId,
        corrects_event_id: item.correctsEventId, event_kind: item.eventKind,
        client_id: item.clientId, client_display_name: item.clientDisplayName,
        client_code: item.clientCode, requester_user_id: item.requesterUserId,
        requester_display_name: item.requesterDisplayName,
        assignee_user_id: item.assigneeUserId,
        assignee_display_name: item.assigneeDisplayName,
        assignment_state: item.assignmentState,
        discipline_code: item.disciplineCode, discipline_label: item.disciplineLabel,
        discipline_taxonomy_status: item.disciplineTaxonomyStatus,
        urgency: item.urgency, urgency_source: item.urgencySource,
        requested_at: item.requestedAt, deadline_state: item.deadlineState,
        due_at: item.dueAt, problem_summary: item.problemSummary,
        entry_content: item.entryContent, status: item.status,
        occurred_at: item.occurredAt, actor_display_name: item.actorDisplayName,
        content_hash: item.contentHash,
        notification: {
          queue_status: item.notification.queueStatus,
          delivery_claim: item.notification.deliveryClaim,
          external_provider_status: item.notification.externalProviderStatus,
          recipient_count: item.notification.recipientCount,
        },
        history: item.history.map((entry) => ({
          event_id: entry.eventId, sequence: entry.sequence,
          event_kind: entry.eventKind, corrects_event_id: entry.correctsEventId,
          entry_content: entry.entryContent, status: entry.status,
          assignee_display_name: entry.assigneeDisplayName,
          occurred_at: entry.occurredAt,
          actor_display_name: entry.actorDisplayName,
          content_hash: entry.contentHash,
          notification_recipient_count: entry.notificationRecipientCount,
        })),
      }],
      matching_total: 1,
      unassigned_total: item.assignmentState === "unassigned" ? 1 : 0,
      in_progress_total: ["assigned", "answered"].includes(item.status) ? 1 : 0,
      overdue_total: 0,
      closed_total: item.status === "closed" ? 1 : 0,
      deadline_missing_total: item.deadlineState === "missing" ? 1 : 0,
      deadline_not_applicable_total: item.deadlineState === "not_applicable" ? 1 : 0,
      items_truncated: false, client_options: [], requester_options: [],
      assignee_options: [], discipline_options: [], can_create: false,
      can_assign: false, can_respond: false, can_correct: false, can_close: false,
      taxonomy_status: "manual_unstandardized",
      notification_queue_status: "queued",
      notification_delivery_claim: "queued_not_delivered",
      external_provider_status: "not_configured",
    };
    expect(() => projectInterprofessionalConsultationSnapshot({
      row, expectedOrganizationId: organizationId, expectedBranchId: branchId,
      expectedCanCreate: false, expectedCanAssign: false,
      expectedCanRespond: false, expectedCanCorrect: false,
      expectedCanClose: false, demo: false,
    })).toThrow("INVALID_INTERPROFESSIONAL_CONSULTATION_SNAPSHOT");
  });
});
