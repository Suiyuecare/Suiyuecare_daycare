import { describe, expect, it } from "vitest";

import {
  parseFallEventActionSuccess,
  parseFallEventMutation,
  parseFallEventOperationResult,
  parseFallEventReport,
} from "./parser";
import { projectFallEventSnapshot } from "./projection";

const organizationId = "24000000-0000-4000-8000-000000000001";
const branchId = "24000000-0000-4000-8000-000000000002";
const clientId = "24000000-0000-4000-8000-000000000003";
const incidentId = "24000000-0000-4000-8000-000000000004";
const operationId = "24000000-0000-4000-8000-000000000005";
const entryId = "24000000-0000-4000-8000-000000000006";
const idempotencyKey = "24000000-0000-4000-8000-000000000007";

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: organizationId,
    branch_id: branchId,
    generated_at: "2026-09-01T02:00:00.000Z",
    items: [{
      incident_id: incidentId,
      client_id: clientId,
      client_display_name: "測試個案",
      occurred_at: "2026-08-31T01:00:00.000Z",
      reported_at: "2026-08-31T01:05:00.000Z",
      location: "活動區",
      event_summary: "測試事件",
      injury_degree_state: "provided",
      injury_degree_text: "機構文字",
      late_entry_reason: null,
      reporter_display_name: "測試人員",
      handling_status: "in_progress",
      chain_version: 2,
      last_activity_at: "2026-08-31T03:05:00.000Z",
      timeline_total: 2,
      timeline_truncated: false,
      timeline: [{
        entry_id: "24000000-0000-4000-8000-000000000011",
        sequence_number: 1,
        entry_type: "treatment",
        occurred_at: "2026-08-31T02:00:00.000Z",
        entry_text: "第一行\n第二行",
        closure_outcome: null,
        closure_reason: null,
        committer_display_name: "測試人員",
        committed_at: "2026-08-31T02:05:00.000Z",
      }, {
        entry_id: "24000000-0000-4000-8000-000000000012",
        sequence_number: 2,
        entry_type: "follow_up",
        occurred_at: "2026-08-31T03:00:00.000Z",
        entry_text: "追蹤內容",
        closure_outcome: null,
        closure_reason: null,
        committer_display_name: "測試人員",
        committed_at: "2026-08-31T03:05:00.000Z",
      }],
    }],
    item_total: 1,
    matching_total: 1,
    injury_provided_total: 1,
    awaiting_action_total: 0,
    awaiting_closure_total: 1,
    closed_total: 0,
    items_truncated: false,
    client_options: [{
      client_id: clientId,
      display_name: "測試個案",
      client_status: "active",
      admitted_on: "2026-01-01",
      ended_on: null,
      can_report: true,
    }],
    client_options_truncated: false,
    injury_degree_options: ["機構文字"],
    injury_options_truncated: false,
    injury_taxonomy_status: "not_configured",
    severity_scoring_status: "not_configured",
    reporting_threshold_status: "not_configured",
    ...overrides,
  };
}

function successEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "24000000-0000-4000-8000-000000000020",
    status: "ok",
    data: {
      operationId,
      incidentId,
      clientId,
      entryId,
      chainVersion: 3,
      handlingStatus: "in_progress",
      committedAt: "2026-09-01T02:00:00.000Z",
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("fall event projection and parser", () => {
  it("accepts one linked immutable timeline and rejects cross-scope or decreasing event time", () => {
    expect(projectFallEventSnapshot({
      row: sourceRow(), expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false,
    }).items[0]?.timeline).toHaveLength(2);
    expect(() => projectFallEventSnapshot({
      row: sourceRow(), expectedOrganizationId: organizationId,
      expectedBranchId: "24000000-0000-4000-8000-000000000099", demo: false,
    })).toThrow("INVALID_FALL_EVENT_PROJECTION");
    const decreasing = sourceRow();
    const items = decreasing.items as Array<{ timeline: Array<Record<string, unknown>> }>;
    items[0]!.timeline[1] = {
      ...items[0]!.timeline[1], occurred_at: "2026-08-31T01:30:00.000Z",
    };
    expect(() => projectFallEventSnapshot({
      row: decreasing, expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false,
    })).toThrow("INVALID_FALL_EVENT_PROJECTION");
  });

  it("accepts full-set metrics when detail is truncated and rejects forged aggregate parity", () => {
    const snapshot = projectFallEventSnapshot({
      row: sourceRow({
        matching_total: 201,
        injury_provided_total: 100,
        awaiting_action_total: 100,
        awaiting_closure_total: 101,
        items_truncated: true,
      }),
      expectedOrganizationId: organizationId,
      expectedBranchId: branchId,
      demo: false,
    });
    expect(snapshot).toMatchObject({ itemTotal: 1, matchingTotal: 201, itemsTruncated: true });
    expect(() => projectFallEventSnapshot({
      row: sourceRow({ matching_total: 2 }),
      expectedOrganizationId: organizationId,
      expectedBranchId: branchId,
      demo: false,
    })).toThrow("INVALID_FALL_EVENT_PROJECTION");
  });

  it("allows line breaks and tabs only in narrative fields", () => {
    expect(parseFallEventReport({
      action: "report",
      clientId,
      occurredAt: "2026-09-01T01:00:00.000Z",
      location: "活動區",
      eventSummary: "第一行\n第二行\t補充",
      injuryDegreeState: "missing",
      injuryDegreeText: null,
      lateEntryReason: null,
    }, idempotencyKey).eventSummary).toContain("\n");
    expect(parseFallEventMutation({
      action: "follow_up", clientId, incidentId,
      occurredAt: "2026-09-01T01:00:00.000Z",
      entryText: "第一行\n第二行", expectedChainVersion: 2,
    }, idempotencyKey)).toMatchObject({ action: "follow_up" });
    expect(() => parseFallEventReport({
      action: "report", clientId, occurredAt: "2026-09-01T01:00:00.000Z",
      location: "活動\n區", eventSummary: "內容", injuryDegreeState: "missing",
      injuryDegreeText: null, lateEntryReason: null,
    }, idempotencyKey)).toThrow(/未通過驗證/u);
    expect(() => parseFallEventMutation({
      action: "follow_up", clientId, incidentId,
      occurredAt: "2026-09-01T01:00:00.000Z",
      entryText: "不可\u0000見", expectedChainVersion: 2,
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("strictly parses and correlates database and browser receipts to client, incident, chain and action", () => {
    expect(parseFallEventOperationResult({
      operation_id: operationId,
      incident_id: incidentId,
      client_id: clientId,
      entry_id: entryId,
      chain_version: 3,
      handling_status: "in_progress",
      committed_at: "2026-09-01T02:00:00.000Z",
      replayed: false,
    })).toMatchObject({ clientId, incidentId, chainVersion: 3 });
    expect(parseFallEventActionSuccess(successEnvelope(), {
      action: "follow_up", clientId, incidentId, expectedChainVersion: 2,
    }).data.clientId).toBe(clientId);
    expect(() => parseFallEventActionSuccess(successEnvelope({
      clientId: "24000000-0000-4000-8000-000000000099",
    }), { action: "follow_up", clientId, incidentId, expectedChainVersion: 2 }))
      .toThrow("MISMATCHED_FALL_EVENT_SUCCESS");
    expect(() => parseFallEventOperationResult({
      operation_id: operationId, incident_id: incidentId, client_id: clientId,
      entry_id: entryId, chain_version: 3, handling_status: "in_progress",
      committed_at: "2026-09-01T02:00:00.000Z", replayed: false,
      actor_user_id: "forbidden",
    })).toThrow(/完成憑證/u);
  });
});
