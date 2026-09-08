import { describe, expect, it } from "vitest";

import {
  parseAbnormalEventActionSuccess,
  parseAbnormalEventMutation,
  parseAbnormalEventOperationResult,
  parseAbnormalEventReport,
} from "./parser";
import { projectAbnormalEventSnapshot } from "./projection";

const organizationId = "27000000-0000-4000-8000-000000000001";
const branchId = "27000000-0000-4000-8000-000000000002";
const clientId = "27000000-0000-4000-8000-000000000003";
const incidentId = "27000000-0000-4000-8000-000000000004";
const operationId = "27000000-0000-4000-8000-000000000005";
const entryId = "27000000-0000-4000-8000-000000000006";
const idempotencyKey = "27000000-0000-4000-8000-000000000007";
const membershipId = "27000000-0000-4000-8000-000000000008";
const userId = "27000000-0000-4000-8000-000000000009";

function item() {
  return {
    incident_id: incidentId,
    affected_target_kind: "client",
    affected_client_id: clientId,
    affected_target_label: "測試個案",
    occurred_at: "2026-08-31T01:00:00.000Z",
    reported_at: "2026-08-31T01:05:00.000Z",
    location: "活動區",
    event_type: "機構人工類型",
    event_summary: "第一行\n第二行",
    immediate_action: "先確認現場安全。",
    major_state: "major",
    late_entry_reason: null,
    initial_responsible_membership_id: membershipId,
    initial_responsible_user_id: userId,
    initial_responsible_display_name: "測試人員",
    current_responsible_membership_id: membershipId,
    current_responsible_user_id: userId,
    current_responsible_display_name: "測試人員",
    initial_improvement_due_date: "2026-09-01",
    current_improvement_due_date: "2026-09-01",
    reporter_display_name: "測試人員",
    handling_status: "reported",
    chain_version: 0,
    last_activity_at: "2026-08-31T01:05:00.000Z",
    timeline_total: 0,
    timeline_truncated: false,
    timeline: [],
  };
}

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: organizationId,
    branch_id: branchId,
    generated_at: "2026-09-01T02:00:00.000Z",
    items: [item()],
    item_total: 1,
    matching_total: 1,
    major_total: 1,
    awaiting_improvement_total: 1,
    overdue_total: 0,
    closed_total: 0,
    items_truncated: false,
    client_options: [{ client_id: clientId, display_name: "測試個案",
      client_status: "active", admitted_on: "2026-01-01", ended_on: null, can_report: true }],
    client_options_available_total: 1,
    client_options_truncated: false,
    responsible_options: [{ membership_id: membershipId, user_id: userId,
      display_name: "測試人員", membership_scope: "branch" }],
    responsible_options_available_total: 1,
    responsible_options_truncated: false,
    event_type_options: ["機構人工類型"],
    event_type_options_available_total: 1,
    event_type_options_truncated: false,
    event_taxonomy_status: "not_configured",
    major_criteria_status: "not_configured",
    legal_reporting_status: "not_configured",
    delivery_integration_status: "not_implemented",
    ...overrides,
  };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId, incident_id: incidentId, entry_id: entryId,
    operation_kind: "follow_up", affected_target_kind: "client",
    affected_client_id: clientId, chain_version: 2, handling_status: "in_progress",
    responsible_membership_id: membershipId, effective_due_date: "2026-09-03",
    committed_at: "2026-09-01T02:00:00.000Z", replayed: false, ...overrides,
  };
}

