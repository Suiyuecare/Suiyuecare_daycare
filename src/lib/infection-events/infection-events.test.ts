import { describe, expect, it } from "vitest";

import {
  parseInfectionEventActionSuccess,
  parseInfectionEventMutation,
  parseInfectionEventOperationResult,
  parseInfectionEventReport,
} from "./parser";
import { projectInfectionEventSnapshot } from "./projection";

const organizationId = "24000000-0000-4000-8000-000000000001";
const branchId = "24000000-0000-4000-8000-000000000002";
const clientId = "24000000-0000-4000-8000-000000000003";
const incidentId = "24000000-0000-4000-8000-000000000004";
const operationId = "24000000-0000-4000-8000-000000000005";
const entryId = "24000000-0000-4000-8000-000000000006";
const idempotencyKey = "24000000-0000-4000-8000-000000000007";
const clusterId = "24000000-0000-4000-8000-000000000008";

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
      infection_type_state: "provided",
      infection_type_text: "機構文字",
      current_cluster_id: null,
      current_cluster_label: null,
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
        cluster_id: null,
        cluster_label: null,
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
        cluster_id: null,
        cluster_label: null,
        closure_outcome: null,
        closure_reason: null,
        committer_display_name: "測試人員",
        committed_at: "2026-08-31T03:05:00.000Z",
      }],
    }],
    item_total: 1,
    matching_total: 1,
    infection_provided_total: 1,
    linked_total: 0,
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
    client_options_available_total: 1,
    client_options_truncated: false,
    infection_type_options: ["機構文字"],
    infection_options_available_total: 1,
    infection_options_truncated: false,
    cluster_options: [],
    cluster_options_available_total: 0,
    cluster_options_truncated: false,
    infection_taxonomy_status: "not_configured",
    cluster_threshold_status: "not_configured",
    legal_reporting_status: "not_configured",
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
      operationKind: "follow_up",
      chainVersion: 3,
      handlingStatus: "in_progress",
      clusterId: null,
      clusterLabel: null,
      committedAt: "2026-09-01T02:00:00.000Z",
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("infection event projection and parser", () => {
  it("accepts one immutable timeline and rejects cross-scope or decreasing event time", () => {
    expect(projectInfectionEventSnapshot({
      row: sourceRow(), expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false,
    }).items[0]?.timeline).toHaveLength(2);
    expect(() => projectInfectionEventSnapshot({
      row: sourceRow(), expectedOrganizationId: organizationId,
      expectedBranchId: "24000000-0000-4000-8000-000000000099", demo: false,
    })).toThrow("INVALID_INFECTION_EVENT_PROJECTION");
    const decreasing = sourceRow();
    const items = decreasing.items as Array<{ timeline: Array<Record<string, unknown>> }>;
    items[0]!.timeline[1] = {
      ...items[0]!.timeline[1], occurred_at: "2026-08-31T01:30:00.000Z",
    };
    expect(() => projectInfectionEventSnapshot({
      row: decreasing, expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false,
    })).toThrow("INVALID_INFECTION_EVENT_PROJECTION");
  });

  it("derives the current cluster from exact link history and rejects projection drift", () => {
    const linked = sourceRow({ linked_total: 1 });
    const items = linked.items as Array<Record<string, unknown> & {
      timeline: Array<Record<string, unknown>>;
    }>;
    items[0]!.timeline.push({
      entry_id: "24000000-0000-4000-8000-000000000013",
      sequence_number: 3,
      entry_type: "cluster_link",
      occurred_at: "2026-08-31T04:00:00.000Z",
      entry_text: null,
      cluster_id: clusterId,
      cluster_label: "人工群聚 A",
      closure_outcome: null,
      closure_reason: null,
      committer_display_name: "測試人員",
      committed_at: "2026-08-31T04:05:00.000Z",
    });
    Object.assign(items[0]!, {
      current_cluster_id: clusterId,
      current_cluster_label: "人工群聚 A",
      chain_version: 3,
      timeline_total: 3,
      last_activity_at: "2026-08-31T04:05:00.000Z",
    });
    expect(projectInfectionEventSnapshot({
      row: linked, expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false,
    }).metrics.linked).toBe(1);
    items[0]!.current_cluster_label = "偽造名稱";
    expect(() => projectInfectionEventSnapshot({
      row: linked, expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false,
    })).toThrow("INVALID_INFECTION_EVENT_PROJECTION");
  });

  it("rejects duplicate incidents instead of double-counting one stable event", () => {
    const duplicate = sourceRow({
      item_total: 2,
      matching_total: 2,
      infection_provided_total: 2,
      awaiting_closure_total: 2,
    });
    duplicate.items = [duplicate.items[0]!, structuredClone(duplicate.items[0]!)];
    expect(() => projectInfectionEventSnapshot({
      row: duplicate, expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false,
    })).toThrow("INVALID_INFECTION_EVENT_PROJECTION");
  });

  it("uses the terminal cluster action and activity receipt even in a latest-100 truncated window", () => {
    const truncated = sourceRow({ linked_total: 1 });
    const items = truncated.items as Array<Record<string, unknown> & {
      timeline: Array<Record<string, unknown>>;
    }>;
    const timeline = Array.from({ length: 100 }, (_, index) => {
      const terminal = index === 99;
      const occurredAt = new Date(Date.UTC(2026, 7, 31, 2, index)).toISOString();
      const committedAt = new Date(Date.UTC(2026, 7, 31, 2, index, 30)).toISOString();
      return {
        entry_id: `24000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
        sequence_number: index + 2,
        entry_type: terminal ? "cluster_link" : "follow_up",
        occurred_at: occurredAt,
        entry_text: terminal ? null : `人工追蹤 ${index + 1}`,
        cluster_id: terminal ? clusterId : null,
        cluster_label: terminal ? "人工群聚 A" : null,
        closure_outcome: null,
        closure_reason: null,
        committer_display_name: "測試人員",
        committed_at: committedAt,
      };
    });
    Object.assign(items[0]!, {
      current_cluster_id: clusterId,
      current_cluster_label: "人工群聚 A",
      chain_version: 101,
      timeline_total: 101,
      timeline_truncated: true,
      timeline,
      last_activity_at: timeline.at(-1)!.committed_at,
    });
    expect(projectInfectionEventSnapshot({
      row: truncated, expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false,
    }).items[0]?.currentClusterId).toBe(clusterId);

    items[0]!.current_cluster_id = null;
    items[0]!.current_cluster_label = null;
    expect(() => projectInfectionEventSnapshot({
      row: truncated, expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false,
    })).toThrow("INVALID_INFECTION_EVENT_PROJECTION");
    items[0]!.current_cluster_id = clusterId;
    items[0]!.current_cluster_label = "人工群聚 A";
    items[0]!.last_activity_at = "2026-08-31T01:05:00.000Z";
    expect(() => projectInfectionEventSnapshot({
      row: truncated, expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false,
    })).toThrow("INVALID_INFECTION_EVENT_PROJECTION");
  });

  it("accepts full-set metrics when detail is truncated and rejects forged aggregate parity", () => {
    const snapshot = projectInfectionEventSnapshot({
      row: sourceRow({
        matching_total: 201,
        infection_provided_total: 100,
        linked_total: 0,
        awaiting_action_total: 100,
        awaiting_closure_total: 101,
        items_truncated: true,
      }),
      expectedOrganizationId: organizationId,
      expectedBranchId: branchId,
      demo: false,
    });
    expect(snapshot).toMatchObject({ itemTotal: 1, matchingTotal: 201, itemsTruncated: true });
    expect(() => projectInfectionEventSnapshot({
      row: sourceRow({ matching_total: 2 }),
      expectedOrganizationId: organizationId,
      expectedBranchId: branchId,
      demo: false,
    })).toThrow("INVALID_INFECTION_EVENT_PROJECTION");
  });

  it("allows line breaks and tabs only in narrative fields", () => {
    expect(parseInfectionEventReport({
      action: "report",
      clientId,
      occurredAt: "2026-09-01T01:00:00.000Z",
      location: "活動區",
      eventSummary: "第一行\n第二行\t補充",
      infectionTypeState: "missing",
      infectionTypeText: null,
    }, idempotencyKey).eventSummary).toContain("\n");
    expect(parseInfectionEventMutation({
      action: "follow_up", clientId, incidentId,
      occurredAt: "2026-09-01T01:00:00.000Z",
      entryText: "第一行\n第二行", expectedChainVersion: 2,
    }, idempotencyKey)).toMatchObject({ action: "follow_up" });
    expect(() => parseInfectionEventReport({
      action: "report", clientId, occurredAt: "2026-09-01T01:00:00.000Z",
      location: "活動\n區", eventSummary: "內容", infectionTypeState: "missing",
      infectionTypeText: null,
    }, idempotencyKey)).toThrow(/未通過驗證/u);
    expect(() => parseInfectionEventMutation({
      action: "follow_up", clientId, incidentId,
      occurredAt: "2026-09-01T01:00:00.000Z",
      entryText: "不可\u0000見", expectedChainVersion: 2,
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("strictly parses and correlates database and browser receipts to client, incident, chain and action", () => {
    expect(parseInfectionEventOperationResult({
      operation_id: operationId,
      incident_id: incidentId,
      client_id: clientId,
      entry_id: entryId,
      operation_kind: "follow_up",
      chain_version: 3,
      handling_status: "in_progress",
      cluster_id: null,
      cluster_label: null,
      committed_at: "2026-09-01T02:00:00.000Z",
      replayed: false,
    })).toMatchObject({ clientId, incidentId, chainVersion: 3 });
    expect(parseInfectionEventActionSuccess(successEnvelope(), {
      action: "follow_up", clientId, incidentId, expectedChainVersion: 2,
    }).data.clientId).toBe(clientId);
    expect(() => parseInfectionEventActionSuccess(successEnvelope({
      clientId: "24000000-0000-4000-8000-000000000099",
    }), { action: "follow_up", clientId, incidentId, expectedChainVersion: 2 }))
      .toThrow("MISMATCHED_INFECTION_EVENT_SUCCESS");
    expect(() => parseInfectionEventOperationResult({
      operation_id: operationId, incident_id: incidentId, client_id: clientId,
      entry_id: entryId, operation_kind: "follow_up", chain_version: 3,
      handling_status: "in_progress", cluster_id: null, cluster_label: null,
      committed_at: "2026-09-01T02:00:00.000Z", replayed: false,
      actor_user_id: "forbidden",
    })).toThrow(/完成憑證/u);
  });
});
