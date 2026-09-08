import { projectFallEventSnapshot } from "./projection";
import type { FallEventFilters, FallEventSnapshot } from "./types";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const clientA = "24000000-0000-4000-8000-000000000101";
const clientB = "24000000-0000-4000-8000-000000000102";
const clientClosed = "24000000-0000-4000-8000-000000000103";

function isoAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export function buildDemoFallEventSnapshot(): FallEventSnapshot {
  const generatedAt = new Date().toISOString();
  return projectFallEventSnapshot({
    expectedOrganizationId: organizationId,
    expectedBranchId: branchId,
    demo: true,
    row: {
      organization_id: organizationId,
      branch_id: branchId,
      generated_at: generatedAt,
      items: [
        {
          incident_id: "24000000-0000-4000-8000-000000000201",
          client_id: clientA,
          client_display_name: "陳美芳",
          occurred_at: isoAgo(3),
          reported_at: isoAgo(2.8),
          location: "活動區",
          event_summary: "轉位後站立時失去平衡，由工作人員陪同坐下。",
          injury_degree_state: "provided",
          injury_degree_text: "機構紀錄：右手肘輕微擦紅",
          late_entry_reason: null,
          reporter_display_name: "王照服員",
          handling_status: "reported",
          chain_version: 0,
          last_activity_at: isoAgo(2.8),
          timeline_total: 0,
          timeline_truncated: false,
          timeline: [],
        },
        {
          incident_id: "24000000-0000-4000-8000-000000000202",
          client_id: clientB,
          client_display_name: "林進財",
          occurred_at: isoAgo(27),
          reported_at: isoAgo(26.7),
          location: "走廊",
          event_summary: "步行至餐廳途中滑坐地面。",
          injury_degree_state: "missing",
          injury_degree_text: null,
          late_entry_reason: null,
          reporter_display_name: "李護理師",
          handling_status: "in_progress",
          chain_version: 2,
          last_activity_at: isoAgo(4),
          timeline_total: 2,
          timeline_truncated: false,
          timeline: [
            {
              entry_id: "24000000-0000-4000-8000-000000000301",
              sequence_number: 1,
              entry_type: "treatment",
              occurred_at: isoAgo(26.5),
              entry_text: "依機構流程完成現場觀察與聯絡。",
              closure_outcome: null,
              closure_reason: null,
              committer_display_name: "李護理師",
              committed_at: isoAgo(26.4),
            },
            {
              entry_id: "24000000-0000-4000-8000-000000000302",
              sequence_number: 2,
              entry_type: "follow_up",
              occurred_at: isoAgo(5),
              entry_text: "持續依機構決議追蹤，尚未結案。",
              closure_outcome: null,
              closure_reason: null,
              committer_display_name: "林社工",
              committed_at: isoAgo(4),
            },
          ],
        },
        {
          incident_id: "24000000-0000-4000-8000-000000000203",
          client_id: clientClosed,
          client_display_name: "黃秀琴",
          occurred_at: isoAgo(74),
          reported_at: isoAgo(48),
          location: "休息區",
          event_summary: "由座椅起身時滑落，事後依流程補登。",
          injury_degree_state: "not_applicable",
          injury_degree_text: null,
          late_entry_reason: "紙本事件單延遲轉錄",
          reporter_display_name: "周督導",
          handling_status: "closed",
          chain_version: 2,
          last_activity_at: isoAgo(20),
          timeline_total: 2,
          timeline_truncated: false,
          timeline: [
            {
              entry_id: "24000000-0000-4000-8000-000000000303",
              sequence_number: 1,
              entry_type: "follow_up",
              occurred_at: isoAgo(46),
              entry_text: "依事件決議完成後續追蹤。",
              closure_outcome: null,
              closure_reason: null,
              committer_display_name: "林社工",
              committed_at: isoAgo(45),
            },
            {
              entry_id: "24000000-0000-4000-8000-000000000304",
              sequence_number: 2,
              entry_type: "closure",
              occurred_at: isoAgo(21),
              entry_text: null,
              closure_outcome: "機構確認追蹤項目均已完成。",
              closure_reason: "主管人工覆核後結案。",
              committer_display_name: "周督導",
              committed_at: isoAgo(20),
            },
          ],
        },
      ],
      item_total: 3,
      matching_total: 3,
      injury_provided_total: 1,
      awaiting_action_total: 1,
      awaiting_closure_total: 1,
      closed_total: 1,
      items_truncated: false,
      client_options: [
        { client_id: clientA, display_name: "陳美芳", client_status: "active", admitted_on: "2025-01-10", ended_on: null, can_report: true },
        { client_id: clientB, display_name: "林進財", client_status: "active", admitted_on: "2025-03-12", ended_on: null, can_report: true },
        { client_id: clientClosed, display_name: "黃秀琴", client_status: "closed", admitted_on: "2024-01-01", ended_on: "2026-08-30", can_report: false },
      ],
      client_options_truncated: false,
      injury_degree_options: ["機構紀錄：右手肘輕微擦紅"],
      injury_options_truncated: false,
      injury_taxonomy_status: "not_configured",
      severity_scoring_status: "not_configured",
      reporting_threshold_status: "not_configured",
    },
  });
}

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function filterDemoFallEventSnapshot(
  snapshot: FallEventSnapshot,
  filters: FallEventFilters,
): FallEventSnapshot {
  const items = snapshot.items.filter((item) => {
    const date = taipeiDate(item.occurredAt);
    return (!filters.dateFrom || date >= filters.dateFrom) &&
      (!filters.dateTo || date <= filters.dateTo) &&
      (!filters.clientId || item.clientId === filters.clientId) &&
      (filters.handlingStatus === "all" || item.handlingStatus === filters.handlingStatus) &&
      (!filters.injuryDegree ||
        (filters.injuryDegree === "__missing__" && item.injuryDegreeState === "missing") ||
        (filters.injuryDegree === "__not_applicable__" && item.injuryDegreeState === "not_applicable") ||
        (item.injuryDegreeState === "provided" && item.injuryDegreeText === filters.injuryDegree));
  });
  return {
    ...snapshot,
    items,
    itemTotal: items.length,
    matchingTotal: items.length,
    itemsTruncated: false,
    metrics: {
      injuryProvided: items.filter((item) => item.injuryDegreeState === "provided").length,
      awaitingAction: items.filter((item) => item.handlingStatus === "reported").length,
      awaitingClosure: items.filter((item) => item.handlingStatus === "in_progress").length,
      closed: items.filter((item) => item.handlingStatus === "closed").length,
    },
  };
}