describe("abnormal event projection and parser", () => {
  it("accepts a scoped stable event and rejects a duplicate stable id", () => {
    const snapshot = projectAbnormalEventSnapshot({ row: sourceRow(),
      expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false });
    expect(snapshot).toMatchObject({ itemTotal: 1, matchingTotal: 1,
      metrics: { major: 1, awaitingImprovement: 1, overdue: 0, closed: 0 } });
    const duplicate = sourceRow({ item_total: 2, matching_total: 2,
      major_total: 2, awaiting_improvement_total: 2 });
    duplicate.items = [item(), item()];
    expect(() => projectAbnormalEventSnapshot({ row: duplicate,
      expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false }))
      .toThrow("INVALID_ABNORMAL_EVENT_PROJECTION");
  });

  it("preserves exact empty arrays and truthful full-set metrics", () => {
    const empty = projectAbnormalEventSnapshot({ row: sourceRow({ items: [], item_total: 0,
      matching_total: 0, major_total: 0, awaiting_improvement_total: 0,
      overdue_total: 0, closed_total: 0 }), expectedOrganizationId: organizationId,
      expectedBranchId: branchId, demo: false });
    expect(empty.items).toEqual([]);
    const truncated = projectAbnormalEventSnapshot({ row: sourceRow({ matching_total: 201,
      major_total: 50, awaiting_improvement_total: 180, overdue_total: 20,
      closed_total: 21, items_truncated: true }), expectedOrganizationId: organizationId,
      expectedBranchId: branchId, demo: false });
    expect(truncated).toMatchObject({ itemTotal: 1, matchingTotal: 201, itemsTruncated: true });
  });

  it("validates the linear chronology, responsibility and due-date evidence", () => {
    const row = sourceRow();
    const current = row.items[0]!;
    Object.assign(current, { handling_status: "in_progress", chain_version: 1,
      timeline_total: 1, current_improvement_due_date: "2026-09-03",
      last_activity_at: "2026-08-31T02:05:00.000Z", timeline: [{
        entry_id: entryId, sequence_number: 1, entry_type: "improvement",
        occurred_at: "2026-08-31T02:00:00.000Z", entry_text: "改善內容",
        notification_target: null, notification_method: null, notification_result: null,
        responsible_membership_id: membershipId, responsible_user_id: userId,
        responsible_display_name: "測試人員", due_date_action: "replace",
        due_date_value: "2026-09-03", effective_due_date: "2026-09-03",
        closure_outcome: null, closure_reason: null, committer_display_name: "測試人員",
        committed_at: "2026-08-31T02:05:00.000Z",
      }] });
    expect(projectAbnormalEventSnapshot({ row, expectedOrganizationId: organizationId,
      expectedBranchId: branchId, demo: false }).items[0]?.currentImprovementDueDate)
      .toBe("2026-09-03");
    current.last_activity_at = "2026-08-31T02:04:00.000Z";
    expect(() => projectAbnormalEventSnapshot({ row, expectedOrganizationId: organizationId,
      expectedBranchId: branchId, demo: false })).toThrow("INVALID_ABNORMAL_EVENT_PROJECTION");
  });

  it("requires an exact client/non-client target alignment and strict due action", () => {
    const parsed = parseAbnormalEventReport({ action: "report", affectedTargetKind: "facility",
      affectedClientId: null, affectedTargetLabel: "一樓電梯", occurredAt: "2026-09-01T01:00:00Z",
      location: "一樓", eventType: "設備異常", eventSummary: "內容", immediateAction: "停止使用",
      majorState: "unclassified", responsibleMembershipId: membershipId,
      improvementDueDate: "2026-09-03", lateEntryReason: null }, idempotencyKey);
    expect(parsed.affectedTargetLabel).toBe("一樓電梯");
    expect(() => parseAbnormalEventReport({ ...parsed, affectedTargetKind: "client",
      affectedClientId: null }, idempotencyKey)).toThrow(/未通過驗證/u);
    expect(() => parseAbnormalEventMutation({ action: "improvement", incidentId,
      affectedTargetKind: "client", affectedClientId: clientId,
      occurredAt: "2026-09-01T01:30:00Z", entryText: "改善",
      responsibleMembershipId: membershipId, dueDateAction: "keep",
      dueDateValue: "2026-09-04", expectedChainVersion: 1 }, idempotencyKey))
      .toThrow(/未通過驗證/u);
  });

  it("separates manual notification evidence from any delivery claim", () => {
    expect(parseAbnormalEventMutation({ action: "manual_notification", incidentId,
      affectedTargetKind: "facility", affectedClientId: null,
      occurredAt: "2026-09-01T01:30:00Z", notificationTarget: "主管",
      notificationMethod: "人工電話", notificationResult: "承辦人記錄已說明",
      expectedChainVersion: 1 }, idempotencyKey)).toMatchObject({ action: "manual_notification" });
  });

  it("strictly correlates database and browser receipts", () => {
    expect(parseAbnormalEventOperationResult(receipt())).toMatchObject({
      affectedClientId: clientId, incidentId, chainVersion: 2,
      responsibleMembershipId: membershipId, effectiveDueDate: "2026-09-03",
    });
    const envelope = { requestId: "27000000-0000-4000-8000-000000000090",
      status: "ok", data: { operationId, incidentId, entryId, operationKind: "follow_up",
        affectedTargetKind: "client", affectedClientId: clientId, chainVersion: 2,
        handlingStatus: "in_progress", responsibleMembershipId: membershipId,
        effectiveDueDate: "2026-09-03", committedAt: "2026-09-01T02:00:00Z",
        replayed: false, persisted: true, demo: false }, errors: [] };
    expect(parseAbnormalEventActionSuccess(envelope, { action: "follow_up", incidentId,
      affectedTargetKind: "client", affectedClientId: clientId, expectedChainVersion: 1,
      responsibleMembershipId: membershipId, effectiveDueDate: "2026-09-03" }).data.incidentId)
      .toBe(incidentId);
    expect(() => parseAbnormalEventActionSuccess(envelope, { action: "follow_up", incidentId,
      affectedTargetKind: "client", affectedClientId: clientId, expectedChainVersion: 1,
      responsibleMembershipId: membershipId, effectiveDueDate: "2026-09-04" }))
      .toThrow("MISMATCHED_ABNORMAL_EVENT_SUCCESS");
    expect(() => parseAbnormalEventOperationResult({ ...receipt(), actor: "forbidden" }))
      .toThrow(/完成憑證/u);
  });
});
